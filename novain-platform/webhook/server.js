/**
 * Deterministic webhook server for VST Novian Voiceflow wiring.
 *
 * Goals:
 * - Be boring and predictable.
 * - Provide very explicit logging for CI and manual debugging.
 * - Expose a small set of test / diagnostics endpoints that do NOT depend
 *   on any external services so that CI can reliably validate process wiring.
 *
 * This file is intentionally self-contained: no transpilation, no framework
 * beyond Express, no dynamic imports, and no clever abstractions.
 */

const http = require("http");
const crypto = require("crypto");
const express = require("express");

// ---------------------------------------------------------------------------
// Environment and configuration helpers
// ---------------------------------------------------------------------------

/**
 * Required env vars for *production* webhook usage. The CI diagnostic runs are
 * intentionally able to pass even if these are missing, as long as the
 * "basic" server wiring works. The tests that rely on the webhook key will
 * explicitly check behaviour when it is absent.
 */
const REQUIRED_ENV_FOR_WEBHOOK = ["WEBHOOK_KEY"];

/**
 * Optional env vars:
 * - PORT: which port to listen on (default 3000).
 * - LOG_LEVEL: "debug" for very verbose output, anything else for normal.
 * - NODE_ENV: used only for labelling logs.
 */
const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const NODE_ENV = process.env.NODE_ENV || "local";

/**
 * Basic structured logger. This keeps logs machine-parseable for CI while
 * still being readable by humans.
 */
function log(level, message, extra) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    env: NODE_ENV,
    msg: message,
    ...(extra || {}),
  };
  // Log as single-line JSON so GitHub actions and other systems can parse it.
  console.log(JSON.stringify(payload));
}

function logDebug(message, extra) {
  if (LOG_LEVEL === "debug") {
    log("debug", message, extra);
  }
}

function validateEnv(requiredKeys) {
  const missing = [];
  for (const key of requiredKeys) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }
  if (missing.length > 0) {
    return {
      ok: false,
      missing,
    };
  }
  return { ok: true, missing: [] };
}

/**
 * We intentionally read the webhook key via a function instead of capturing it
 * at module load time so that tests can override process.env in-process and
 * observe changes.
 */
function getWebhookKey() {
  return process.env.WEBHOOK_KEY || "";
}

// ---------------------------------------------------------------------------
// Express app setup
// ---------------------------------------------------------------------------

const app = express();

// Capture raw body for signature verification while still letting Express
// parse JSON for normal handlers.
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

/**
 * Compute an HMAC SHA-256 hex digest of the raw request body using the current
 * webhook key.
 */
function computeSignature(rawBody) {
  const key = getWebhookKey();
  if (!key) return "";
  return crypto.createHmac("sha256", key).update(rawBody).digest("hex");
}

/**
 * Validates the signature from the "x-webhook-signature" header against the
 * raw request body. Returns a boolean and a diagnostic description.
 */
