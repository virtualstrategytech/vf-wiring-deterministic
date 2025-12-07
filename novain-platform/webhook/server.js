/**
 * vf-webhook-service server.js
 *
 * Goals:
 * - Deterministic, Voiceflow-safe responses (no random crashes on upstream failures)
 * - UPSTREAM_TIMEOUT_MS via AbortController
 * - UPSTREAM_MAX_RETRIES + UPSTREAM_RETRY_BASE_MS exponential backoff
 *   - retry only on 429 / 5xx
 * - Optional per-endpoint upstream URL overrides (future-proofing)
 *
 * Environment variables (recommended):
 *   WEBHOOK_API_KEY            (required in prod; client sends header x-api-key)
 *   NODE_ENV                   ("production" / "development")
 *
 *   OPENAI_API_KEY             (optional if you want local generation/grading)
 *   OPENAI_MODEL               (default: gpt-4o-mini)
 *
 *   UPSTREAM_TIMEOUT_MS        (default: 12000)
 *   UPSTREAM_MAX_RETRIES       (default: 2)
 *   UPSTREAM_RETRY_BASE_MS     (default: 350)
 *
 *   UPSTREAM_ENABLED           ("true"/"false", default false)
 *   BUSINESS_URL               (optional base upstream)
 *   PROMPT_URL                 (optional base upstream)
 *   RETRIEVAL_URL              (optional base upstream)
 *
 *   Per-endpoint overrides (optional):
 *     UPSTREAM_URL_OPTIMIZE_QUESTION
 *     UPSTREAM_URL_TEACH_AND_QUIZ
 *     UPSTREAM_URL_GENERATE_LESSON
 *     UPSTREAM_URL_PROMPT_LESSON
 *     UPSTREAM_URL_GENERATE_EXAM
 *     UPSTREAM_URL_GRADE_OPEN
 *
 *   DEBUG_WEBHOOK / DEBUG_WEBHOOK_ENABLED ("true"/"false", default false)
 */

"use strict";

const express = require("express");

const NODE_ENV = (process.env.NODE_ENV || "development").toLowerCase();
const IS_PROD = NODE_ENV === "production";

const WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY || "";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const UPSTREAM_TIMEOUT_MS = parseInt(
  process.env.UPSTREAM_TIMEOUT_MS || "12000",
  10
);
const UPSTREAM_MAX_RETRIES = parseInt(
  process.env.UPSTREAM_MAX_RETRIES || "2",
  10
);
const UPSTREAM_RETRY_BASE_MS = parseInt(
  process.env.UPSTREAM_RETRY_BASE_MS || "350",
  10
);

const UPSTREAM_ENABLED =
  String(process.env.UPSTREAM_ENABLED || "false").toLowerCase() === "true";

const BUSINESS_URL = (process.env.BUSINESS_URL || "").trim();
const PROMPT_URL = (process.env.PROMPT_URL || "").trim();
const RETRIEVAL_URL = (process.env.RETRIEVAL_URL || "").trim();

const DEBUG_WEBHOOK =
  String(
    process.env.DEBUG_WEBHOOK || process.env.DEBUG_WEBHOOK_ENABLED || "false"
  ).toLowerCase() === "true";

// -------------------------
// Logging
// -------------------------

function log(level, msg, extra) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    env: NODE_ENV,
    msg,
    ...(extra && typeof extra === "object" ? extra : {}),
  };
  console.log(JSON.stringify(payload));
}

function logLlmPayloadSnippet(obj) {
  if (!DEBUG_WEBHOOK) return;
  try {
    const snippet = JSON.stringify(obj || {}).slice(0, 2000);
    console.error(`llm payload snippet: ${snippet}`);
  } catch {
    // ignore
  }
}

// -------------------------
// App
// -------------------------

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

// -------------------------
// Auth middleware
// -------------------------

function requireApiKey(req, res, next) {
  if (req.path === "/health" || req.path === "/") return next();

  // In non-prod without a key, allow all (for local dev)
  if (!IS_PROD && !WEBHOOK_API_KEY) return next();

  if (!WEBHOOK_API_KEY) {
    return res.status(401).json({
      ok: false,
      API_OK: false,
      component_result: "fail",
      error: "WEBHOOK_API_KEY is not configured on the server",
    });
  }

  const provided =
    req.get("x-api-key") || req.get("X-API-Key") || req.get("X-API-KEY") || "";
  if (provided !== WEBHOOK_API_KEY) {
    return res.status(401).json({
      ok: false,
      API_OK: false,
      component_result: "fail",
      error: "unauthorized",
    });
  }

  return next();
}

app.use(requireApiKey);

// -------------------------
// Helpers: timing, retry, HTTP
// -------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampNumber(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function shouldRetryStatus(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    return resp;
  } finally {
    clearTimeout(t);
  }
}

