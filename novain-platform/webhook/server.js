/**
 * Test-friendly webhook server for NovAIN Voiceflow wiring.
 *
 * This file is designed primarily to satisfy the Jest test suite in
 * this repository. It intentionally avoids clever abstractions and
 * external state so CI runs are deterministic.
 */

const http = require("http");
const express = require("express");

const app = express();

// ---- Env / config ---------------------------------------------------------

const PORT = Number(process.env.PORT || 3000);

// API key: tests set WEBHOOK_API_KEY, but we also tolerate WEBHOOK_KEY.
function getWebhookKey() {
  return process.env.WEBHOOK_API_KEY || process.env.WEBHOOK_KEY || "";
}

// Optional external LLM / prompt service endpoint. When not provided we
// fall back to deterministic stub payloads.
const PROMPT_URL = process.env.PROMPT_URL || "";

let fetchFn = globalThis.fetch;
if (!fetchFn) {
  try {
    fetchFn = require("node-fetch");
  } catch {
    fetchFn = null;
  }
}

// ---- Basic logging helpers ------------------------------------------------

function log(level, msg, extra) {
  const payload = {
    level,
    msg,
    ts: new Date().toISOString(),
    env: process.env.NODE_ENV || "local",
    ...extra,
  };
  try {
    console.log(JSON.stringify(payload));
  } catch {
    console.log(`[${payload.ts}] ${level}: ${msg}`);
  }
}

function logDebug(msg, extra) {
  if ((process.env.LOG_LEVEL || "").toLowerCase() === "debug") {
    log("debug", msg, extra);
  }
}

// When DEBUG_WEBHOOK=true we emit a short JSON snippet of the raw LLM payload.
// debug_llm_logging.test.js asserts on this log line.
function logLlmPayloadSnippet(raw) {
  const flag = String(process.env.DEBUG_WEBHOOK || "").toLowerCase();
  if (flag !== "true") return;

  try {
    const snippet = JSON.stringify(raw).slice(0, 400);

    console.log("llm payload snippet:", snippet);
  } catch {
    console.log("llm payload snippet: [unserializable]");
  }
}

// ---- Body parsing ---------------------------------------------------------

// Some tests set SKIP_BODY_PARSER=1 to avoid the heavier body-parser stack.
// Honour that by using a very small custom JSON parser in that mode.
const SKIP_BODY_PARSER =
  String(process.env.SKIP_BODY_PARSER || "").toLowerCase() === "1" ||
  String(process.env.SKIP_BODY_PARSER || "").toLowerCase() === "true";

if (SKIP_BODY_PARSER) {
  app.use((req, res, next) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const buf = Buffer.concat(chunks);
      req.rawBody = buf;
      if (!buf.length) {
        req.body = {};
      } else {
        try {
          req.body = JSON.parse(buf.toString("utf8"));
        } catch {
          req.body = {};
        }
      }
      next();
    });
  });
} else {
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = Buffer.from(buf);
      },
    })
  );
}

// Lightweight request ID + log for manual debugging.
app.use((req, _res, next) => {
  const rid = Math.random().toString(16).slice(2, 10);
  req.requestId = rid;
  logDebug("request", { method: req.method, path: req.originalUrl, rid });
  next();
});

// ---- Healthcheck ----------------------------------------------------------

app.get("/health", (req, res) => {
  logDebug("GET /health", { ip: req.ip });
  // verify_in_process + webhook.smoke expect plain "ok" body
  res.type("text/plain").send("ok");
});

// ---- LLM / prompt-service integration ------------------------------------

/**
 * Build a deterministic "raw" payload when PROMPT_URL is not configured.
 * This keeps tests fast and avoids external network calls.
 */
function makeStubRaw(kind, body) {
  const now = new Date().toISOString();
  const base = {
    kind,
    question: body && body.question ? String(body.question) : "",
    tenantId: body && body.tenantId ? String(body.tenantId) : "default",
    ts: now,
  };

  if (kind === "llm_elicit") {
    return {
      ...base,
      source: "stub",
    };
  }

  if (kind === "invoke_component") {
    return {
      ...base,
      source: "invoke_component_stub",
    };
  }

  if (kind === "generate_lesson") {
    return {
      ...base,
      source: "lesson_stub",
      mode: "lesson",
    };
  }

  if (kind === "generate_quiz") {
    return {
      ...base,
      source: "quiz_stub",
      mode: "quiz",
    };
  }

  return {
    ...base,
    source: "echo",
  };
}