function verifySignature(req) {
  const provided = req.get("x-webhook-signature") || "";
  const raw = req.rawBody || Buffer.from("", "utf8");
  const expected = computeSignature(raw);

  if (!getWebhookKey()) {
    return {
      ok: false,
      reason: "WEBHOOK_KEY missing in environment",
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

  const equal =
    providedBuf.length === expectedBuf.length &&
    crypto.timingSafeEqual(providedBuf, expectedBuf);

  return {
    ok: equal,
    reason: equal ? "valid" : "signature mismatch",
    expected,
    provided,
  };
}

// ---------------------------------------------------------------------------
// Basic / health endpoints used by CI
// ---------------------------------------------------------------------------

/**
 * Simple ping endpoint: used by CI smoke tests to verify that the process
 * started, Express bound to a port, and routes are registered.
 */
app.get("/health", (req, res) => {
  logDebug("GET /health", {
    ip: req.ip,
    userAgent: req.get("user-agent") || "",
  });

  res.json({
    ok: true,
    status: "healthy",
    env: NODE_ENV,
    port: PORT,
    now: new Date().toISOString(),
  });
});

/**
 * Returns the current environment configuration relevant to this server.
 * Sensitive values are not returned; presence is indicated instead.
 *
 * This is mainly for CI diagnostics and should not be exposed publicly in
 * production without additional authentication.
 */
app.get("/diagnostics/env", (req, res) => {
  const requiredCheck = validateEnv(REQUIRED_ENV_FOR_WEBHOOK);

  const snapshot = {
    NODE_ENV,
    PORT,
    LOG_LEVEL,
    requiredEnv: {
      ok: requiredCheck.ok,
      missing: requiredCheck.missing,
    },
    hasWebhookKey: Boolean(getWebhookKey()),
  };

  logDebug("GET /diagnostics/env", snapshot);

  res.json({
    ok: true,
    env: snapshot,
  });
});

/**
 * Endpoint that intentionally delays response. This allows CI to verify that
 * long-running requests are handled correctly and that timeouts are only
 * applied where expected.
 */
app.get("/diagnostics/timeout", async (req, res) => {
  const delayMs = Number.parseInt(req.query.ms || "1000", 10);
  const capped = Number.isFinite(delayMs)
    ? Math.max(0, Math.min(delayMs, 30_000))
    : 1000;

  logDebug("GET /diagnostics/timeout begin", { delayMs: capped });

  await new Promise((resolve) => setTimeout(resolve, capped));

  logDebug("GET /diagnostics/timeout end", { delayMs: capped });

  res.json({
    ok: true,
    waitedMs: capped,
  });
});

/**
 * Endpoint that triggers an unhandled rejection to verify that the global
 * process handler works and that CI can collect logs.
 */
app.get("/diagnostics/unhandled-rejection", (req, res) => {
  log("warn", "Triggering unhandled rejection for diagnostics");
  // Intentionally forget to `catch`.
  new Promise((_resolve, reject) => {
    reject(new Error("Intentional unhandled rejection (diagnostics)"));
  });

  res.json({
    ok: true,
    triggered: "unhandled-rejection",
  });
});

/**
 * Endpoint that forces the process to exit with a non-zero code, to confirm
 * that CI detects the failure and that logs are flushed first.
 */
app.get("/diagnostics/exit", (req, res) => {
  const code = Number.parseInt(req.query.code || "1", 10) || 1;
  log("warn", "Diagnostics exit requested", { code });

  res.json({
    ok: false,
    exiting: true,
    code,
  });

  // Give the response a chance to flush.
  setTimeout(() => {
    process.exit(code);
  }, 50);
});

// ---------------------------------------------------------------------------
// Webhook handling (core behaviour used by Voiceflow / other callers)
// ---------------------------------------------------------------------------

/**
 * Shared function to normalise incoming webhook payloads. Voiceflow or other
 * callers can send arbitrary JSON; for now we simply echo back structured
 * data, but the handler is written so you can plug in your real logic later.
 */
function normaliseWebhookPayload(body) {
  if (!body || typeof body !== "object") {
    return { type: "unknown", raw: body };
  }

  // Recognise a couple of shapes we expect to see.
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
      topic: body.topic || "",
      difficulty: body.difficulty || "mixed",
      attemptsAllowed:
        typeof body.attemptsAllowed === "number"
          ? body.attemptsAllowed
          : undefined,
    };
  }

  // Fall-through: treat as opaque envelope.
  return { type: "generic", raw: body };
}

/**
 * Example transformation logic for a "lesson export" style payload. This is
 * intentionally simple and deterministic; you can later replace this with RAG
 * lookups, agent collaboration, etc.
 */
function makeLessonExportResponse(envelope) {
  const lessonId = envelope.lessonId || "unknown";
  const userId = envelope.userId || "anonymous";
  const format = envelope.format || "json";

  const base = {
    lessonId,
    userId,
    exportedAt: new Date().toISOString(),
    summary: `Exported lesson ${lessonId} for user ${userId}`,
    content: {
      sections: [
        {
          id: "intro",
          title: "Lesson export (deterministic stub)",
          body: [
            `This is a deterministic placeholder export for lesson "${lessonId}".`,
            "You can replace this implementation with your real export logic.",
          ],
        },
        {
          id: "next-steps",
          title: "Next steps",
          body: [
            "Wire this endpoint to your two-agent pipeline (business + prompt).",
            "Persist exports to your knowledge base or deliver them to the user.",
          ],
        },
      ],
    },
  };

  if (format === "markdown") {
    const lines = [];
    lines.push(`# Lesson export: ${lessonId}`);
    lines.push("");
    lines.push(`- User: \`${userId}\``);
    lines.push(`- Exported at: \`${base.exportedAt}\``);
    lines.push("");
    for (const section of base.content.sections) {
      lines.push(`## ${section.title}`);
      lines.push("");
      for (const para of section.body) {
        lines.push(para);
        lines.push("");
      }
    }
    return {
      format: "markdown",
      body: lines.join("\n"),
    };
  }

  return {
    format: "json",
    body: base,
  };
}

