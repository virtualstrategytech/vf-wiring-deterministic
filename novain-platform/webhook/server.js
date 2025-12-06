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
 *     UPSTREAM_URL_PROMPT_LESSON
 *     UPSTREAM_URL_GENERATE_EXAM
 *     UPSTREAM_URL_GRADE_OPEN
 */

"use strict";

const express = require("express");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

// -------------------------
// Env / config
// -------------------------

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
  // Render likes stdout logs.
  console.log(JSON.stringify(payload));
}

// -------------------------
// Auth middleware
// -------------------------

function requireApiKey(req, res, next) {
  // allow health/root without key
  if (req.path === "/health" || req.path === "/") return next();

  // In dev, don’t block people by default
  if (!IS_PROD && !WEBHOOK_API_KEY) return next();

  if (!WEBHOOK_API_KEY) {
    return res.status(401).json({
      ok: false,
      API_OK: false,
      component_result: "fail",
      error: "WEBHOOK_API_KEY is not configured on the server",
    });
  }

  const key =
    req.header("x-api-key") ||
    req.header("X-API-Key") ||
    req.header("X-API-KEY") ||
    "";
  if (key !== WEBHOOK_API_KEY) {
    return res.status(401).json({
      ok: false,
      API_OK: false,
      component_result: "fail",
      error: "Invalid API key",
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

async function fetchWithTimeout(url, options = {}, timeoutMs) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    return resp;
  } finally {
    clearTimeout(id);
  }
}

async function fetchWithRetry(url, options = {}, cfg = {}) {
  const timeoutMs = clampNumber(
    cfg.timeoutMs ?? UPSTREAM_TIMEOUT_MS,
    1000,
    120000
  );
  const maxRetries = clampNumber(cfg.maxRetries ?? UPSTREAM_MAX_RETRIES, 0, 10);
  const baseMs = clampNumber(cfg.baseMs ?? UPSTREAM_RETRY_BASE_MS, 50, 60000);

  let last = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let resp;
    let text = "";

    try {
      resp = await fetchWithTimeout(url, options, timeoutMs);
      text = await resp.text();

      if (resp.ok) {
        return { ok: true, status: resp.status, text, headers: resp.headers };
      }

      // Only retry on 429/5xx (explicit requirement)
      if (shouldRetryStatus(resp.status) && attempt < maxRetries) {
        const backoff = Math.min(baseMs * Math.pow(2, attempt), 8000);
        log("warn", "Upstream non-2xx; retrying", {
          url,
          status: resp.status,
          attempt,
          backoff_ms: backoff,
        });
        await sleep(backoff);
        continue;
      }

      // Non-retryable non-2xx
      last = { ok: false, status: resp.status, text };
      break;
    } catch (err) {
      // Do NOT retry on network/timeout errors per the requirement ("only retry on 429/5xx")
      const name = err && err.name ? err.name : "Error";
      const message = err && err.message ? err.message : String(err);
      last = { ok: false, status: 0, text: "", error: `${name}: ${message}` };

      log("error", "Upstream request failed (no retry per policy)", {
        url,
        attempt,
        error: last.error,
      });
      break;
    }
  }

  return (
    last || {
      ok: false,
      status: 0,
      text: "",
      error: "Unknown upstream failure",
    }
  );
}

function jsonOrNull(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function safeTrim(s, max = 3500) {
  if (typeof s !== "string") return "";
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
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

function stubText(kind) {
  // Deterministic, zero-randomness, Voiceflow-safe strings
  if (kind === "lesson_business") {
    return [
      "Business lesson (stub):",
      "1) Define the objective and success metric.",
      "2) State key assumptions and constraints.",
      "3) Generate 2–3 strategic options.",
      "4) Recommend one option with a rationale.",
      "5) Outline risks and mitigations.",
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

  if (kind === "grade_open") {
    return "Feedback (stub): Unable to grade due to upstream limits. Add role + constraints + output format next time.";
  }

  return "Stub response (upstream unavailable).";
}

function stubQuizExam(mode = "business") {
  // Deterministic 10 MCQ + 3 TF + 1 Open to satisfy your exam component.
  // Answers match the exact option strings / True/False buttons.
  const topic = mode === "prompt" ? "prompt engineering" : "business strategy";

  const mcq = Array.from({ length: 10 }, (_, i) => {
    const n = i + 1;
    const options = [
      `Option A (${topic})`,
      `Option B (${topic})`,
      `Option C (${topic})`,
      `Option D (${topic})`,
    ];
    return {
      question: `MCQ ${n}: Which choice best supports good ${topic} practice?`,
      options,
      answer: options[0],
    };
  });

  const tf = Array.from({ length: 3 }, (_, i) => {
    const n = i + 1;
    return {
      question: `TF ${n}: Being explicit about constraints improves ${topic} outputs.`,
      answer: "True",
    };
  });

  const open = [
    {
      question:
        mode === "prompt"
          ? "Open: Write a strong system prompt for this user question (include role, constraints, and output format)."
          : "Open: Provide a structured strategy recommendation (objective, assumptions, options, recommendation, risks).",
      rubric:
        mode === "prompt"
          ? "Score 0–5 based on: role clarity, context, constraints, output format, and use of clarifying questions."
          : "Score 0–5 based on: objective+metric, assumptions, options, recommendation, risks/mitigations.",
    },
  ];

  return { mcq, tf, open };
}

// -------------------------
// Upstream URL resolution (optional overrides)
// -------------------------

function normalizeBaseUrl(u) {
  if (!u) return "";
  return u.endsWith("/") ? u.slice(0, -1) : u;
}

function getUpstreamOverride(name) {
  const v = (process.env[name] || "").trim();
  return v ? v : "";
}

function upstreamUrlFor(endpointName) {
  // EndpointName is one of:
  // OPTIMIZE_QUESTION, TEACH_AND_QUIZ, PROMPT_LESSON, GENERATE_EXAM, GRADE_OPEN
  const override = getUpstreamOverride(`UPSTREAM_URL_${endpointName}`);
  if (override) return override;

  // Fallback heuristics: use PROMPT_URL / BUSINESS_URL if present.
  // IMPORTANT: We do NOT auto-append paths unless upstream is explicitly enabled,
  // and only for the endpoint that should logically exist.
  const p = normalizeBaseUrl(PROMPT_URL);
  const b = normalizeBaseUrl(BUSINESS_URL);

  switch (endpointName) {
    case "PROMPT_LESSON":
      return p ? `${p}/prompt_lesson` : "";
    case "GRADE_OPEN":
      return p ? `${p}/grade_open` : "";
    case "TEACH_AND_QUIZ":
      return b ? `${b}/teach_and_quiz` : "";
    case "OPTIMIZE_QUESTION":
      return b ? `${b}/optimize_question` : "";
    case "GENERATE_EXAM":
      return b ? `${b}/generate_exam` : "";
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
    return { ok: false, error: "OPENAI_API_KEY missing" };
  }

  const url = "https://api.openai.com/v1/chat/completions";
  const body = {
    model: OPENAI_MODEL,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  const resp = await fetchWithRetry(
    url,
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

  if (!resp || !resp.ok) {
    return {
      ok: false,
      status: resp?.status || 0,
      error: resp?.error || "OpenAI request failed",
      raw: safeTrim(resp?.text || "", 1200),
    };
  }

  const json = jsonOrNull(resp.text);
  const content = json?.choices?.[0]?.message?.content ?? "";
  return { ok: true, content, raw: json };
}

// -------------------------
// Core component logic
// -------------------------

async function maybeProxy(endpointName, payload) {
  // Only proxy if UPSTREAM_ENABLED is true AND we have a URL.
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
    // Treat ANY non-2xx as upstream failure; deterministic fallback (no Voiceflow explosions)
    log("warn", "Upstream failed; falling back", {
      endpointName,
      url,
      status: resp.status,
      error: resp.error,
      raw: safeTrim(resp.text || "", 300),
    });

    return {
      proxied: true,
      ok: false,
      status: resp.status,
      error: resp.error || `Upstream non-2xx: ${resp.status}`,
      raw: resp.text || "",
    };
  }

  const data = jsonOrNull(resp.text);
  return {
    proxied: true,
    ok: true,
    status: resp.status,
    data,
    text: resp.text,
  };
}

async function optimizeQuestion(input) {
  const question = (input?.question || input?.user_question || "")
    .toString()
    .trim();
  const mode = (input?.mode || "business").toString().trim();

  // Proxy attempt
  const prox = await maybeProxy("OPTIMIZE_QUESTION", { question, mode });
  if (prox.proxied && prox.ok) {
    // Pass-through upstream JSON or text
    const out = prox.data || {};
    const optimized =
      out.optimized_question ||
      out.optimized ||
      out.question ||
      out.result ||
      "";
    return okEnvelope({
      source: "upstream_optimize",
      optimized_question: optimized,
      API_OptimizedQuestion: optimized,
      upstream_status: prox.status,
    });
  }

  // Local generation (OpenAI) fallback
  const sys =
    mode === "prompt"
      ? "You are a prompt-engineering coach. Rewrite the user question into a clear prompt-spec: objective, context, constraints, output format."
      : "You are a business strategy consultant. Rewrite the user question into a crisp problem statement: objective, scope, constraints, and desired deliverable.";

  const oa = await openaiChat(
    [
      { role: "system", content: sys },
      { role: "user", content: question || "Optimize this question." },
    ],
    { temperature: 0.1, maxTokens: 350 }
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

  const optimized = oa.content.trim() || stubText("optimize_question");
  return okEnvelope({
    source: "optimize_local",
    optimized_question: optimized,
    API_OptimizedQuestion: optimized,
  });
}

async function generateLesson(input) {
  const question = (input?.question || input?.user_question || "")
    .toString()
    .trim();
  const mode = (input?.mode || "business").toString().trim();

  const kind = mode === "prompt" ? "lesson_prompt" : "lesson_business";
  const sys =
    mode === "prompt"
      ? "You are a senior prompt engineer teaching prompt patterns. Create a concise lesson with: role, context, constraints, output format, clarifying questions, and examples."
      : "You are a senior strategy consultant. Create a concise lesson with: objective/metric, assumptions, options, recommendation, risks/mitigations, and a short execution plan.";

  const oa = await openaiChat(
    [
      { role: "system", content: sys },
      { role: "user", content: question || "Generate a lesson." },
    ],
    { temperature: 0.15, maxTokens: 900 }
  );

  if (!oa.ok) {
    const lesson = stubText(kind);
    return okEnvelope({
      source: `${kind}_stub`,
      lesson,
      API_Lesson: lesson,
      API_Lesson_Display: lesson,
      upstream_status: oa.status || 429,
      upstream_error: oa.error || "openai_failed",
    });
  }

  const lesson = oa.content.trim() || stubText(kind);
  return okEnvelope({
    source: `${kind}_local`,
    lesson,
    API_Lesson: lesson,
    API_Lesson_Display: lesson,
  });
}

async function generateExam(input) {
  const question = (input?.question || input?.user_question || "")
    .toString()
    .trim();
  const mode = (input?.mode || "business").toString().trim();

  // Proxy attempt
  const prox = await maybeProxy("GENERATE_EXAM", { question, mode });
  if (prox.proxied && prox.ok) {
    const quizObj = prox.data?.quiz || prox.data?.exam || prox.data;
    const quiz =
      quizObj && typeof quizObj === "object" ? quizObj : stubQuizExam(mode);
    const json = JSON.stringify(quiz);
    return okEnvelope({
      source: "upstream_generate_exam",
      quiz,
      API_Quiz_JSON: json,
      upstream_status: prox.status,
    });
  }

  // Local generation (JSON only)
  const sys =
    mode === "prompt"
      ? "You generate exams for prompt engineering. Output JSON only."
      : "You generate exams for business strategy. Output JSON only.";

  const user = [
    "Create an exam JSON with exactly:",
    "- mcq: 10 items, each {question, options:[4 strings], answer:(must equal EXACT option string)}",
    "- tf: 3 items, each {question, answer:(True/False)}",
    "- open: 1 item, {question, rubric}",
    "",
    `Topic/context: ${question || "(general fundamentals)"}`,
  ].join("\n");

  const oa = await openaiChat(
    [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    { temperature: 0.1, maxTokens: 900 }
  );

  if (!oa.ok) {
    const quiz = stubQuizExam(mode);
    return okEnvelope({
      source: "exam_stub",
      quiz,
      API_Quiz_JSON: JSON.stringify(quiz),
      upstream_status: oa.status || 429,
      upstream_error: oa.error || "openai_failed",
    });
  }

  const parsed = jsonOrNull(oa.content);
  const quiz =
    parsed && typeof parsed === "object" ? parsed : stubQuizExam(mode);

  // Minimal guardrails: ensure arrays exist
  quiz.mcq = Array.isArray(quiz.mcq) ? quiz.mcq : stubQuizExam(mode).mcq;
  quiz.tf = Array.isArray(quiz.tf) ? quiz.tf : stubQuizExam(mode).tf;
  quiz.open = Array.isArray(quiz.open) ? quiz.open : stubQuizExam(mode).open;

  return okEnvelope({
    source: "exam_local",
    quiz,
    API_Quiz_JSON: JSON.stringify(quiz),
  });
}

async function promptLesson(input) {
  const question = (
    input?.question ||
    input?.user_question ||
    input?.question_for_api ||
    ""
  )
    .toString()
    .trim();
  const goal = (input?.goal || "").toString().trim();

  // Proxy attempt
  const prox = await maybeProxy("PROMPT_LESSON", { question, goal });
  if (prox.proxied && prox.ok) {
    const out = prox.data || {};
    const text =
      out.prompt_lesson ||
      out.lesson ||
      out.result ||
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
    "You are a senior prompt engineer. Teach a repeatable prompt pattern for the user’s goal and question.";
  const user = [
    `Goal: ${goal || "(not provided)"}`,
    `Question: ${question || "(not provided)"}`,
    "",
    "Deliver:",
    "1) Objective & success metrics",
    "2) Key assumptions",
    "3) 3 strategic prompt options (impact vs effort)",
    "4) Recommended option + short experiment plan (2 weeks)",
    "5) Risks + mitigations",
    "Output with clear headings and bullets.",
  ].join("\n");

  const oa = await openaiChat(
    [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    { temperature: 0.2, maxTokens: 900 }
  );

  if (!oa.ok) {
    const lesson = stubText("lesson_prompt");
    return okEnvelope({
      source: "prompt_lesson_stub",
      API_PromptLesson: lesson,
      API_PromptLesson_JSON: JSON.stringify({ text: lesson }),
      prompt_lesson: lesson,
      upstream_status: oa.status || 429,
      upstream_error: oa.error || "openai_failed",
    });
  }

  const lesson = oa.content.trim() || stubText("lesson_prompt");
  return okEnvelope({
    source: "prompt_lesson_local",
    API_PromptLesson: lesson,
    API_PromptLesson_JSON: JSON.stringify({ text: lesson }),
    prompt_lesson: lesson,
  });
}

async function gradeOpen(input) {
  const mode = (input?.mode || "business").toString().trim();
  const question = (
    input?.open_q ||
    input?.question ||
    input?.open_question ||
    ""
  )
    .toString()
    .trim();
  const openUserAnswer = (input?.open_user_answer || input?.answer || "")
    .toString()
    .trim();
  const rubric = (input?.rubric || "").toString().trim();

  // Proxy attempt
  const prox = await maybeProxy("GRADE_OPEN", {
    mode,
    open_q: question,
    open_user_answer: openUserAnswer,
    rubric,
  });
  if (prox.proxied && prox.ok) {
    const out = prox.data || {};
    return okEnvelope({
      source: "upstream_grade_open",
      open_feedback: out.open_feedback || out.feedback || "",
      open_score:
        typeof out.open_score === "number"
          ? out.open_score
          : Number(out.open_score || 0),
      open_model_answer: out.open_model_answer || out.model_answer || "",
      upstream_status: prox.status,
    });
  }

  const rubricEffective =
    rubric ||
    (mode === "prompt"
      ? "Score 0–5: role clarity, context, constraints, output format, clarifying questions."
      : "Score 0–5: objective+metric, assumptions, options, recommendation, risks/mitigations.");

  const sys =
    mode === "prompt"
      ? "You grade prompt-engineering answers using the rubric. Be concise and actionable."
      : "You grade business strategy answers using the rubric. Be concise and actionable.";

  const user = [
    `Question: ${question || "(none)"}`,
    `User answer: ${openUserAnswer || "(none)"}`,
    `Rubric: ${rubricEffective}`,
    "",
    "Return JSON ONLY with fields:",
    `{ "open_feedback": "strengths + improvements", "open_score": 0-5, "open_model_answer": "ideal answer" }`,
  ].join("\n");

  const oa = await openaiChat(
    [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    { temperature: 0.1, maxTokens: 700 }
  );

  if (!oa.ok) {
    return okEnvelope({
      source: "grade_open_stub",
      open_feedback: stubText("grade_open"),
      open_score: 0,
      open_model_answer: "",
      upstream_status: oa.status || 429,
      upstream_error: oa.error || "openai_failed",
    });
  }

  const parsed = jsonOrNull(oa.content) || {};
  const open_feedback =
    (parsed.open_feedback || "").toString().trim() || stubText("grade_open");
  const open_model_answer = (parsed.open_model_answer || "").toString().trim();
  const open_score = clampNumber(Number(parsed.open_score), 0, 5);

  return okEnvelope({
    source: "grade_open_local",
    open_feedback,
    open_score,
    open_model_answer,
  });
}

// Teach & Quiz = lesson + exam JSON
async function teachAndQuiz(input) {
  const mode = (input?.mode || "business").toString().trim();
  const question = (input?.question || input?.user_question || "")
    .toString()
    .trim();

  // Proxy attempt
  const prox = await maybeProxy("TEACH_AND_QUIZ", { mode, question });
  if (prox.proxied && prox.ok) {
    const out = prox.data || {};
    const lesson = out.lesson || out.API_Lesson || out.lesson_display || "";
    const quiz =
      out.quiz ||
      jsonOrNull(out.API_Quiz_JSON) ||
      out.API_Quiz ||
      stubQuizExam(mode);
    return okEnvelope({
      source: "upstream_teach_and_quiz",
      API_Lesson: lesson,
      API_Lesson_Display: lesson,
      API_Quiz_JSON: JSON.stringify(quiz),
      upstream_status: prox.status,
    });
  }

  const lessonResp = await generateLesson({ mode, question });
  const examResp = await generateExam({ mode, question });

  const lesson =
    lessonResp.lesson ||
    lessonResp.API_Lesson ||
    stubText(mode === "prompt" ? "lesson_prompt" : "lesson_business");
  const quiz = examResp.quiz || stubQuizExam(mode);

  return okEnvelope({
    source: "teach_and_quiz_local",
    API_Lesson: lesson,
    API_Lesson_Display: lesson,
    API_Quiz_JSON: JSON.stringify(quiz),
  });
}

// -------------------------
// Routes
// -------------------------

app.get("/", (req, res) => res.status(200).send("ok"));
app.get("/health", (req, res) => res.status(200).send("ok"));

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
      case "optimize_question":
        result = await optimizeQuestion(payload);
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

    return res.status(200).json(result);
  } catch (err) {
    log("error", "Unhandled /webhook error", {
      error: String(err?.message || err),
    });
    return res.status(200).json(
      failEnvelope({
        error: "Unhandled server error",
      })
    );
  }
});

app.post("/optimize_question", async (req, res) => {
  const result = await optimizeQuestion(req.body || {});
  res.status(200).json(result);
});

app.post("/teach_and_quiz", async (req, res) => {
  const result = await teachAndQuiz(req.body || {});
  res.status(200).json(result);
});

app.post("/prompt_lesson", async (req, res) => {
  const result = await promptLesson(req.body || {});
  res.status(200).json(result);
});

app.post("/generate_exam", async (req, res) => {
  const result = await generateExam(req.body || {});
  res.status(200).json(result);
});

app.post("/grade_open", async (req, res) => {
  const result = await gradeOpen(req.body || {});
  res.status(200).json(result);
});

// -------------------------
// Server lifecycle helpers (CI-friendly)
// -------------------------

let currentServer = null;

function startServer(port) {
  const p = port || process.env.PORT || 10000;
  const server = app.listen(p, () => {
    log("info", "Webhook server listening", {
      port: p,
      upstream_enabled: UPSTREAM_ENABLED,
      upstream_timeout_ms: UPSTREAM_TIMEOUT_MS,
      upstream_max_retries: UPSTREAM_MAX_RETRIES,
      upstream_retry_base_ms: UPSTREAM_RETRY_BASE_MS,
      has_openai_key: Boolean(OPENAI_API_KEY),
      has_webhook_key: Boolean(WEBHOOK_API_KEY),
      has_business_url: Boolean(BUSINESS_URL),
      has_prompt_url: Boolean(PROMPT_URL),
      has_retrieval_url: Boolean(RETRIEVAL_URL),
    });
  });

  server.on("error", (err) => {
    log("error", "HTTP server error", {
      message: err?.message,
      stack: err?.stack,
    });
  });

  currentServer = server;
  return server;
}

function closeResources() {
  return new Promise((resolve) => {
    if (!currentServer) return resolve();
    currentServer.close(() => resolve());
    currentServer = null;
  });
}

if (require.main === module) {
  startServer();
}

// Helpers expected by some tests.
app.startServer = startServer;
app.closeResources = closeResources;

// Default export is the Express app (in-process handler).
module.exports = app;
