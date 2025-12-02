// server.js
// vf-webhook-service — Voiceflow-friendly deterministic webhook
// Key goals:
// 1) NEVER crash on invalid JSON from Voiceflow variable injection
// 2) Always return HTTP 200 with a component_result so Voiceflow can route
// 3) Support base64 transport for "question" (question_encoding="base64")
// 4) Provide the exact response fields your Voiceflow capture tables expect

"use strict";

const http = require("http");
const https = require("https");
const express = require("express");

// ---------------------------------------------------------------------------
// Env + logging
// ---------------------------------------------------------------------------

const NODE_ENV = process.env.NODE_ENV || "local";
const LOG_LEVEL = (process.env.LOG_LEVEL || "info").toLowerCase();
const PORT = Number.parseInt(process.env.PORT || "3000", 10);

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

function debug(msg, extra) {
  if (LOG_LEVEL === "debug") log("debug", msg, extra);
}

function getWebhookKey() {
  // Support both names; Voiceflow uses WEBHOOK_API_KEY in your screenshots
  return process.env.WEBHOOK_API_KEY || process.env.WEBHOOK_KEY || "";
}

function closeResources() {
  try {
    if (http?.globalAgent?.destroy) http.globalAgent.destroy();
    if (https?.globalAgent?.destroy) https.globalAgent.destroy();
  } catch {
    // best effort
  }
}

// ---------------------------------------------------------------------------
// Body parsing: accept ANY content-type as text, then parse ourselves.
// This avoids Express throwing SyntaxError before your route runs.
// ---------------------------------------------------------------------------

const app = express();

app.use(
  express.text({
    type: "*/*",
    limit: "2mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf; // if you later add signatures/HMAC
    },
  })
);

function parseIncoming(req) {
  // express.text() gives us a string (or undefined)
  const raw = typeof req.body === "string" ? req.body : "";
  const trimmed = raw.trim();

  if (!trimmed) return { body: {}, raw, parseError: null };

  try {
    const body = JSON.parse(trimmed);
    return { body, raw, parseError: null };
  } catch (err) {
    return {
      body: {},
      raw,
      parseError: {
        message: err?.message || "Invalid JSON",
      },
    };
  }
}

function normalizeWhitespace(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim();
}

function ensureQuestionMark(s) {
  const t = normalizeWhitespace(s);
  if (!t) return "";
  if (t.endsWith("?")) return t;
  // If it ends with a period/exclamation, replace with '?', else append '?'
  if (/[.!]$/.test(t)) return t.slice(0, -1) + "?";
  return t + "?";
}

function tryDecodeBase64(maybeB64) {
  try {
    return Buffer.from(String(maybeB64 || ""), "base64").toString("utf8");
  } catch {
    return String(maybeB64 || "");
  }
}

// Derive the user question from multiple possible fields
function getInboundQuestion(body) {
  // Your Voiceflow variants:
  // - /optimize_question uses last_utterance
  // - /webhook optimize_question uses question
  const q =
    body.question ??
    body.last_utterance ??
    body.lastUtterance ??
    body.unoptimized_question ??
    "";

  const enc = String(body.question_encoding || "").toLowerCase();
  if (enc === "base64") return tryDecodeBase64(q);
  return String(q || "");
}

function okFailPayload(message, extra) {
  // IMPORTANT: return 200 and let Voiceflow route on component_result
  return {
    ok: false,
    API_OK: false,
    component_result: "api_failed",
    agent_reply: message || "API failed.",
    clarify_reason: "api_failed",
    needs_clarify: false,
    clarify_question: "",
    ...(extra || {}),
  };
}

function optimizeQuestionPayload(body) {
  const decoded = getInboundQuestion(body);
  const trimmed = normalizeWhitespace(decoded);

  const debug_trace = "optimize_question_stub_v1";

  // Defaults (your Voiceflow capture table includes these keys)
  let component_result = "success";
  let needs_clarify = false;
  let clarify_reason = "";
  let clarify_question = "";
  let optimized_question = "";
  let agent_reply = "";

  if (!trimmed || trimmed.length < 10) {
    component_result = "needs_clarify";
    needs_clarify = true;
    clarify_reason = "too_short_or_empty";
    clarify_question =
      "Quick check—can you restate your question in one clear sentence, with a bit more detail?";
    agent_reply = clarify_question;
    optimized_question = trimmed; // keep for debugging
  } else {
    component_result = "success";
    optimized_question = ensureQuestionMark(trimmed);
    agent_reply =
      "Got it — I’ll turn this into a clean lesson and (optionally) a quiz.";
  }

  return {
    ok: true,
    API_OK: true,
    component_result,
    debug_trace,
    optimized_question,
    agent_reply,

    // fields your Voiceflow API block is capturing
    needs_clarify,
    clarify_reason,
    clarify_question,
  };
}

