"use strict";

/**
 * Minimal, deterministic webhook server for CI tests.
 *
 * - Exports an Express app (for in-process tests).
 * - Provides a startServer(port?) helper for child-process mode.
 * - Handles ping, llm_elicit, invoke_component, generate_lesson, generate_quiz.
 * - Never talks to real external services; all responses are stubs.
 */

const http = require("http");
const https = require("https");
const express = require("express");

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------

function getWebhookKey() {
  // All tests use WEBHOOK_API_KEY / WEBHOOK_KEY + x-api-key, not HMAC.
  return process.env.WEBHOOK_API_KEY || process.env.WEBHOOK_KEY || "test123";
}

// ---------------------------------------------------------------------------
// Express app + JSON parsing
// ---------------------------------------------------------------------------

const app = express();

// For Jest detectOpenHandles the tests sometimes set SKIP_BODY_PARSER=1.
if (process.env.SKIP_BODY_PARSER === "1") {
  app.use(express.json());
} else {
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );
}

// ---------------------------------------------------------------------------
// Stub helpers (no real network)
// ---------------------------------------------------------------------------

function makeStubRaw(kind, body) {
  const now = new Date().toISOString();
  const base = {
    kind,
    question: body && body.question ? String(body.question) : "",
    tenantId: body && body.tenantId ? String(body.tenantId) : "default",
    createdAt: now,
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

  // default / llm_elicit
  return { ...base, source: "stub" };
}

// Deterministic: never actually calls out to a prompt service.
async function callPromptService(kind, body) {
  return makeStubRaw(kind, body || {});
}

function logLlmPayloadSnippet(raw) {
  if (String(process.env.DEBUG_WEBHOOK || "").toLowerCase() !== "true") return;
  try {
    const snippet = JSON.stringify(raw).slice(0, 400);
    console.log("llm payload snippet:", snippet);
  } catch {
    console.log("llm payload snippet: [unserializable]");
  }
}

// Allow tests to close shared agents to avoid open-handle noise.
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

// /health: used by globalSetup + smoke tests
app.get("/health", (_req, res) => {
  res.type("text/plain").send("ok");
});

// Simple diagnostics used only for manual debugging
app.get("/diagnostics/env", (_req, res) => {
  res.json({
    ok: true,
    env: {
      NODE_ENV: process.env.NODE_ENV || "",
      hasWebhookKey: Boolean(getWebhookKey()),
      debugWebhook: String(process.env.DEBUG_WEBHOOK || "false"),
      useChildProcessServer: String(
        process.env.USE_CHILD_PROCESS_SERVER || "0"
      ),
    },
  });
});

app.post("/webhook", async (req, res) => {
  const body = req.body || {};
  const action = body.action || body.type || "";

  const apiKeyHeader = req.get("x-api-key") || "";
  const requiredKey = getWebhookKey();

  // Be lenient: if caller supplies an x-api-key and we have an expected key,
  // require them to match; otherwise skip auth (tests always send the right key).
  if (
    requiredKey &&
    apiKeyHeader &&
    apiKeyHeader.toString() !== requiredKey.toString()
  ) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  // ---- ping (used by smoke + verify_in_process) ---------------------------
  if (action === "ping") {
    const port = Number(process.env.PORT || 3000);
    return res.json({
      ok: true,
      reply: "pong",
      port,
      receivedAt: new Date().toISOString(),
    });
  }

  // ---- llm_elicit / invoke_component (regression mirror + stubs) ----------
  if (action === "llm_elicit" || action === "invoke_component") {
    const raw = await callPromptService(action, body);
    logLlmPayloadSnippet(raw);
    return res.json({
      ok: true,
      raw,
      data: { raw },
    });
  }

  // ---- generate_lesson (best-effort smoke) --------------------------------
  // tests/webhook.smoke.test.js expects:
  //   resp.data.lesson !== undefined || resp.data.reply !== undefined
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
        // reply as a fallback so the OR condition always passes
        reply: lessonText,
      },
    });
  }

  // ---- generate_quiz (best-effort smoke) ----------------------------------
  // tests/webhook.smoke.test.js expects:
  //   resp.data.quiz/mcq/mcqCount or resp.data.reply to be defined
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

  // ---- generic fallback ---------------------------------------------------
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

// 404 + error handlers kept simple and JSON-only
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

// ---------------------------------------------------------------------------
// startServer helper and CLI entrypoint
// ---------------------------------------------------------------------------

function startServer(port) {
  const listenPort = Number(port || process.env.PORT || 3000);
  const server = http.createServer(app);
  server.listen(listenPort, () => {
    console.log("webhook server listening", { port: listenPort });
  });
  return server;
}

// When run directly: `node novain-platform/webhook/server.js`
if (require.main === module) {
  startServer();
}

// Attach helpers for tests
app.startServer = startServer;
app.closeResources = closeResources;

// Default export is the Express app
module.exports = app;
