// novain-platform/webhook/server.js
// Deterministic webhook server with CI-friendly behaviour.
//
// Consolidated endpoints:
//   POST /webhook           (action router; used by tests + legacy flows)
//   POST /optimize_question (Voiceflow C_OptimizeQuestion)
//   POST /teach_and_quiz    (Voiceflow C_TeachAndQuiz)
//   POST /generate_quiz     (Voiceflow C_GenerateQuiz - optional)
//   POST /generate_lesson   (optional)
//
// Notes:
// - Auth is via x-api-key header if WEBHOOK_API_KEY or WEBHOOK_KEY is set.
// - Keeps backwards compatibility with older APL_* response fields,
//   but the canonical fields for your updated Voiceflow flows are API_*.

"use strict";

const http = require("http");
const https = require("https");
const express = require("express");

// ---------------------------------------------------------------------------
// Env + logging
// ---------------------------------------------------------------------------

const NODE_ENV = process.env.NODE_ENV || "local";
const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const DEFAULT_PORT = Number.parseInt(process.env.PORT || "3000", 10);

function log(level, msg, extra) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    env: NODE_ENV,
    msg,
    ...(extra || {}),
  };
  console.log(JSON.stringify(payload));
}

function logDebug(msg, extra) {
  if (LOG_LEVEL === "debug") log("debug", msg, extra);
}

function getWebhookKey() {
  return process.env.WEBHOOK_API_KEY || process.env.WEBHOOK_KEY || "";
}