function generateLessonPayload(body) {
  const question =
    normalizeWhitespace(getInboundQuestion(body)) || "your question";
  const tenantId = String(body.tenantId || "novain_default");

  // Schema aligned with your mapping doc (lessonTitle, bulletCount, lesson, reply)
  const lesson = {
    title: `Clarify Ambiguity with the SPQA Frame`,
    objectives: [
      "Restate the situation and problem clearly",
      "Identify the top questions that unblock action",
      "Define one SPQA-aligned next step",
    ],
    content: [
      `We’ll apply SPQA (Situation → Problem → Questions → Actions) to:`,
      `"${question}"`,
      "",
      "1) Situation: what’s the context, who’s involved, what constraints matter?",
      "2) Problem: what breaks or stays stuck if nothing changes?",
      "3) Questions: the 2–4 unknowns that unlock action.",
      "4) Actions: the next 48 hours + next 2 weeks.",
    ].join("\n"),
    keyTakeaways: [
      "Ambiguity usually hides missing questions.",
      "SPQA = Situation, Problem, Questions, Actions.",
      "Good strategy ends in time-bound actions.",
    ],
    references: [{ label: "SPQA explainer", url: "https://example.com/spqa" }],
    meta: {
      question,
      tenantId,
      createdBy: "novain.business.agent",
      createdAt: new Date().toISOString(),
    },
  };

  return {
    ok: true,
    reply: "Lesson ready.",
    lessonTitle: lesson.title,
    bulletCount: lesson.keyTakeaways.length,
    lesson,
  };
}

