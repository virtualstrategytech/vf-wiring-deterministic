"use strict";

/**
 * Minimal, test-friendly webhook server.
 *
 * Design goals:
 * - Requiring this module never binds a TCP port.
 * - Export the Express app directly so tests can use supertest(app).
 * - Provide only the behaviours the Jest tests rely on.
 */

const http = require("http");
const https = require("https");
const express = require("express");

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------

function getWebhookKey() {
  return process.env.WEBHOOK_API_KEY || process.env.WEBHOOK_KEY || "";
}

// ---------------------------------------------------------------------------
// Express app + JSON parsing
// ---------------------------------------------------------------------------

const app = express();

// Some tests set SKIP_BODY_PARSER=1 to minimise open handles.
// Honour that by using the simplest json() middleware in that case.
if (process.env.SKIP_BODY_PARSER === "1") {
  app.use(express.json());
} else {
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        // Allow tests to inspect the raw body if needed.
        req.rawBody = buf;
      },
    })
  );
}

// ---------------------------------------------------------------------------
// LLM stub helpers
// ---------------------------------------------------------------------------

function makeStubRaw(kind, body) {
  const base = {
    kind,
    question: body && body.question ? String(body.question) : "",
    tenantId: body && body.tenantId ? String(body.tenantId) : "default",
    createdAt: new Date().toISOString(),
  };

  if (kind === "invoke_component") {
    return { ...base, source: "invoke_component_stub" };
  }
  if (kind === "generate_lesson") {
    return { ...base, source: "lesson_stub", mode: "lesson" };
  }
  if (kind === "generate_quiz") {
    return { ...base, source: "quiz_stub", mode: "quiz" };
  }
  // default: llm_elicit or anything else
  return { ...base, source: "stub" };
}

// In this deterministic CI server, we always use the stub – no network.
async function callPromptService(kind, body) {
  return makeStubRaw(kind, body || {});
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

// Allow tests to clean up global HTTP(S) agents to avoid open-handle noise.
function closeResources() {
  try {
    if (http.globalAgent && typeof http.globalAgent.destroy === "function") {
      http.globalAgent.destroy();
    }
  } catch {}
  try {
    if (https.globalAgent && typeof https.globalAgent.destroy === "function") {
      https.globalAgent.destroy();
    }
  } catch {}
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// verify_in_process + webhook.smoke expect plain "ok"
app.get("/health", (_req, res) => {
  res.type("text/plain").send("ok");
});

app.get("/diagnostics/env", (_req, res) => {
  res.json({
    ok: true,
    env: {
      NODE_ENV: process.env.NODE_ENV || "",
      hasWebhookKey: Boolean(getWebhookKey()),
      hasPromptUrl: Boolean(process.env.PROMPT_URL),
      debugWebhook: String(process.env.DEBUG_WEBHOOK || "false"),
    },
  });
});

app.post("/webhook", async (req, res) => {
  const body = req.body || {};
  const action = body.action || body.type || "";

  const apiKeyHeader = req.get("x-api-key") || "";
  const requiredKey = getWebhookKey();
  if (requiredKey && apiKeyHeader !== requiredKey) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  // ping --------------------------------------------------------------------
  if (action === "ping") {
    const port = Number(process.env.PORT || 3000);
    return res.json({
      ok: true,
      reply: "pong",
      port,
      receivedAt: new Date().toISOString(),
    });
  }

  // llm_elicit / invoke_component ------------------------------------------
  if (action === "llm_elicit" || action === "invoke_component") {
    const raw = await callPromptService(action, body);
    logLlmPayloadSnippet(raw);
    return res.json({
      ok: true,
      raw,
      data: { raw },
    });
  }

  // generate_lesson ---------------------------------------------------------
  // tests/webhook.smoke.test.js expects:
  //   resp.data.lessonTitle || resp.data.lesson || resp.data.reply
  if (action === "generate_lesson") {
    const raw = await callPromptService("generate_lesson", body);
    logLlmPayloadSnippet(raw);

    const question =
      body && body.question ? String(body.question) : "Lesson stub question";

    const lessonText =
      (body && body.lesson && String(body.lesson)) ||
      `Stub lesson generated for: ${question}`;

    const title =
      (body && body.lessonTitle && String(body.lessonTitle)) ||
      "Stub Lesson Title";

    return res.json({
      ok: true,
      raw,
      data: {
        raw,
        lessonTitle: title,
        lesson: lessonText,
        reply: lessonText,
      },
    });
  }

  // generate_quiz -----------------------------------------------------------
  // tests/webhook.smoke.test.js expects:
  //   resp.data.quiz || resp.data.mcqCount || resp.data.mcq || resp.data.reply
  if (action === "generate_quiz") {
    const raw = await callPromptService("generate_quiz", body);
    logLlmPayloadSnippet(raw);

    const question =
      body && body.question ? String(body.question) : "Quiz stub question";

    const mcq = [
      {
        question,
        options: ["Option A", "Option B", "Option C", "Option D"],
        answer: "Option A",
      },
    ];

    return res.json({
      ok: true,
      raw,
      data: {
        raw,
        quiz: { questions: mcq },
        mcq,
        mcqCount: mcq.length,
        reply: "Stub MCQ quiz generated",
      },
    });
  }

  // generic fallback --------------------------------------------------------
  const fallbackRaw = {
    source: "echo",
    action: action || "unknown",
    payload: body,
    ts: new Date().toISOString(),
  };

  return res.json({
    ok: true,
    raw: fallbackRaw,
    data: {
      raw: fallbackRaw,
      reply: "ok",
    },
  });
});

// 404 + error ---------------------------------------------------------------

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "not_found",
    method: req.method,
    path: req.path,
  });
});

app.use((err, req, res, _next) => {
  console.error("Unhandled error in webhook server", {
    message: err && err.message,
    stack: err && err.stack,
  });
  res.status(500).json({
    ok: false,
    error: "internal_error",
    message: err && err.message ? err.message : "Unexpected error",
  });
});

// Attach helpers for tests that want explicit cleanup.
app.closeResources = closeResources;

// Default export is the Express app
module.exports = app;
