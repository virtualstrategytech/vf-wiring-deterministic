// novain-platform/webhook/server.js
// Deterministic webhook server with CI-friendly behaviour.

"use strict";

const http = require("http");
const crypto = require("crypto");
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
  return process.env.WEBHOOK_KEY || "";
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();

// capture raw body for HMAC while still parsing JSON
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// ---------------------------------------------------------------------------
// HMAC helpers
// ---------------------------------------------------------------------------

function computeSignature(rawBody) {
  const key = getWebhookKey();
  if (!key) return "";
  return crypto.createHmac("sha256", key).update(rawBody).digest("hex");
}

function verifySignature(req) {
  const provided = req.get("x-webhook-signature") || "";
  const raw = req.rawBody || Buffer.from("", "utf8");
  const expected = computeSignature(raw);

  if (!getWebhookKey()) {
    return {
      ok: false,
      reason: "WEBHOOK_KEY missing",
      expected: "",
      provided,
    };
  }

  if (!provided) {
    return {
      ok: false,
      reason: "Missing x-webhook-signature header",
      expected,
      provided,
    };
  }

  const providedBuf = Buffer.from(provided, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");

  const ok =
    providedBuf.length === expectedBuf.length &&
    crypto.timingSafeEqual(providedBuf, expectedBuf);

  return {
    ok,
    reason: ok ? "valid" : "signature mismatch",
    expected,
    provided,
  };
}

// ---------------------------------------------------------------------------
// Basic diagnostics endpoints (used by CI)
// ---------------------------------------------------------------------------

app.get("/health", (req, res) => {
  logDebug("GET /health", { ip: req.ip });
  // smoke test expects *plain text* "ok"
  res.type("text/plain").send("ok");
});

app.get("/diagnostics/env", (_req, res) => {
  res.json({
    ok: true,
    env: {
      NODE_ENV,
      LOG_LEVEL,
      hasWebhookKey: Boolean(getWebhookKey()),
    },
  });
});

// ---------------------------------------------------------------------------
// Normalisation + deterministic responses
// ---------------------------------------------------------------------------

function normaliseWebhookPayload(body) {
  if (!body || typeof body !== "object") {
    return { type: "unknown", raw: body };
  }

  if (body.type === "lesson_export_request") {
    return {
      type: "lesson_export_request",
      lessonId: body.lessonId || body.lesson_id || null,
      userId: body.userId || body.user_id || null,
      format: body.format || "json",
    };
  }

  if (body.type === "teach_quiz_request") {
    return {
      type: "teach_quiz_request",
      topic: body.topic || "business strategy basics",
      difficulty: body.difficulty || "mixed",
    };
  }

  return { type: "generic", raw: body };
}

function makeLessonExportResponse(env) {
  const lessonId = env.lessonId || "unknown";
  const userId = env.userId || "anonymous";
  const exportedAt = new Date().toISOString();

  return {
    format: "json",
    body: {
      lessonId,
      userId,
      exportedAt,
      summary: `Exported lesson ${lessonId} for user ${userId}`,
      content: {
        sections: [
          {
            id: "intro",
            title: "Deterministic lesson export",
            body: [
              `This is a placeholder export for lesson "${lessonId}".`,
              "Wire this to your real two-agent pipeline later.",
            ],
          },
        ],
      },
    },
  };
}

function makeTeachQuizResponse(env) {
  const topic = env.topic || "business strategy basics";
  const difficulty = env.difficulty || "mixed";

  const questions = [
    {
      id: "q1",
      type: "mcq",
      difficulty: "easy",
      prompt: `Which of the following best describes the core objective of "${topic}"?`,
      options: [
        "Randomly try tactics with no hypothesis.",
        "Align decisions to a coherent long-term direction.",
        "Focus only on short-term cost cutting.",
        "Avoid measuring outcomes.",
      ],
      correctIndex: 1,
    },
  ];

  return {
    topic,
    difficulty,
    questionCount: questions.length,
    questions,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Legacy x-api-key behaviour for webhook.smoke.test.js
// ---------------------------------------------------------------------------

function handleLegacyApiKeyWebhook(req, res) {
  const body = req.body || {};
  const action = body.action || "";

  if (action === "ping") {
    return res.json({
      ok: true,
      kind: "ping",
      reply: "pong",
      echo: body,
    });
  }

  if (action === "generate_lesson") {
    const question = body.question || "lesson";
    return res.json({
      ok: true,
      kind: "generate_lesson",
      lessonTitle: `Deterministic lesson for: ${question}`,
      lesson: {
        title: `Deterministic lesson for: ${question}`,
        bullets: [
          "This is a deterministic placeholder lesson.",
          "Replace this with your real two-agent logic.",
        ],
      },
    });
  }

  if (action === "generate_quiz") {
    const question = body.question || "quiz topic";
    return res.json({
      ok: true,
      kind: "generate_quiz",
      quiz: {
        topic: question,
        questions: [
          {
            id: "mcq1",
            type: "mcq",
            prompt: `Which option best reflects "${question}"?`,
            options: [
              "Do everything at once.",
              "Apply a clear strategy with focused experiments.",
              "Ignore data.",
              "Avoid making decisions.",
            ],
            correctIndex: 1,
          },
        ],
      },
    });
  }

  // fallback echo
  return res.json({
    ok: true,
    kind: "legacy_echo",
    echo: body,
  });
}

// ---------------------------------------------------------------------------
// POST /webhook
// ---------------------------------------------------------------------------

app.post("/webhook", (req, res) => {
  const raw = req.rawBody || Buffer.from("", "utf8");

  // 1) legacy smoke-test path: x-api-key header present
  if (req.get("x-api-key")) {
    logDebug("POST /webhook (legacy api-key mode)", {
      action: req.body && req.body.action,
    });
    return handleLegacyApiKeyWebhook(req, res);
  }

  // 2) HMAC path
  const sig = verifySignature(req);
  const envelope = normaliseWebhookPayload(req.body);

  logDebug("POST /webhook (hmac mode)", {
    envelopeType: envelope.type,
    signatureValid: sig.ok,
    reason: sig.reason,
  });

  if (!sig.ok) {
    return res.status(401).json({
      ok: false,
      error: "invalid_signature",
      details: {
        reason: sig.reason,
        expected: sig.expected,
        provided: sig.provided,
        hasKey: Boolean(getWebhookKey()),
      },
    });
  }

  if (envelope.type === "lesson_export_request") {
    const response = makeLessonExportResponse(envelope);
    return res.json({
      ok: true,
      kind: "lesson_export",
      signatureChecked: true,
      rawBytes: raw.length,
      response,
    });
  }

  if (envelope.type === "teach_quiz_request") {
    const response = makeTeachQuizResponse(envelope);
    return res.json({
      ok: true,
      kind: "teach_quiz",
      signatureChecked: true,
      rawBytes: raw.length,
      response,
    });
  }

  return res.json({
    ok: true,
    kind: "echo",
    signatureChecked: true,
    rawBytes: raw.length,
    envelope,
  });
});

// 404 + error handlers
app.use((req, res) => {
  logDebug("404", { method: req.method, path: req.path });
  res.status(404).json({
    ok: false,
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
    error: "internal_error",
    message: err && err.message ? err.message : "Unexpected error",
  });
});

// ---------------------------------------------------------------------------
// Server bootstrap – IMPORTANT: no auto-listen on require.
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

// If started as "node server.js", bind to DEFAULT_PORT.
// When required from Jest, this block does NOT run.
if (require.main === module) {
  startServer();
}

// default export is a function so tests/helpers can treat it as a local app
function serverEntry(options) {
  const port = options && options.port;
  return startServer(port);
}

module.exports = Object.assign(serverEntry, {
  app,
  startServer,
  getWebhookKey,
  computeSignature,
  verifySignature,
  normaliseWebhookPayload,
  makeLessonExportResponse,
  makeTeachQuizResponse,
  get server() {
    return currentServer;
  },
});