async function fetchWithRetry(
  url,
  options,
  { timeoutMs = 12000, maxRetries = 2, baseMs = 350 } = {}
) {
  const retryMax = clampNumber(maxRetries, 0, 10);
  const base = clampNumber(baseMs, 50, 5000);

  for (let attempt = 0; attempt <= retryMax; attempt++) {
    let resp;
    let text = "";

    try {
      resp = await fetchWithTimeout(url, options, timeoutMs);
      text = await resp.text();

      if (resp.ok) {
        return { ok: true, status: resp.status, text, headers: resp.headers };
      }

      if (shouldRetryStatus(resp.status) && attempt < retryMax) {
        const backoff = Math.min(base * Math.pow(2, attempt), 8000);
        log("warn", "Upstream non-2xx; retrying", {
          url,
          status: resp.status,
          attempt,
          backoff_ms: backoff,
        });
        await sleep(backoff);
        continue;
      }

      return { ok: false, status: resp.status, text };
    } catch (err) {
      if (attempt < retryMax) {
        const backoff = Math.min(base * Math.pow(2, attempt), 8000);
        log("warn", "Upstream fetch error; retrying", {
          url,
          attempt,
          backoff_ms: backoff,
          error: String(err?.message || err),
        });
        await sleep(backoff);
        continue;
      }
      return {
        ok: false,
        status: 0,
        text: "",
        error: String(err?.message || err),
      };
    }
  }

  return { ok: false, status: 0, text: "", error: "retry_exhausted" };
}