/**
 * Example transformation logic for a "teach & quiz" style payload. This
 * returns deterministic questions so CI can perform golden-file testing.
 */
function makeTeachQuizResponse(envelope) {
  const topic = envelope.topic || "business strategy basics";
  const difficulty = envelope.difficulty || "mixed";

  const questions = [
    {
      id: "q1",
      type: "mcq",
      difficulty: "easy",
      prompt: `Which of the following best describes the core objective of "${topic}"?`,
      options: [
        "Randomly experiment with tactics without a hypothesis.",
        "Align resources and decisions to a coherent long-term direction.",
        "Focus exclusively on short-term cost cutting.",
        "Avoid measuring outcomes to preserve optionality.",
      ],
      correctIndex: 1,
    },
    {
      id: "q2",
      type: "open",
      difficulty: "medium",
      prompt:
        "Describe a simple experiment you could run this week to test one assumption in your current strategy.",
    },
  ];

  const filtered =
    difficulty === "easy" || difficulty === "hard"
      ? questions.filter((q) => q.difficulty === difficulty)
      : questions;

  return {
    topic,
    difficulty,
    questionCount: filtered.length,
    questions: filtered,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * POST /webhook
 *
 * This is the main webhook entry point. It performs:
 * - Signature verification (if WEBHOOK_KEY is present).
 * - Deterministic request classification.
 * - Deterministic response generation.
 */
app.post("/webhook", (req, res) => {
  const raw = req.rawBody || Buffer.from("", "utf8");

  const sigResult = verifySignature(req);

  const envelope = normaliseWebhookPayload(req.body);

  logDebug("POST /webhook received", {
    envelopeType: envelope.type,
    signatureValid: sigResult.ok,
    signatureReason: sigResult.reason,
  });

  if (!sigResult.ok) {
    // For now we return 401 instead of 500 so callers can distinguish
    // authentication misconfiguration from internal errors.
    return res.status(401).json({
      ok: false,
      error: "invalid_signature",
      details: {
        reason: sigResult.reason,
        // Do not echo expected signature in production; this is mainly for CI.
        expected: sigResult.expected,
        provided: sigResult.provided,
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

  // Generic echo response for unknown shapes.
  return res.json({
    ok: true,
    kind: "echo",
    signatureChecked: true,
    rawBytes: raw.length,
    envelope,
  });
});

// ---------------------------------------------------------------------------
// Fallback 404 handler (keep it JSON and explicit)
// ---------------------------------------------------------------------------

app.use((req, res) => {
  logDebug("404 handler", { method: req.method, path: req.path });
  res.status(404).json({
    ok: false,
    error: "not_found",
    method: req.method,
    path: req.path,
  });
});

// ---------------------------------------------------------------------------
// Error handler (last middleware)
// ---------------------------------------------------------------------------

app.use((err, req, res, _next) => {
  log("error", "Unhandled error in request pipeline", {
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
// HTTP server bootstrap
// ---------------------------------------------------------------------------

const server = http.createServer(app);

server.listen(PORT, () => {
  log("info", "Webhook server listening", { port: PORT, env: NODE_ENV });
});

server.on("error", (error) => {
  log("error", "HTTP server error", {
    message: error.message,
    stack: error.stack,
  });
});

// ---------------------------------------------------------------------------
// Process-level diagnostics
// ---------------------------------------------------------------------------

process.on("uncaughtException", (err) => {
  log("error", "Uncaught exception", {
    message: err && err.message,
    stack: err && err.stack,
  });
});

process.on("unhandledRejection", (reason) => {
  log("error", "Unhandled promise rejection", {
    reason:
      reason instanceof Error
        ? { message: reason.message, stack: reason.stack }
        : { raw: String(reason) },
  });
});

process.on("SIGTERM", () => {
  log("info", "SIGTERM received, shutting down gracefully");
  server.close(() => {
    log("info", "HTTP server closed after SIGTERM");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  log("info", "SIGINT received, shutting down gracefully");
  server.close(() => {
    log("info", "HTTP server closed after SIGINT");
    process.exit(0);
  });
});
module.exports = {
  app,
  server,
  getWebhookKey,
  computeSignature,
  verifySignature,
  normaliseWebhookPayload,
  makeLessonExportResponse,
  makeTeachQuizResponse,
};
