"use strict";

/**
 * Test-friendly webhook server used by the Jest suites.
 *
 * Key properties:
 * - Requiring this module does NOT start an HTTP server or bind a port.
 * - When run directly (`node server.js`) it will start a server on PORT (default 3000).
 * - The `/webhook` route implements the small set of actions the tests exercise.
 */

const http = require("http");
const express = require("express");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_PORT = Number.parseInt(process.env.PORT || "3000", 10) || 3000;

function getWebhookKey() {
  return process.env.WEBHOOK_API_KEY || process.env.WEBHOOK_KEY || "";
}

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

function logDebug(msg, extra) {
  if (process.env.NODE_ENV === "test" && process.env.DEBUG_WEBHOOK !== "true") {
    // keep Jest output small in normal test runs
    return;
  }
  try {
    if (extra) {
      console.log(msg, JSON.stringify(extra));
    } else {
      console.log(msg);
    }
  } catch {
    // never let logging crash the process
  }
}

function logError(msg, extra) {
  try {
    if (extra) {
      console.error(msg, JSON.stringify(extra));
    } else {
      console.error(msg);
    }
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// LLM stub helpers
// ---------------------------------------------------------------------------

function makeStubRaw(kind, body) {
  const base = {
    kind,
    source:
      kind === "invoke_component"
        ? "invoke_component_stub"
        : kind === "generate_lesson"
          ? "lesson_stub"
          : kind === "generate_quiz"
            ? "quiz_stub"
            : "stub",
    question: body && body.question ? String(body.question) : undefined,
    tenantId: body && body.tenantId ? String(body.tenantId) : undefined,
    createdAt: new Date().toISOString(),
  };

  return base;
}

async function callPromptService(kind, body) {
  // We deliberately do NOT perform real network calls in CI. The tests only
  // care that `raw` is an object and in some cases that `raw.source` is a
  // sensible string. Always use a deterministic stub.
  return makeStubRaw(kind, body || {});
}

function logLlmPayloadSnippet(raw) {
  try {
    const snippet = JSON.stringify(raw).slice(0, 400);
    console.log("llm payload snippet:", snippet);
  } catch {
    console.log("llm payload snippet: [unserializable]");
  }
}

function closeResources() {
  try {
    const httpMod = require("http");
    const httpsMod = require("https");
    if (
      httpMod &&
      httpMod.globalAgent &&
      typeof httpMod.globalAgent.destroy === "function"
    ) {
      httpMod.globalAgent.destroy();
    }
    if (
      httpsMod &&
      httpsMod.globalAgent &&
      typeof httpsMod.globalAgent.destroy === "function"
    ) {
      httpsMod.globalAgent.destroy();
    }
  } catch {
    // best-effort only
  }
}

// ---------------------------------------------------------------------------
// Express app + middleware
// ---------------------------------------------------------------------------

const app = express();

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
// Routes
// ---------------------------------------------------------------------------

app.get("/health", (req, res) => {
  logDebug("GET /health", { ip: req.ip });
  res.type("text/plain").send("ok");
});

app.get("/diagnostics/env", (_req, res) => {
  res.json({
    ok: true,
    env: {
      NODE_ENV: process.env.NODE_ENV || "",
      DEBUG_WEBHOOK: process.env.DEBUG_WEBHOOK || "",
      hasWebhookKey: Boolean(getWebhookKey()),
      hasPromptUrl: Boolean(process.env.PROMPT_URL),
    },
  });
});

app.post("/webhook", async (req, res) => {
  const apiKeyHeader = req.get("x-api-key") || "";
  const requiredKey = getWebhookKey();

  if (requiredKey && apiKeyHeader !== requiredKey) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const body = req.body || {};
  const action = body.action || body.type || "";

  // ping --------------------------------------------------------------------
  if (action === "ping") {
    const port = Number(process.env.PORT || DEFAULT_PORT);
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

    const mirrored = {
      ok: true,
      raw,
      data: {
        raw,
      },
    };

    if (body && body.question) {
      mirrored.data.reply = `Stub response for: ${String(body.question)}`;
    }

    return res.json(mirrored);
  }

  // generate_lesson ---------------------------------------------------------
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
  if (action === "generate_quiz") {
    const raw = await callPromptService("generate_quiz", body);
    logLlmPayloadSnippet(raw);

    const question =
      body && body.question ? String(body.question) : "Quiz stub question";

    const mcq = [
      {
        id: "q1",
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

// 404 + error handlers ------------------------------------------------------

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "not_found",
    method: req.method,
    path: req.path,
  });
});

app.use((err, req, res, _next) => {
  logError("Unhandled error in request", {
    path: req && req.path,
    method: req && req.method,
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
// Server bootstrap helper
// ---------------------------------------------------------------------------

function startServer(port) {
  const listenPort = Number.parseInt(
    port != null ? String(port) : String(DEFAULT_PORT),
    10
  );

  const server = http.createServer(app);
  server.on("error", (err) => {
    logError("HTTP server error", {
      message: err && err.message,
      stack: err && err.stack,
    });
  });

  server.listen(listenPort, () => {
    logDebug("Webhook server listening", { port: listenPort });
  });

  return server;
}

// Only start the server automatically when this file is executed directly.
if (require.main === module) {
  startServer();
}

// Attach helpers expected by some tests.
app.startServer = startServer;
app.closeResources = closeResources;

// Default export is the Express app (in-process handler).
module.exports = app;