function safeJsonParse(maybeJson) {
  if (!maybeJson) return null;
  if (typeof maybeJson === "object") return maybeJson;
  if (typeof maybeJson !== "string") return null;
  const t = maybeJson.trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function generateQuizPayload(body) {
  const question =
    normalizeWhitespace(getInboundQuestion(body)) || "your question";

  // Voiceflow often passes lesson as a JSON string from the previous step
  const lessonObj =
    safeJsonParse(body.lesson) ||
    safeJsonParse(body.API_Lesson_JSON) ||
    body.lesson ||
    {};

  const lessonTitle =
    normalizeWhitespace(lessonObj?.title) ||
    "Clarify Ambiguity with the SPQA Frame";

  const takeaways = Array.isArray(lessonObj?.keyTakeaways)
    ? lessonObj.keyTakeaways.map((x) => normalizeWhitespace(x)).filter(Boolean)
    : [];

  const topTakeaway =
    takeaways[0] ||
    "Use SPQA to clarify situation, problem, questions, and actions.";

  const promptLesson = {
    strategySummary: topTakeaway,
    promptPrinciples: [
      `Reference the framework "${lessonTitle}" explicitly.`,
      "Ask clarifying questions before generating outputs.",
      "State constraints (time, audience, resources).",
      "Specify output format (bullets, table, steps).",
      "Add a critique/refinement pass for quality.",
    ],
    demonstrationPrompts: [
      {
        label: "Single-shot",
        style: "single-shot",
        prompt: `You are a strategy coach. Using "${lessonTitle}", answer: "${question}". Output: SPQA + a 48-hour action plan.`,
      },
      {
        label: "Few-shot",
        style: "few-shot",
        prompt: `Key takeaways: ${takeaways.slice(0, 3).join(" | ") || topTakeaway}\nNow produce a prompt that gathers context then outputs SPQA + recommendations for: "${question}".`,
      },
      {
        label: "Refinement",
        style: "refinement",
        prompt: `Critique this prompt for clarity, constraints, and measurability. Then propose a tighter version.\nPROMPT: (paste prompt here)`,
      },
    ],
    applicationChecklist: [
      "Is the Situation explicit?",
      "Is the Problem measurable?",
      "Are the key Questions listed?",
      "Is the Action clear within 48 hours?",
    ],
    meta: { sourceLessonTitle: lessonTitle, question },
  };

  const quiz = {
    mcq: [
      {
        id: "mcq1",
        q: "In SPQA, what comes after Problem?",
        choices: ["Action", "Question", "Scope", "Answer"],
        answer: "B",
        explain: "SPQA = Situation, Problem, Questions, Actions.",
      },
      {
        id: "mcq2",
        q: "When turning a business lesson into a prompt, what should you do first?",
        choices: [
          "Set temperature",
          "Restate situation + problem",
          "Ask for a 50-page report",
          "Skip constraints",
        ],
        answer: "B",
        explain: "Clarity on situation/problem comes before everything else.",
      },
      {
        id: "mcq3",
        q: "Which makes prompts more reliable?",
        choices: [
          "Vague instructions",
          "No output format",
          "Structure + constraints + explicit output format",
          "Rely on defaults",
        ],
        answer: "C",
        explain: "Structure reduces ambiguity and boosts usability.",
      },
    ],
    tf: [
      {
        id: "tf1",
        q: "Refinement/critique loops usually improve complex outputs.",
        answer: true,
        explain: "Iteration reveals gaps and improves quality.",
      },
      {
        id: "tf2",
        q: "You should skip clarifying questions to move faster.",
        answer: false,
        explain: "Clarifying questions prevent rework and wrong answers.",
      },
    ],
    open: [
      {
        id: "open1",
        q: `Rewrite your question using SPQA and propose one 48-hour action.`,
        rubric: [
          "Situation restated",
          "Problem measurable",
          "Questions listed",
          "Action within 48 hours",
        ],
      },
    ],
  };

  return {
    ok: true,
    reply: "Your prompt lesson and quiz are ready.",
    lessonTitle,
    mcqCount: quiz.mcq.length,
    tfCount: quiz.tf.length,
    openCount: quiz.open.length,
    promptLesson,
    quiz,
  };
}

function retrievePayload(body) {
  const tenantId = String(body.tenantId || "novain_default");
  const hitCount = 3; // deterministic stub
  return {
    ok: true,
    reply: `Found ${hitCount} passages.`,
    hitCount,
    tenantId,
  };
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

app.get("/health", (_req, res) => {
  res.type("text/plain").send("ok");
});

app.get("/diagnostics/env", (_req, res) => {
  res.json({
    ok: true,
    env: {
      NODE_ENV,
      LOG_LEVEL,
      port: PORT,
      hasWebhookKey: Boolean(getWebhookKey()),
    },
  });
});

// ---------------------------------------------------------------------------
// Auth middleware for POST endpoints
// ---------------------------------------------------------------------------

function requireApiKey(req, res) {
  const required = getWebhookKey();
  if (!required) return true; // allow if unset (local/dev)

  const got = req.get("x-api-key") || "";
  if (got !== required) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Voiceflow C_OptimizeQuestion → POST /optimize_question
app.post("/optimize_question", (req, res) => {
  if (!requireApiKey(req, res)) return;

  const { body, raw, parseError } = parseIncoming(req);
  if (parseError) {
    log("error", "Invalid JSON on /optimize_question", {
      message: parseError.message,
      rawSnippet: raw.slice(0, 240),
    });
    return res.status(200).json(
      okFailPayload(
        "Your request body was not valid JSON (likely unescaped quotes/newlines).",
        {
          debug_trace: "optimize_question_invalid_json",
        }
      )
    );
  }

  return res.status(200).json(optimizeQuestionPayload(body));
});

// Main router → POST /webhook with { action: "..." }
app.post("/webhook", (req, res) => {
  if (!requireApiKey(req, res)) return;

  const { body, raw, parseError } = parseIncoming(req);

  if (parseError) {
    log("error", "Invalid JSON on /webhook", {
      message: parseError.message,
      rawSnippet: raw.slice(0, 240),
    });
    return res.status(200).json(
      okFailPayload(
        "Your request body was not valid JSON (likely unescaped quotes/newlines).",
        {
          debug_trace: "webhook_invalid_json",
        }
      )
    );
  }

  const action = String(body.action || body.type || "").trim();

  // Ping (used by smoke tests)
  if (action === "ping") {
    return res.status(200).json({ ok: true, reply: "pong", port: PORT });
  }

  if (action === "optimize_question") {
    return res.status(200).json(optimizeQuestionPayload(body));
  }

  if (action === "generate_lesson") {
    return res.status(200).json(generateLessonPayload(body));
  }

  if (action === "generate_quiz") {
    return res.status(200).json(generateQuizPayload(body));
  }

  if (action === "retrieve") {
    return res.status(200).json(retrievePayload(body));
  }

  if (action === "export_lesson") {
    return res
      .status(200)
      .json({ ok: true, reply: "Lesson export stub – not implemented yet." });
  }

  // Unknown action -> still 200 so Voiceflow doesn’t hard-fail
  return res.status(200).json(
    okFailPayload(`Unknown action: ${action || "(missing)"}`, {
      debug_trace: "unknown_action",
    })
  );
});

// Optional convenience endpoint (if you ever call it directly)
app.post("/teach_and_quiz", (req, res) => {
  if (!requireApiKey(req, res)) return;

  const { body, raw, parseError } = parseIncoming(req);
  if (parseError) {
    log("error", "Invalid JSON on /teach_and_quiz", {
      message: parseError.message,
      rawSnippet: raw.slice(0, 240),
    });
    return res.status(200).json(
      okFailPayload("Your request body was not valid JSON.", {
        debug_trace: "teach_and_quiz_invalid_json",
      })
    );
  }

  const lesson = generateLessonPayload(body);
  const quiz = generateQuizPayload({ ...body, lesson: lesson.lesson });

  return res.status(200).json({
    ok: true,
    reply: "Teach & Quiz ready.",
    lessonTitle: lesson.lessonTitle,
    lesson: lesson.lesson,
    promptLesson: quiz.promptLesson,
    quiz: quiz.quiz,
    mcqCount: quiz.mcqCount,
    tfCount: quiz.tfCount,
    openCount: quiz.openCount,
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const server = app.listen(PORT, () => {
  log("info", "Webhook server listening", { port: PORT });
  debug("Webhook server listening (debug)", { port: PORT });
});

process.on("SIGTERM", () => {
  try {
    server.close(() => {
      closeResources();
      process.exit(0);
    });
  } catch {
    process.exit(0);
  }
});

process.on("SIGINT", () => {
  try {
    server.close(() => {
      closeResources();
      process.exit(0);
    });
  } catch {
    process.exit(0);
  }
});