function requireApiKey(req, res, next) {
  const requiredKey = getWebhookKey();
  if (!requiredKey) return next();

  const apiKeyHeader = req.get("x-api-key") || "";
  if (apiKeyHeader !== requiredKey) {
    return res
      .status(401)
      .json({ ok: false, API_OK: "false", error: "unauthorized" });
  }
  return next();
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();

// capture raw body for potential HMAC; still parse JSON
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// ---------------------------------------------------------------------------
// LLM stub + prompt service helpers
// ---------------------------------------------------------------------------

function makeStubRaw(kind, body) {
  const base = {
    question: body && body.question ? String(body.question) : "",
    tenantId: body && body.tenantId ? String(body.tenantId) : "default",
    component: body && body.component ? String(body.component) : undefined,
    ts: new Date().toISOString(),
    kind,
  };

  if (kind === "invoke_component")
    return { ...base, source: "invoke_component_stub" };
  if (kind === "generate_lesson")
    return { ...base, mode: "lesson", source: "lesson_stub" };
  if (kind === "generate_quiz")
    return { ...base, mode: "quiz", source: "quiz_stub" };
  if (kind === "optimize_question")
    return {
      ...base,
      mode: "optimize_question",
      source: "optimize_question_stub",
    };
  if (kind === "teach_and_quiz")
    return { ...base, mode: "teach_and_quiz", source: "teach_and_quiz_stub" };

  return { ...base, source: "stub" };
}

async function callPromptService(kind, body) {
  const promptUrl = process.env.PROMPT_URL;
  if (!promptUrl) {
    // No external prompt service configured: use deterministic stub
    return makeStubRaw(kind, body);
  }

  const payload = {
    action: kind,
    question: body && body.question ? String(body.question) : "",
    tenantId: body && body.tenantId ? String(body.tenantId) : "default",
    component: body && body.component ? String(body.component) : undefined,
  };

  try {
    const resp = await globalThis.fetch(promptUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await resp.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }

    const raw =
      (parsed && parsed.raw && typeof parsed.raw === "object"
        ? parsed.raw
        : parsed) || {};

    if (!raw.source) {
      raw.source =
        kind === "invoke_component"
          ? "invoke_component_default"
          : kind === "generate_lesson"
            ? "lesson_default"
            : kind === "generate_quiz"
              ? "quiz_default"
              : kind === "optimize_question"
                ? "optimize_question_default"
                : kind === "teach_and_quiz"
                  ? "teach_and_quiz_default"
                  : "remote_llm";
    }

    return raw;
  } catch (err) {
    log("error", "Error calling prompt service", {
      message: err && err.message,
    });
    // Fall back to stub on error
    return makeStubRaw(kind, body);
  }
}

function logLlmPayloadSnippet(raw) {
  if (String(process.env.DEBUG_WEBHOOK).toLowerCase() !== "true") return;

  try {
    const snippet = JSON.stringify(raw).slice(0, 400);
    console.log("llm payload snippet:", snippet);
  } catch {
    console.log("llm payload snippet: [unserializable]");
  }
}

function closeResources() {
  try {
    if (
      http &&
      http.globalAgent &&
      typeof http.globalAgent.destroy === "function"
    ) {
      http.globalAgent.destroy();
    }
    if (
      https &&
      https.globalAgent &&
      typeof https.globalAgent.destroy === "function"
    ) {
      https.globalAgent.destroy();
    }
  } catch {
    // best-effort only
  }
}

// ---------------------------------------------------------------------------
// Core business handlers (shared by /webhook and direct endpoints)
// ---------------------------------------------------------------------------

function pickQuestionFromBody(body) {
  const candidates = [
    body && body.question,
    body && body.user_message,
    body && body.userMessage,
    body && body.last_utterance,
    body && body.lastUtterance,
    body && body.optimized_question,
    body && body.optimizedQuestion,
  ];
  for (const c of candidates) {
    const s = String(c || "").trim();
    if (s) return s;
  }
  return "";
}

function buildOptimizeQuestionResponse(body, raw) {
  const original = pickQuestionFromBody(body);
  const trimmed = String(original || "").trim();

  let component_result;
  let optimized_question = trimmed;
  let agent_reply;
  let clarify_reason = null;

  if (!trimmed || trimmed.length < 10) {
    component_result = "needs_clarify";
    agent_reply =
      "I want to be sure I understand. Could you restate your question in one clear sentence or add a bit more detail?";
    clarify_reason = "too_short_or_empty";
  } else {
    component_result = "success";

    const normalized = trimmed.replace(/\s+/g, " ");
    optimized_question = normalized.endsWith("?")
      ? normalized
      : normalized + "?";

    agent_reply =
      "Got it — I’ll turn this into a clean lesson and (optionally) a quiz.";
  }

  return {
    ok: true,
    API_OK: "true",
    raw,
    component_result,
    optimized_question,
    agent_reply,
    clarify_reason,
    API_Response: agent_reply,
    data: {
      raw,
      component_result,
      optimized_question,
      agent_reply,
      clarify_reason,
    },
  };
}

function buildQuizEnvelope(question) {
  const trimmedQuestion = String(question || "").trim() || "your question";

  const mcq = [
    {
      type: "mcq",
      question:
        "What is the FIRST thing you should clarify when tackling a strategy question?",
      options: [
        "The tools and software you will use",
        "The business objective and success metrics",
        "The colour of the slide deck",
        "The company logo guidelines",
      ],
      answer: "The business objective and success metrics",
    },
  ];

  const tf = [
    {
      type: "tf",
      question:
        "True or false: You should pick as many strategic options as possible and try them all at once.",
      answer: "False",
    },
  ];

  const open = [
    {
      type: "open",
      question:
        "In 2–3 sentences, describe one concrete experiment you could run in the next 2–4 weeks.",
    },
  ];

  return { question: trimmedQuestion, mcq, tf, open };
}

function buildTeachAndQuizResponse(body, raw) {
  const question = pickQuestionFromBody(body) || "your business question";
  const trimmedQuestion = String(question).trim() || "your question";

  const strategy_answer =
    `Here is a simple, high-level way I would approach "${trimmedQuestion}". ` +
    "First, clarify the objective and success metrics. Second, analyze the current state and constraints. " +
    "Third, identify 2–3 strategic options, compare impact vs. effort, and choose one to test. " +
    "Finally, define concrete next steps for the next 2–4 weeks.";

  const lessonTitle = `Strategy lesson for: ${trimmedQuestion}`;
  const lessonContent =
    `In this lesson, we’ll walk through a structured way to think about "${trimmedQuestion}". ` +
    "We’ll cover: (1) clarifying the business goal, (2) mapping stakeholders and constraints, " +
    "(3) generating strategic options, and (4) choosing a focused experiment you can run quickly.";
  const promptLesson =
    `You are a business strategy co-pilot. Help me reason about "${trimmedQuestion}" step-by-step. ` +
    "Ask clarifying questions where needed, then propose a simple plan with next actions.";

  const quizEnvelope = buildQuizEnvelope(trimmedQuestion);

  const API_MCQ = quizEnvelope.mcq.length;
  const API_TF = quizEnvelope.tf.length;
  const API_OPEN = quizEnvelope.open.length;
  const API_Quiz_JSON = JSON.stringify(quizEnvelope);

  const component_result = "success";

  // Back-compat fields (older flow versions)
  const APL_MCQ = API_MCQ;
  const APL_TF = API_TF;
  const APL_OPEN = API_OPEN;
  const APL_Quiz_JSON = API_Quiz_JSON;

  return {
    ok: true,
    API_OK: "true",
    raw,
    component_result,
    strategy_answer,

    // Canonical fields for your Voiceflow blocks (API_*)
    API_LessonTitle: lessonTitle,
    API_LessonContent: lessonContent,
    API_PromptLesson: promptLesson,
    API_MCQ,
    API_TF,
    API_OPEN,
    API_Quiz_JSON,
    API_Response: strategy_answer,

    // Optional JSON slots (useful later)
    API_Lesson_JSON: JSON.stringify({
      title: lessonTitle,
      content: lessonContent,
      promptLesson,
    }),
    API_PromptLesson_JSON: JSON.stringify({ promptLesson }),

    // Back-compat (APL_*)
    APL_LessonTitle: lessonTitle,
    APL_lesson_content: lessonContent,
    APL_PromptLesson: promptLesson,
    APL_MCQ,
    APL_TF,
    APL_OPEN,
    APL_Quiz_JSON,

    data: {
      raw,
      component_result,
      strategy_answer,
      API_LessonTitle: lessonTitle,
      API_LessonContent: lessonContent,
      API_PromptLesson: promptLesson,
      API_MCQ,
      API_TF,
      API_OPEN,
      API_Quiz_JSON,
    },
  };
}

function buildGenerateQuizResponse(body, raw) {
  const question = pickQuestionFromBody(body) || "Quiz stub question";
  const quizEnvelope = buildQuizEnvelope(question);
  const mcqCount = quizEnvelope.mcq.length;

  return {
    ok: true,
    API_OK: "true",
    raw,
    // Keep the old smoke-test-friendly fields:
    mcq: quizEnvelope.mcq,
    mcqCount,
    reply: "Stub MCQ quiz generated",
    // Canonical Voiceflow fields:
    API_MCQ: quizEnvelope.mcq.length,
    API_TF: quizEnvelope.tf.length,
    API_OPEN: quizEnvelope.open.length,
    API_Quiz_JSON: JSON.stringify(quizEnvelope),
    data: {
      raw,
      quiz: quizEnvelope,
      mcq: quizEnvelope.mcq,
      mcqCount,
      reply: "Stub MCQ quiz generated",
    },
  };
}

function buildGenerateLessonResponse(body, raw) {
  const question = pickQuestionFromBody(body) || "Lesson stub question";
  const lessonText =
    (body && body.lesson && String(body.lesson)) ||
    `Stub lesson generated for: ${question}`;

  return {
    ok: true,
    API_OK: "true",
    raw,
    lesson: lessonText,
    reply: lessonText,
    API_Response: lessonText,
    data: {
      raw,
      lesson: lessonText,
      reply: lessonText,
    },
  };
}

// ---------------------------------------------------------------------------
// Basic diagnostics endpoints
// ---------------------------------------------------------------------------

app.get("/health", (req, res) => {
  logDebug("GET /health", { ip: req.ip });
  res.type("text/plain").send("ok");
});

app.get("/diagnostics/env", (_req, res) => {
  res.json({
    ok: true,
    env: {
      NODE_ENV,
      LOG_LEVEL,
      hasWebhookKey: Boolean(getWebhookKey()),
      hasPromptUrl: Boolean(process.env.PROMPT_URL),
      debugWebhook: String(process.env.DEBUG_WEBHOOK || "false"),
    },
  });
});

// ---------------------------------------------------------------------------
// Direct endpoints (what your Voiceflow API blocks are calling)
// ---------------------------------------------------------------------------

app.post("/optimize_question", requireApiKey, async (req, res) => {
  const body = req.body || {};
  const raw = await callPromptService("optimize_question", body);
  logLlmPayloadSnippet(raw);
  return res.json(buildOptimizeQuestionResponse(body, raw));
});

app.post("/teach_and_quiz", requireApiKey, async (req, res) => {
  const body = req.body || {};
  const raw = await callPromptService("teach_and_quiz", body);
  logLlmPayloadSnippet(raw);
  return res.json(buildTeachAndQuizResponse(body, raw));
});

app.post("/generate_quiz", requireApiKey, async (req, res) => {
  const body = req.body || {};
  const raw = await callPromptService("generate_quiz", body);
  logLlmPayloadSnippet(raw);
  return res.json(buildGenerateQuizResponse(body, raw));
});

app.post("/generate_lesson", requireApiKey, async (req, res) => {
  const body = req.body || {};
  const raw = await callPromptService("generate_lesson", body);
  logLlmPayloadSnippet(raw);
  return res.json(buildGenerateLessonResponse(body, raw));
});

// ---------------------------------------------------------------------------
// Core webhook handler (action router used by tests + legacy flows)
// ---------------------------------------------------------------------------

app.post("/webhook", requireApiKey, async (req, res) => {
  const body = req.body || {};
  const action = body.action || body.type || "";

  // ---- ping (used in smoke + verify_in_process) ---------------------------
  if (action === "ping") {
    const port = Number(process.env.PORT || DEFAULT_PORT);
    return res.json({ ok: true, API_OK: "true", reply: "pong", port });
  }

  // ---- llm_elicit / invoke_component (regression mirror tests) ------------
  if (action === "llm_elicit" || action === "invoke_component") {
    const raw = await callPromptService(action, body);
    logLlmPayloadSnippet(raw);
    return res.json({ ok: true, API_OK: "true", raw, data: { raw } });
  }

  // ---- generate_lesson (best-effort smoke) -------------------------------
  if (action === "generate_lesson") {
    const raw = await callPromptService("generate_lesson", body);
    logLlmPayloadSnippet(raw);
    return res.json(buildGenerateLessonResponse(body, raw));
  }

  // ---- generate_quiz (best-effort smoke) ---------------------------------
  if (action === "generate_quiz") {
    const raw = await callPromptService("generate_quiz", body);
    logLlmPayloadSnippet(raw);
    return res.json(buildGenerateQuizResponse(body, raw));
  }

  // ---- optimize_question (C_OptimizeQuestion) ----------------------------
  if (action === "optimize_question") {
    const raw = await callPromptService("optimize_question", body);
    logLlmPayloadSnippet(raw);
    return res.json(buildOptimizeQuestionResponse(body, raw));
  }

  // ---- teach_and_quiz (C_TeachAndQuiz orchestrator) ----------------------
  if (action === "teach_and_quiz") {
    const raw = await callPromptService("teach_and_quiz", body);
    logLlmPayloadSnippet(raw);
    return res.json(buildTeachAndQuizResponse(body, raw));
  }

  // ---- generic fallback ---------------------------------------------------
  const fallbackRaw = {
    source: "echo",
    action: action || "unknown",
    payload: body,
    ts: new Date().toISOString(),
  };

  return res.json({
    ok: true,
    API_OK: "true",
    raw: fallbackRaw,
    data: { raw: fallbackRaw },
  });
});

// ---------------------------------------------------------------------------
// 404 + error handlers
// ---------------------------------------------------------------------------

app.use((req, res) => {
  logDebug("404", { method: req.method, path: req.path });
  res.status(404).json({
    ok: false,
    API_OK: "false",
    error: "not_found",
    method: req.method,
    path: req.path,
  });
});

app.use((err, req, res, _next) => {
  log("error", "Unhandled error in request", {
    path: req.path,
    method: req.method,
    message: err && err.message,
    stack: err && err.stack,
  });
  res.status(500).json({
    ok: false,
    API_OK: "false",
    error: "internal_error",
    message: err && err.message ? err.message : "Unexpected error",
  });
});

// ---------------------------------------------------------------------------
// Server bootstrap – no auto-listen on require
// ---------------------------------------------------------------------------

let currentServer = null;

function startServer(port) {
  if (currentServer) return currentServer;

  const listenPort = Number.parseInt(
    port != null ? String(port) : String(DEFAULT_PORT),
    10
  );
  const server = http.createServer(app);

  server.listen(listenPort, () => {
    log("info", "Webhook server listening", { port: listenPort });
  });

  server.on("error", (err) => {
    log("error", "HTTP server error", {
      message: err && err.message,
      stack: err && err.stack,
    });
  });

  currentServer = server;
  return server;
}

// When run directly: "node novain-platform/webhook/server.js"
if (require.main === module) {
  startServer();
}

// Helpers expected by some tests.
app.startServer = startServer;
app.closeResources = closeResources;

// Default export is the Express app (in-process handler).
module.exports = app;