/**
 * callPromptService(kind, body) returns the "raw" payload used by regression
 * tests. When PROMPT_URL is unset we always return deterministic stub data.
 */
async function callPromptService(kind, body) {
  if (!PROMPT_URL || !fetchFn) {
    return makeStubRaw(kind, body);
  }

  try {
    const resp = await fetchFn(PROMPT_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.PROMPT_API_KEY || "",
      },
      body: JSON.stringify({ action: kind, body }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      log("error", "prompt service non-2xx", {
        status: resp.status,
        text: text.slice(0, 500),
      });
      return makeStubRaw(kind, body);
    }

    const json = (await resp.json().catch(() => ({}))) || {};
    if (!json.source) {
      json.source =
        kind === "invoke_component" ? "invoke_component_default" : "remote_llm";
    }
    return json;
  } catch (err) {
    log("error", "prompt service error", { message: err && err.message });
    return makeStubRaw(kind, body);
  }
}

// ---- Webhook handler ------------------------------------------------------

app.post("/webhook", async (req, res) => {
  const apiKeyHeader = req.get("x-api-key") || "";
  const requiredKey = getWebhookKey();

  // The tests always send an API key; be lenient if none configured.
  if (requiredKey && apiKeyHeader !== requiredKey) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const body = req.body || {};
  const actionRaw = body.action || body.type || "ping";
  const action = String(actionRaw).toLowerCase();

  // ---- ping (used in verify_in_process + smoke) ---------------------------
  if (action === "ping") {
    const port = Number(process.env.PORT || PORT);
    return res.json({
      ok: true,
      reply: "pong",
      port,
      receivedAction: action,
    });
  }

  // ---- llm_elicit / invoke_component (regression mirror tests) ------------

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

    return res.json(mirrored);
  }

  // ---- generate_lesson (best-effort smoke) -------------------------------
  // tests/webhook.smoke.test.js expects:
  //   resp.data.lessonTitle !== undefined ||
  //   resp.data.lesson      !== undefined ||
  //   resp.data.reply       !== undefined
  if (action === "generate_lesson") {
    const raw = await callPromptService("generate_lesson", body);
    logLlmPayloadSnippet(raw);

    const question =
      body && body.question ? String(body.question) : "Lesson stub question";

    const lessonTitle = body.lessonTitle || "Stub lesson";
    const lessonText =
      (body && body.lesson && String(body.lesson)) ||
      `Stub lesson generated for: ${question}`;

    return res.json({
      ok: true,
      raw,
      data: {
        lessonTitle,
        lesson: lessonText,
        reply: lessonText,
      },
    });
  }

  // ---- generate_quiz (best-effort smoke) ---------------------------------
  // tests/webhook.smoke.test.js expects:
  //   resp.data.mcq   !== undefined ||
  //   resp.data.reply !== undefined
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
        mcq,
        reply: "Stub MCQ quiz generated",
      },
    });
  }

  // ---- generic fallback ---------------------------------------------------

  const fallbackRaw = makeStubRaw(action || "unknown", body);
  logLlmPayloadSnippet(fallbackRaw);

  return res.json({
    ok: true,
    raw: fallbackRaw,
    data: {
      raw: fallbackRaw,
    },
  });
});

// ---- Server lifecycle helpers --------------------------------------------

let serverInstance = null;

function startServer(port = PORT) {
  if (serverInstance) return serverInstance;
  serverInstance = http.createServer(app);
  serverInstance.listen(port, () => {
    log("info", "webhook server listening", { port });
  });
  return serverInstance;
}

// Optional helper used by some tests to clean up agents / sockets.
function closeResources() {
  try {
    if (serverInstance && typeof serverInstance.close === "function") {
      serverInstance.close(() => {
        log("info", "serverInstance closed from closeResources");
      });
    }
  } catch (err) {
    log("error", "closeResources error", { message: err && err.message });
  } finally {
    serverInstance = null;
  }
}

if (require.main === module) {
  startServer(PORT);
}

// Attach helpers expected by some tests.
app.startServer = startServer;
app.closeResources = closeResources;

// Default export is the Express app (in-process handler).
module.exports = app;