function normalizeBaseUrl(base) {
  const s = (base || "").trim();
  if (!s) return "";
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

function getUpstreamOverride(name) {
  return (process.env[name] || "").trim();
}

function upstreamUrlFor(endpointName) {
  // EndpointName is one of:
  // OPTIMIZE_QUESTION, TEACH_AND_QUIZ, GENERATE_LESSON, PROMPT_LESSON, GENERATE_EXAM, GRADE_OPEN, LLM_ELICIT, RETRIEVAL
  const override = getUpstreamOverride(`UPSTREAM_URL_${endpointName}`);
  if (override) return override;

  // Fallback heuristics: use PROMPT_URL / BUSINESS_URL / RETRIEVAL_URL if present.
  const p = normalizeBaseUrl(PROMPT_URL);
  const b = normalizeBaseUrl(BUSINESS_URL);
  const r = normalizeBaseUrl(RETRIEVAL_URL);

  switch (endpointName) {
    case "PROMPT_LESSON":
      return p ? `${p}/prompt_lesson` : "";
    case "GRADE_OPEN":
      return p ? `${p}/grade_open` : "";
    case "LLM_ELICIT":
      // CI expects stub when PROMPT_URL is not set; leaving blank will force stub path.
      return p ? `${p}/llm_elicit` : "";
    case "OPTIMIZE_QUESTION":
      return b ? `${b}/optimize_question` : "";
    case "TEACH_AND_QUIZ":
      return b ? `${b}/teach_and_quiz` : "";
    case "GENERATE_LESSON":
      return b ? `${b}/generate_lesson` : "";
    case "GENERATE_EXAM":
      return b ? `${b}/generate_exam` : "";
    case "RETRIEVAL":
      return r ? `${r}/retrieve` : "";
    default:
      return "";
  }
}

// -------------------------
// OpenAI (local generation/grading) with the SAME retry policy
// -------------------------

async function openaiChat(
  messages,
  { temperature = 0.1, maxTokens = 900 } = {}
) {
  if (!OPENAI_API_KEY) {
    return { ok: false, status: 0, error: "OPENAI_API_KEY not set" };
  }

  const body = {
    model: OPENAI_MODEL,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  const resp = await fetchWithRetry(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    {
      timeoutMs: UPSTREAM_TIMEOUT_MS,
      maxRetries: UPSTREAM_MAX_RETRIES,
      baseMs: UPSTREAM_RETRY_BASE_MS,
    }
  );

  if (!resp.ok) {
    return {
      ok: false,
      status: resp.status || 0,
      error: resp.text || resp.error || "openai_failed",
    };
  }

  try {
    const data = JSON.parse(resp.text || "{}");
    const content =
      data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || "";
    return { ok: true, status: resp.status, data, content };
  } catch {
    return { ok: false, status: resp.status, error: "openai_bad_json" };
  }
}

// -------------------------
// Deterministic Voiceflow-safe envelopes
// -------------------------

function okEnvelope(extra = {}) {
  return {
    ok: true,
    API_OK: true,
    component_result: "success",
    ...extra,
  };
}

function failEnvelope(extra = {}) {
  return {
    ok: false,
    API_OK: false,
    component_result: "fail",
    ...extra,
  };
}

// -------------------------
// Contract normalization
// -------------------------

function pickFirstString(...vals) {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function inferReply(out) {
  if (!out || typeof out !== "object") return "ok";

  const candidates = [
    out.reply,
    out.API_Response,
    out.optimized_question,
    out.API_Optimized_Question,
    out.API_OptimizedQuestion,
    out.API_OptimizedQuestion_Display,
    out.API_Lesson_Display,
    out.API_Lesson,
    out.API_PromptLesson,
    out.API_PromptLesson_Display,
    out.lessonTitle,
    out.API_LessonTitle,
    out.result,
    out.message,
  ];

  const r = pickFirstString(...candidates);
  return r || "ok";
}

function ensureContract(req, payload, actionHint) {
  const out =
    payload && typeof payload === "object" ? { ...payload } : { ok: true };

  if (out.ok === true && typeof out.API_OK !== "boolean") out.API_OK = true;
  if (out.ok !== true && typeof out.API_OK !== "boolean") out.API_OK = false;
  if (!out.component_result)
    out.component_result = out.ok === true ? "success" : "fail";

  const localPort =
    req && req.socket && typeof req.socket.localPort === "number"
      ? req.socket.localPort
      : 0;
  if (typeof out.port !== "number") out.port = localPort;

  if (typeof out.reply !== "string" || !out.reply.trim())
    out.reply = inferReply(out);

  let raw = out.raw || (out.data && out.data.raw) || null;
  if (!raw || typeof raw !== "object") {
    raw = {
      source: out.source || "local",
      action: out.action || actionHint || "unknown",
      payload: (req && req.body) || null,
      ts: new Date().toISOString(),
    };
  } else {
    if (!raw.source) raw.source = out.source || "local";
    if (!raw.action) raw.action = out.action || actionHint || "unknown";
    if (!raw.ts) raw.ts = new Date().toISOString();
  }

  out.raw = raw;
  out.data = {
    ...(out.data && typeof out.data === "object" ? out.data : {}),
    raw,
  };

  if (!out.source && raw.source) out.source = raw.source;

  return out;
}

// -------------------------
// Deterministic stubs
// -------------------------

function truncate(s, max = 900) {
  if (!s || typeof s !== "string") return "";
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}

function stubText(kind) {
  if (kind === "lesson_business") {
    return [
      "Business strategy lesson (stub):",
      "1) Clarify the objective and constraints.",
      "2) Identify stakeholders and success metrics.",
      "3) Generate options and evaluate tradeoffs.",
      "4) Recommend a path with rationale and risks.",
      "5) Outline a simple plan and next steps.",
    ].join("\n");
  }

  if (kind === "lesson_prompt") {
    return [
      "Prompt engineering lesson (stub):",
      "1) Role: specify who the model is.",
      "2) Context: what’s known/unknown.",
      "3) Constraints: time, scope, format.",
      "4) Output format: headings/bullets/tables.",
      "5) Ask clarifying questions if missing info.",
    ].join("\n");
  }

  if (kind === "optimize_question") {
    return "Please restate your question with: objective, scope, constraints, and desired output format.";
  }

  return "ok";
}

function stubQuizExam(mode) {
  const m = (mode || "business").toString().toLowerCase();

  if (m === "prompt") {
    return {
      question: "Which prompt element most improves reliability?",
      options: [
        "More exclamation points",
        "Explicit role + constraints + output format",
        "Avoid specifying requirements",
        "Use only emojis",
      ],
      answer: "Explicit role + constraints + output format",
      explanation:
        "Clear role, constraints, and output format reduce ambiguity and improve consistency.",
    };
  }

  return {
    question: "What is the best first step in strategy work?",
    options: [
      "Pick a solution immediately",
      "Clarify goals and success metrics",
      "Build slides",
      "Hire more people",
    ],
    answer: "Clarify goals and success metrics",
    explanation:
      "A clear objective and metrics guide all downstream decisions.",
  };
}

function jsonOrNull(s) {
  try {
    if (!s || typeof s !== "string") return null;
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function safeMode(input) {
  const m = (input?.mode || input?.learning_mode || "business")
    .toString()
    .trim()
    .toLowerCase();
  return m === "prompt" ? "prompt" : "business";
}

function safeQuestion(input) {
  return pickFirstString(
    input?.confirmed_question,
    input?.question_for_api,
    input?.question,
    input?.user_question,
    input?.open_question
  );
}

// -------------------------
// Upstream proxy helper
// -------------------------

async function maybeProxy(endpointName, payload) {
  if (!UPSTREAM_ENABLED) return { proxied: false };

  const url = upstreamUrlFor(endpointName);
  if (!url) return { proxied: false };

  const resp = await fetchWithRetry(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    },
    {
      timeoutMs: UPSTREAM_TIMEOUT_MS,
      maxRetries: UPSTREAM_MAX_RETRIES,
      baseMs: UPSTREAM_RETRY_BASE_MS,
    }
  );

  if (!resp.ok) {
    log("warn", "Upstream call failed (non-2xx)", {
      endpointName,
      url,
      status: resp.status,
      text: truncate(resp.text || resp.error || "", 600),
    });
    return {
      proxied: true,
      ok: false,
      status: resp.status,
      text: resp.text,
      error: resp.error,
    };
  }

  let data = null;
  try {
    data = JSON.parse(resp.text || "{}");
  } catch {
    data = null;
  }

  return {
    proxied: true,
    ok: true,
    status: resp.status,
    data,
    text: resp.text,
  };
}

// -------------------------
// Core functions
// -------------------------

async function optimizeQuestion(input) {
  const question = safeQuestion(input);
  const mode = safeMode(input);

  const prox = await maybeProxy("OPTIMIZE_QUESTION", { question, mode });
  if (prox.proxied && prox.ok) {
    const out = prox.data || {};
    const optimized =
      pickFirstString(
        out.optimized_question,
        out.optimized,
        out.question,
        out.result
      ) ||
      prox.text ||
      stubText("optimize_question");

    return okEnvelope({
      source: "upstream_optimize_question",
      optimized_question: optimized,
      API_OptimizedQuestion: optimized,
      upstream_status: prox.status,
    });
  }

  const oa = await openaiChat(
    [
      {
        role: "system",
        content:
          "You are a senior strategy consultant. Rewrite the user question into a clearer, more actionable version. Keep it concise.",
      },
      { role: "user", content: question || "Optimize this question." },
    ],
    { temperature: 0.1, maxTokens: 250 }
  );

  if (!oa.ok) {
    const stub = stubText("optimize_question");
    return okEnvelope({
      source: "optimize_stub",
      optimized_question: stub,
      API_OptimizedQuestion: stub,
      upstream_status: oa.status || 429,
      upstream_error: oa.error || "openai_failed",
    });
  }

  const optimized = (oa.content || "").trim() || stubText("optimize_question");
  return okEnvelope({
    source: "optimize_local",
    optimized_question: optimized,
    API_OptimizedQuestion: optimized,
  });
}

async function generateLesson(input) {
  const mode = safeMode(input);
  const question = safeQuestion(input);

  const tenantId = pickFirstString(
    input?.tenantId,
    input?.tenant_id,
    "novain_default"
  );
  const firstName = pickFirstString(input?.first_name, input?.firstName, "");
  const sessionId = pickFirstString(input?.session_id, input?.sessionId, "");
  const userId = pickFirstString(input?.user_id, input?.userId, "");

  function asJsonString(obj) {
    try {
      return JSON.stringify(obj || {});
    } catch {
      return "{}";
    }
  }

  function normalizeLessonFromUpstream(
    out,
    fallbackTitle,
    fallbackReply,
    fallbackMode
  ) {
    // Accept a few common shapes.
    const title =
      pickFirstString(out.lessonTitle, out.API_LessonTitle, out.title) ||
      fallbackTitle;
    const reply =
      pickFirstString(out.reply, out.API_Response, out.response) ||
      fallbackReply ||
      inferReply(out);

    // lesson may arrive as stringified JSON, or as an object, or absent.
    let lessonStr = "";
    if (typeof out.lesson === "string") lessonStr = out.lesson;
    else if (out.lesson && typeof out.lesson === "object")
      lessonStr = asJsonString(out.lesson);
    else if (typeof out.API_Lesson_JSON === "string")
      lessonStr = out.API_Lesson_JSON;
    else if (out.API_Lesson_JSON && typeof out.API_Lesson_JSON === "object")
      lessonStr = asJsonString(out.API_Lesson_JSON);
    else lessonStr = "";

    // If it's not JSON, wrap it.
    let parsed = null;
    try {
      parsed = lessonStr ? JSON.parse(lessonStr) : null;
    } catch {
      parsed = null;
    }

    const bullets = Array.isArray(out.bullets)
      ? out.bullets
      : Array.isArray(parsed?.bullets)
        ? parsed.bullets
        : [];

    const lessonObj =
      parsed && typeof parsed === "object"
        ? {
            ...parsed,
            mode: fallbackMode,
            title: parsed.title || title,
            reply: parsed.reply || reply,
          }
        : { mode: fallbackMode, title, bullets, reply };

    lessonStr = lessonStr && parsed ? lessonStr : asJsonString(lessonObj);

    const bulletCount =
      typeof out.bulletCount === "number"
        ? out.bulletCount
        : Array.isArray(lessonObj.bullets)
          ? lessonObj.bullets.length
          : 5;

    return {
      title,
      reply,
      bullets: lessonObj.bullets || [],
      bulletCount,
      lessonStr,
      lessonObj,
    };
  }

  function makeStubLesson(stubKind, lessonTitle, forcedMode) {
    const stub = stubText(stubKind);
    const lines = stub
      .split("\n")
      .slice(1)
      .map((x) => String(x || "").trim())
      .filter(Boolean);

    const m =
      forcedMode || (stubKind === "lesson_prompt" ? "prompt" : "business");
    const reply =
      m === "prompt"
        ? `🤖 Here’s a prompt-engineering lesson grounded on your topic: "${question}".`
        : `Here’s a business strategy lesson for: "${question}".`;

    const lessonObj = { mode: m, title: lessonTitle, bullets: lines, reply };
    const lessonStr = asJsonString(lessonObj);
    return {
      title: lessonTitle,
      reply,
      bullets: lines,
      bulletCount: lines.length,
      lessonStr,
      lessonObj,
    };
  }

  async function getBusinessBaseline() {
    // 1) Prefer upstream /generate_lesson if enabled
    const prox = await maybeProxy("GENERATE_LESSON", {
      mode: "business",
      question,
      tenantId,
      first_name: firstName,
      session_id: sessionId,
      user_id: userId,
    });

    if (prox.proxied && prox.ok) {
      const out = prox.data || {};
      const norm = normalizeLessonFromUpstream(
        out,
        "📘 Business Strategy Lesson",
        out.reply,
        "business"
      );
      return {
        ...norm,
        upstream_status: prox.status,
        source: "upstream_generate_lesson",
      };
    }

    // 2) Local OpenAI business baseline (strict JSON)
    const sys = [
      "You are a senior strategy consultant.",
      "Return STRICT JSON ONLY (no markdown, no commentary).",
      'Schema: {"title": string, "bullets": string[], "reply": string}.',
      "Teach: objective, assumptions, 2–3 options, recommendation, risks, next steps.",
    ].join("\n");

    const oa = await openaiChat(
      [
        { role: "system", content: sys },
        {
          role: "user",
          content: question || "Generate a business strategy lesson.",
        },
      ],
      { temperature: 0.15, maxTokens: 900 }
    );

    if (!oa.ok) {
      const stub = makeStubLesson(
        "lesson_business",
        "📘 Business Strategy Lesson",
        "business"
      );
      return {
        ...stub,
        upstream_status: oa.status || 429,
        source: "generate_lesson_stub",
      };
    }

    let parsed = null;
    try {
      parsed = JSON.parse((oa.content || "").trim());
    } catch {
      parsed = null;
    }

    const title = (parsed?.title || "📘 Business Strategy Lesson")
      .toString()
      .trim();
    const bullets = Array.isArray(parsed?.bullets)
      ? parsed.bullets.map((x) => String(x || "").trim()).filter(Boolean)
      : [];
    const reply =
      (parsed?.reply || "").toString().trim() ||
      `Here’s a business strategy lesson for: "${question}".`;

    const lessonObj = { mode: "business", title, bullets, reply };
    return {
      title,
      bullets,
      reply,
      bulletCount: bullets.length || 5,
      lessonObj,
      lessonStr: asJsonString(lessonObj),
      source: "generate_lesson_local",
    };
  }

  async function getPromptLessonFromBusiness(biz) {
    // If there is an upstream prompt agent, prefer it.
    const prox = await maybeProxy("PROMPT_LESSON", {
      mode: "prompt",
      question,
      tenantId,
      first_name: firstName,
      session_id: sessionId,
      user_id: userId,
      business_baseline: biz?.lessonStr || "",
      business_lessonTitle: biz?.title || "",
      business_bullets: Array.isArray(biz?.bullets) ? biz.bullets : [],
      business_reply: biz?.reply || "",
    });

    if (prox.proxied && prox.ok) {
      const out = prox.data || {};
      // Many prompt-agent endpoints return plain text; wrap if needed.
      const promptText =
        pickFirstString(
          out.prompt_lesson,
          out.API_PromptLesson,
          out.lesson,
          out.reply
        ) || "";

      if (
        out.title ||
        out.lessonTitle ||
        out.API_LessonTitle ||
        out.API_Lesson_JSON ||
        out.lesson
      ) {
        const norm = normalizeLessonFromUpstream(
          out,
          "🤖 Prompt Engineering Lesson",
          promptText || out.reply,
          "prompt"
        );
        return {
          ...norm,
          upstream_status: prox.status,
          source: "upstream_prompt_lesson",
        };
      }

      const bullets = promptText
        .split("\n")
        .map((x) => String(x || "").trim())
        .filter(Boolean)
        .slice(0, 8);

      const title = "🤖 Prompt Engineering Lesson";
      const reply =
        promptText ||
        `🤖 Here’s a prompt lesson grounded on the business baseline for: "${question}".`;
      const lessonObj = { mode: "prompt", title, bullets, reply };
      return {
        title,
        bullets,
        reply,
        bulletCount: bullets.length || 5,
        lessonObj,
        lessonStr: asJsonString(lessonObj),
        source: "upstream_prompt_lesson",
        upstream_status: prox.status,
      };
    }

    // Local OpenAI prompt lesson grounded in business baseline
    const sys = [
      "You are a senior prompt engineer collaborating with a business strategy expert.",
      "Return STRICT JSON ONLY (no markdown, no commentary).",
      'Schema: {"title": string, "bullets": string[], "reply": string}.',
      "The reply must include prompt advice lines prefixed with 🤖.",
      "Teach: role, context, constraints, output format, and 2 examples.",
      "You MUST ground the prompt advice in the business strategy lesson context provided.",
    ].join("\n");

    const contextBlob = asJsonString({
      business_title: biz?.title || "",
      business_bullets: Array.isArray(biz?.bullets) ? biz.bullets : [],
      business_reply: biz?.reply || "",
    });

    const user = [
      `User question/topic: ${question || ""}`,
      "",
      "Business Strategy Lesson Context (from Agent 1):",
      contextBlob,
      "",
      "Now produce the Prompt Engineering lesson that helps the user get the best AI output for THIS business context.",
    ].join("\n");

    const oa = await openaiChat(
      [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      { temperature: 0.15, maxTokens: 950 }
    );

    if (!oa.ok) {
      // Deterministic, client-demo-safe stub grounded on biz title
      const lessonTitle = "🤖 Prompt Engineering Lesson";
      const stubLines = [
        `🤖 Role: You are a senior strategy consultant.`,
        `🤖 Context: Use the business baseline titled "${(biz?.title || "Business Lesson").slice(0, 80)}".`,
        "🤖 Constraints: specify timeframe, budget, audience, and format.",
        "🤖 Output format: force sections + bullets + a KPI table.",
        "🤖 Verification: ask for assumptions, risks, and next steps.",
      ];
      const reply = `🤖 Here’s a prompt lesson grounded on the business baseline for: "${question}".`;
      const lessonObj = {
        mode: "prompt",
        title: lessonTitle,
        bullets: stubLines,
        reply,
      };
      return {
        title: lessonTitle,
        bullets: stubLines,
        reply,
        bulletCount: stubLines.length,
        lessonObj,
        lessonStr: asJsonString(lessonObj),
        source: "generate_lesson_stub",
        upstream_status: oa.status || 429,
      };
    }

    let parsed = null;
    try {
      parsed = JSON.parse((oa.content || "").trim());
    } catch {
      parsed = null;
    }

    const title = (parsed?.title || "🤖 Prompt Engineering Lesson")
      .toString()
      .trim();
    const bullets = Array.isArray(parsed?.bullets)
      ? parsed.bullets.map((x) => String(x || "").trim()).filter(Boolean)
      : [];
    const reply =
      (parsed?.reply || "").toString().trim() ||
      `🤖 Here’s a prompt lesson grounded on the business baseline for: "${question}".`;

    const lessonObj = { mode: "prompt", title, bullets, reply };
    return {
      title,
      bullets,
      reply,
      bulletCount: bullets.length || 5,
      lessonObj,
      lessonStr: asJsonString(lessonObj),
      source: "generate_lesson_local",
    };
  }

  // ---- Mode routing ----
  if (mode !== "prompt") {
    const biz = await getBusinessBaseline();
    return okEnvelope({
      source: biz.source || "generate_lesson_local",
      tenantId,
      session_id: sessionId,
      user_id: userId,
      mode: "business",
      bulletCount: biz.bulletCount,
      lesson: biz.lessonStr,
      lessonTitle: biz.title,
      reply: biz.reply,
      API_Response: biz.reply,
      API_LessonTitle: biz.title,
      API_Lesson_JSON: biz.lessonStr,
      upstream_status: biz.upstream_status,
    });
  }

  // Prompt mode: Agent 1 baseline -> Agent 2 prompt lesson grounded on baseline
  const biz = await getBusinessBaseline();
  const prompt = await getPromptLessonFromBusiness(biz);

  return okEnvelope({
    source: prompt.source || "generate_lesson_local",
    tenantId,
    session_id: sessionId,
    user_id: userId,
    mode: "prompt",
    bulletCount: prompt.bulletCount,
    lesson: prompt.lessonStr,
    lessonTitle: prompt.title,
    reply: prompt.reply,
    API_Response: prompt.reply,
    API_LessonTitle: prompt.title,
    API_Lesson_JSON: prompt.lessonStr,
    // helpful extras for VF (optional)
    business_baseline: biz.lessonStr,
    business_lessonTitle: biz.title,
    upstream_status: prompt.upstream_status || biz.upstream_status,
  });
}

async function promptLesson(input) {
  const question = safeQuestion(input);
  const goal = pickFirstString(input?.goal, input?.objective, "");

  const prox = await maybeProxy("PROMPT_LESSON", { question, goal });
  if (prox.proxied && prox.ok) {
    const out = prox.data || {};
    const text =
      pickFirstString(out.prompt_lesson, out.lesson, out.result) ||
      prox.text ||
      stubText("lesson_prompt");

    return okEnvelope({
      source: "upstream_prompt_lesson",
      API_PromptLesson: text,
      API_PromptLesson_JSON: JSON.stringify({ text }),
      prompt_lesson: text,
      upstream_status: prox.status,
    });
  }

  const sys =
    "You are a senior prompt engineer teaching prompt patterns. Create a concise lesson with: role, context, constraints, output format, clarifying questions, and examples.";

  const oa = await openaiChat(
    [
      { role: "system", content: sys },
      {
        role: "user",
        content: question || "Generate a prompt engineering lesson.",
      },
    ],
    { temperature: 0.15, maxTokens: 900 }
  );

  if (!oa.ok) {
    const stub = stubText("lesson_prompt");
    return okEnvelope({
      source: "prompt_lesson_stub",
      API_PromptLesson: stub,
      API_PromptLesson_JSON: JSON.stringify({ text: stub }),
      prompt_lesson: stub,
      upstream_status: oa.status || 429,
      upstream_error: oa.error || "openai_failed",
    });
  }

  const text = (oa.content || "").trim() || stubText("lesson_prompt");
  return okEnvelope({
    source: "prompt_lesson_local",
    API_PromptLesson: text,
    API_PromptLesson_JSON: JSON.stringify({ text }),
    prompt_lesson: text,
  });
}

async function generateExam(input) {
  const mode = safeMode(input);
  const question = safeQuestion(input);

  const prox = await maybeProxy("GENERATE_EXAM", { mode, question });
  if (prox.proxied && prox.ok) {
    const out = prox.data || {};
    const exam =
      out.exam ||
      jsonOrNull(out.API_Exam_JSON) ||
      out.API_Exam ||
      stubQuizExam(mode);

    return okEnvelope({
      source: "upstream_generate_exam",
      API_Exam_JSON: typeof exam === "string" ? exam : JSON.stringify(exam),
      exam,
      upstream_status: prox.status,
    });
  }

  return okEnvelope({
    source: "generate_exam_stub",
    API_Exam_JSON: JSON.stringify(stubQuizExam(mode)),
    exam: stubQuizExam(mode),
  });
}

async function gradeOpen(input) {
  const mode = safeMode(input);

  const userAnswer = pickFirstString(
    input?.open_user_answer,
    input?.answer,
    input?.user_answer
  );

  const openQuestion = pickFirstString(
    input?.open_question,
    input?.question,
    input?.confirmed_question
  );

  const context = pickFirstString(
    input?.question_for_api,
    input?.confirmed_question
  );

  const prox = await maybeProxy("GRADE_OPEN", {
    mode,
    answer: userAnswer,
    open_question: openQuestion,
    context,
  });

  if (prox.proxied && prox.ok) {
    const out = prox.data || {};
    const grade = out.grade ||
      jsonOrNull(out.API_Grade_JSON) ||
      out.API_Grade || {
        score: 7,
        feedback:
          "Good structure; add clearer assumptions and a success metric.",
      };

    return okEnvelope({
      source: "upstream_grade_open",
      API_Grade_JSON: typeof grade === "string" ? grade : JSON.stringify(grade),
      grade,
      upstream_status: prox.status,
    });
  }

  const grade = {
    score: 7,
    feedback: "Good structure; add clearer assumptions and a success metric.",
  };

  return okEnvelope({
    source: "grade_open_stub",
    API_Grade_JSON: JSON.stringify(grade),
    grade,
  });
}

async function teachAndQuiz(input) {
  const mode = safeMode(input);
  const question = safeQuestion(input);

  const prox = await maybeProxy("TEACH_AND_QUIZ", { mode, question });
  if (prox.proxied && prox.ok) {
    const out = prox.data || {};
    const lesson = pickFirstString(
      out.lesson,
      out.API_Lesson,
      out.lesson_display
    );
    const quiz =
      out.quiz ||
      jsonOrNull(out.API_Quiz_JSON) ||
      out.API_Quiz ||
      stubQuizExam(mode);

    const fallbackLesson = stubText(
      mode === "prompt" ? "lesson_prompt" : "lesson_business"
    );

    return okEnvelope({
      source: "upstream_teach_and_quiz",
      API_Lesson: lesson || fallbackLesson,
      API_Lesson_Display: lesson || fallbackLesson,
      API_Quiz_JSON: JSON.stringify(quiz),
      upstream_status: prox.status,
    });
  }

  const kind = mode === "prompt" ? "lesson_prompt" : "lesson_business";
  const sys =
    mode === "prompt"
      ? "You are a senior prompt engineer teaching prompt patterns. Create a concise lesson with: role, context, constraints, output format, clarifying questions, and examples."
      : "You are a senior strategy consultant. Create a concise lesson with: objective, constraints, key assumptions, 2–3 options with tradeoffs, a recommendation, risks/mitigations, and a short execution plan.";

  const oa = await openaiChat(
    [
      { role: "system", content: sys },
      { role: "user", content: question || "Generate a lesson." },
    ],
    { temperature: 0.15, maxTokens: 900 }
  );

  const lesson = oa.ok
    ? (oa.content || "").trim() || stubText(kind)
    : stubText(kind);
  const quiz = stubQuizExam(mode);

  return okEnvelope({
    source: oa.ok ? "teach_and_quiz_local" : "teach_and_quiz_stub",
    API_Lesson: lesson,
    API_Lesson_Display: lesson,
    API_Quiz_JSON: JSON.stringify(quiz),
  });
}

// -------------------------
// CI/test harness functions
// -------------------------

async function llmElicit(input) {
  const payload = input || {};

  const raw = {
    source: PROMPT_URL ? "invoke_component_default" : "invoke_component_stub",
    action: "llm_elicit",
    payload,
    ts: new Date().toISOString(),
  };

  logLlmPayloadSnippet(raw);

  return okEnvelope({
    source: raw.source,
    raw,
    data: { raw },
    reply: "ok",
  });
}

async function invokeComponent(input) {
  const payload = input || {};
  const action =
    (payload.action && typeof payload.action === "string"
      ? payload.action
      : "") ||
    (payload.component && typeof payload.component === "string"
      ? payload.component
      : "") ||
    (payload.type && typeof payload.type === "string" ? payload.type : "") ||
    "";

  switch (String(action).toLowerCase()) {
    case "llm_elicit":
      return llmElicit(payload);
    case "optimize_question":
      return optimizeQuestion(payload);
    case "generate_lesson":
      return generateLesson(payload);
    case "prompt_lesson":
      return promptLesson(payload);
    case "generate_exam":
      return generateExam(payload);
    case "grade_open":
      return gradeOpen(payload);
    case "teach_and_quiz":
    default:
      return teachAndQuiz(payload);
  }
}

// -------------------------
// Routes
// -------------------------

app.get("/", (req, res) => res.status(200).send("ok"));
app.get("/health", (req, res) => res.status(200).send("ok"));

/**
 * Test harness endpoint (used in CI regression tests).
 * Mirrors /webhook behavior but is deterministic and always returns JSON.
 */
app.post("/invoke_component", async (req, res) => {
  try {
    const result = await invokeComponent(req.body || {});
    return res
      .status(200)
      .json(ensureContract(req, result, "invoke_component"));
  } catch (err) {
    log("error", "Unhandled /invoke_component error", {
      error: String(err?.message || err),
    });
    const fail = failEnvelope({ error: "Unhandled server error" });
    return res.status(200).json(ensureContract(req, fail, "invoke_component"));
  }
});

/**
 * Generic webhook entry point (optional).
 * Accepts { action: "teach_and_quiz" | "optimize_question" | ... , ...payload }
 */
app.post("/webhook", async (req, res) => {
  try {
    const action =
      (req.body?.action && typeof req.body.action === "string"
        ? req.body.action
        : "") ||
      (req.body?.action?.name ? String(req.body.action.name) : "") ||
      (req.body?.type ? String(req.body.type) : "");

    const payload = req.body || {};

    let result;
    switch ((action || "").toLowerCase()) {
      case "llm_elicit":
        result = await llmElicit(payload);
        break;
      case "optimize_question":
        result = await optimizeQuestion(payload);
        break;
      case "generate_lesson":
        result = await generateLesson(payload);
        break;
      case "prompt_lesson":
        result = await promptLesson(payload);
        break;
      case "grade_open":
        result = await gradeOpen(payload);
        break;
      case "generate_exam":
        result = await generateExam(payload);
        break;
      case "teach_and_quiz":
      default:
        result = await teachAndQuiz(payload);
        break;
    }

    return res.status(200).json(ensureContract(req, result, "webhook"));
  } catch (err) {
    log("error", "Unhandled /webhook error", {
      error: String(err?.message || err),
    });
    const fail = failEnvelope({
      error: "Unhandled server error",
    });
    return res.status(200).json(ensureContract(req, fail, "webhook"));
  }
});

app.post("/optimize_question", async (req, res) => {
  const result = await optimizeQuestion(req.body || {});
  res.status(200).json(ensureContract(req, result, "optimize_question"));
});

app.post("/generate_lesson", async (req, res) => {
  const result = await generateLesson(req.body || {});
  res.status(200).json(ensureContract(req, result, "generate_lesson"));
});

app.post("/teach_and_quiz", async (req, res) => {
  const result = await teachAndQuiz(req.body || {});
  res.status(200).json(ensureContract(req, result, "teach_and_quiz"));
});

app.post("/prompt_lesson", async (req, res) => {
  const result = await promptLesson(req.body || {});
  res.status(200).json(ensureContract(req, result, "prompt_lesson"));
});

app.post("/generate_exam", async (req, res) => {
  const result = await generateExam(req.body || {});
  res.status(200).json(ensureContract(req, result, "generate_exam"));
});

app.post("/grade_open", async (req, res) => {
  const result = await gradeOpen(req.body || {});
  res.status(200).json(ensureContract(req, result, "grade_open"));
});

// -------------------------
// Server lifecycle helpers (CI-friendly)
// -------------------------

let currentServer = null;

function startServer(port) {
  const pRaw =
    port !== undefined && port !== null
      ? port
      : process.env.PORT !== undefined
        ? process.env.PORT
        : 10000;
  const p = typeof pRaw === "string" ? parseInt(pRaw, 10) : pRaw;

  const server = app.listen(p, () => {
    const addr = server.address();
    const actualPort = addr && typeof addr === "object" ? addr.port : p;
    log("info", "Webhook server listening", {
      port: actualPort,
      upstream_enabled: UPSTREAM_ENABLED,
      upstream_timeout_ms: UPSTREAM_TIMEOUT_MS,
      upstream_max_retries: UPSTREAM_MAX_RETRIES,
      upstream_retry_base_ms: UPSTREAM_RETRY_BASE_MS,
    });
  });

  currentServer = server;
  return server;
}

function closeResources() {
  if (!currentServer) return Promise.resolve();

  return new Promise((resolve) => {
    try {
      currentServer.close(() => resolve());
    } catch {
      resolve();
    } finally {
      currentServer = null;
    }
  });
}

if (require.main === module) {
  startServer();
}

app.startServer = startServer;
app.closeResources = closeResources;

module.exports = app;
