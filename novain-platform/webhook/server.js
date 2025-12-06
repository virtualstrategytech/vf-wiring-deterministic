// novain-platform/webhook/server.js
// Deterministic webhook server with CI-friendly behaviour.
//
// Consolidated endpoints:
//   POST /webhook           (action router; tests + legacy flows)
//   POST /optimize_question (Voiceflow C_OptimizeQuestion)
//   POST /teach_and_quiz    (Voiceflow C_TeachAndQuiz)
//   POST /generate_quiz     (optional)
//   POST /generate_lesson   (optional)
//
// NEW endpoints for two-branch + exam:
//   POST /prompt_lesson     (Agent 2 prompt-engineering lesson)
//   POST /generate_exam     (10 MCQ + 3 TF + 1 open, mode-aware)
//   POST /grade_open        (automated feedback + model answer)
//
// Notes:
// - Auth is via x-api-key header if WEBHOOK_API_KEY or WEBHOOK_KEY is set.
// - Robust against invalid JSON from clients (Voiceflow raw body glitches).
// - Supports base64 transport: question_for_api + question_encoding=base64

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
// Express app + body parsing (with invalid-JSON recovery)
// ---------------------------------------------------------------------------

const app = express();

// Capture raw body and attempt JSON parse.
app.use(
  express.json({
    limit: "2mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// If JSON parsing failed, don’t hard-fail the request.
// Instead, continue with a “safe” body so Voiceflow doesn’t drop into failure path.
app.use((err, req, _res, next) => {
  if (err && err.type === "entity.parse.failed") {
    const rawText = req.rawBody ? req.rawBody.toString("utf8") : "";
    req.body = {
      action: extractJsonStringField(rawText, "action") || "",
      mode: extractJsonStringField(rawText, "mode") || "",
      learning_mode: extractJsonStringField(rawText, "learning_mode") || "",
      question_for_api:
        extractJsonStringField(rawText, "question_for_api") || "",
      _json_parse_error: err.message || "invalid_json",
      _raw_text: rawText,
    };
    return next();
  }
  return next(err);
});

function extractJsonStringField(rawText, fieldName) {
  if (!rawText) return "";
  const re = new RegExp(`"${fieldName}"\\s*:\\s*"([^"]*)"`);
  const m = rawText.match(re);
  return m && m[1] ? m[1] : "";
}

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
  if (kind === "prompt_lesson")
    return { ...base, mode: "prompt_lesson", source: "prompt_lesson_stub" };
  if (kind === "generate_exam")
    return { ...base, mode: "generate_exam", source: "generate_exam_stub" };
  if (kind === "grade_open")
    return { ...base, mode: "grade_open", source: "grade_open_stub" };

  return { ...base, source: "stub" };
}

function resolvePromptUrl(_kind) {
  const promptUrl = process.env.PROMPT_URL;
  if (!promptUrl) return "";

  try {
    const u = new URL(promptUrl);
    const hasPath = u.pathname && u.pathname !== "/";
    if (hasPath) return promptUrl;

    // If PROMPT_URL is a bare base URL, route all prompt-agent calls to its single
    // cannonical entrypoint. The prompt service decides behavior based on the
    // request payload (e.g., action/mode fields).
    u.pathname = "/v1/teach-and-quiz";
    return u.toString();
  } catch {
    return promptUrl;
  }
}

async function callPromptService(kind, body) {
  const promptUrl = resolvePromptUrl(kind);
  if (!promptUrl) return makeStubRaw(kind, body);

  const payload = {
    action: kind,
    mode: body && body.mode ? String(body.mode) : "",
    learning_mode: body && body.learning_mode ? String(body.learning_mode) : "",
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
      parsed && parsed.raw && typeof parsed.raw === "object"
        ? parsed.raw
        : parsed || {};

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
                  : kind === "prompt_lesson"
                    ? "prompt_lesson_default"
                    : kind === "generate_exam"
                      ? "generate_exam_default"
                      : kind === "grade_open"
                        ? "grade_open_default"
                        : "remote_llm";
    }

    return raw;
  } catch (err) {
    log("error", "Error calling prompt service", {
      message: err && err.message,
    });
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
    if (http?.globalAgent?.destroy) http.globalAgent.destroy();
    if (https?.globalAgent?.destroy) https.globalAgent.destroy();
  } catch {
    // best-effort only
  }
}

// ---------------------------------------------------------------------------
// Core helpers (input decoding + response builders)
// ---------------------------------------------------------------------------

function pickQuestionFromBody(body) {
  const candidates = [
    body && body.question_for_api,
    body && body.question,
    body && body.user_message,
    body && body.userMessage,
    body && body.last_utterance,
    body && body.lastUtterance,
    body && body.optimized_question,
    body && body.optimizedQuestion,
    body && body.confirmed_question,
    body && body.confirmedQuestion,
  ];

  for (const c of candidates) {
    const s = String(c || "").trim();
    if (s) return s;
  }
  return "";
}

function decodeQuestionIfNeeded(body, q) {
  const encoding = String(body?.question_encoding || "")
    .trim()
    .toLowerCase();
  if (encoding !== "base64") return q;

  try {
    return Buffer.from(String(q || ""), "base64").toString("utf8");
  } catch {
    return q;
  }
}

function normalizeMode(body) {
  const m = String(body?.learning_mode || body?.mode || body?.exam_mode || "")
    .trim()
    .toLowerCase();

  if (
    m === "prompt" ||
    m === "prompt_engineering" ||
    m === "promptlesson" ||
    m === "prompt_lesson"
  ) {
    return "prompt";
  }
  // default
  return "business";
}

function buildNeedsClarifyResponse(raw, reason) {
  const clarify_question =
    "Your request JSON couldn’t be parsed (usually due to quotes/newlines in variables). " +
    "Please retry — or use base64 transport (question_for_api + question_encoding=base64).";
  return {
    ok: true,
    API_OK: "true",
    raw,
    component_result: "needs_clarify",
    needs_clarify: true,
    clarify_reason: reason || "invalid_json",
    clarify_question,
    agent_reply: clarify_question,
    API_Response: clarify_question,
    data: { raw },
  };
}

function buildOptimizeQuestionResponse(body, raw) {
  if (body && body._json_parse_error) {
    return buildNeedsClarifyResponse(raw, "invalid_json");
  }

  const original = decodeQuestionIfNeeded(body, pickQuestionFromBody(body));
  const trimmed = String(original || "").trim();

  let component_result;
  let optimized_question = trimmed;
  let agent_reply;
  let clarify_reason = null;
  let needs_clarify = false;
  let clarify_question = "";

  if (!trimmed || trimmed.length < 10) {
    component_result = "needs_clarify";
    needs_clarify = true;
    clarify_reason = "too_short_or_empty";
    clarify_question =
      "I want to be sure I understand. Could you restate your question in one clear sentence or add a bit more detail?";
    agent_reply = clarify_question;
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
    needs_clarify,
    clarify_question,
    API_Response: agent_reply,
    data: {
      raw,
      component_result,
      optimized_question,
      agent_reply,
      clarify_reason,
      needs_clarify,
      clarify_question,
    },
  };
}

// ---------------------------------------------------------------------------
// Agent 2: PromptLesson object (structured)
// ---------------------------------------------------------------------------

function buildPromptLessonObject(mode, question) {
  const q = String(question || "").trim() || "your question";
  const isPrompt = mode === "prompt";

  const title = isPrompt
    ? `Prompt engineering lesson for: ${q}`
    : `Prompting helper for: ${q}`;

  const goal = isPrompt
    ? "Learn a repeatable prompt pattern to get high-quality strategy output for this specific problem."
    : "Use a structured prompt to get clearer strategy output.";

  const framework = [
    "Role: who the AI should act as",
    "Context: what matters, what’s known, what’s unknown",
    "Task: what you want produced (analysis + recommendation)",
    "Constraints: time, scope, assumptions, exclusions",
    "Output format: headings, bullets, tables, step-by-step",
    "Iteration: ask clarifying questions before answering when needed",
  ];

  const example_prompt =
    `You are a senior ${isPrompt ? "prompt engineer + strategy consultant" : "strategy consultant"}. ` +
    `My question: "${q}". ` +
    `First ask up to 3 clarifying questions if needed. Then produce:\n` +
    `1) Objective & success metrics\n2) Key assumptions\n3) 3 strategic options (impact vs effort)\n` +
    `4) Recommended option + 2-week experiment plan\n5) Risks + mitigations\n` +
    `Output in clear headings and bullet points. Keep it actionable.`;

  const bad_prompt = `Help with ${q}.`;

  const improved_prompt =
    `Act as a strategy consultant. Question: "${q}". ` +
    `Give me: objectives, KPIs, constraints, options, recommendation, and a 2-week experiment plan. ` +
    `Ask clarifying questions if anything is missing. Use headings.`;

  const checklist = isPrompt
    ? [
        "Did you specify the role?",
        "Did you request clarifying questions first?",
        "Did you define the output format (headings/bullets)?",
        "Did you include constraints (time, scope, assumptions)?",
        "Did you request an experiment plan with metrics?",
      ]
    : [
        "Ask for objectives + KPIs explicitly",
        "Ask for assumptions/constraints",
        "Ask for options and recommendation",
        "Ask for next steps with a short timeline",
      ];

  return {
    title,
    goal,
    framework,
    example_prompt,
    bad_prompt,
    improved_prompt,
    checklist,
  };
}

function buildPromptLessonResponse(body, raw) {
  if (body && body._json_parse_error)
    return buildNeedsClarifyResponse(raw, "invalid_json");

  const mode = normalizeMode(body);
  const q0 =
    decodeQuestionIfNeeded(body, pickQuestionFromBody(body)) || "your question";
  const q = String(q0).trim() || "your question";

  const promptLessonObj = buildPromptLessonObject(mode, q);

  return {
    ok: true,
    API_OK: "true",
    raw,
    component_result: "success",
    API_PromptLesson_JSON: JSON.stringify(promptLessonObj),
    API_PromptLesson: promptLessonObj.example_prompt,
    API_Response: promptLessonObj.example_prompt,
    data: { raw, promptLesson: promptLessonObj },
  };
}

// ---------------------------------------------------------------------------
// Quiz + Lesson stubs (existing behaviour preserved)
// ---------------------------------------------------------------------------

function buildQuizEnvelope(question, mode) {
  const trimmedQuestion = String(question || "").trim() || "your question";
  const m = mode || "business";

  if (m === "prompt") {
    return {
      question: trimmedQuestion,
      mcq: [
        {
          type: "mcq",
          question:
            "Which element most improves reliability of an AI response?",
          options: [
            "Asking for a poem format",
            "Specifying role + output format + constraints",
            "Using more exclamation points",
            "Avoiding any requirements",
          ],
          answer: "Specifying role + output format + constraints",
        },
      ],
      tf: [
        {
          type: "tf",
          question:
            "True or false: Clarifying questions can improve output quality.",
          answer: "True",
        },
      ],
      open: [
        {
          type: "open",
          question: `Write a copy-ready prompt to solve: "${trimmedQuestion}". Include role, constraints, and output format.`,
        },
      ],
    };
  }

  // business default
  return {
    question: trimmedQuestion,
    mcq: [
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
    ],
    tf: [
      {
        type: "tf",
        question:
          "True or false: You should pick as many strategic options as possible and try them all at once.",
        answer: "False",
      },
    ],
    open: [
      {
        type: "open",
        question:
          "In 2–3 sentences, describe one concrete experiment you could run in the next 2–4 weeks.",
      },
    ],
  };
}

function buildTeachAndQuizResponse(body, raw) {
  const mode = normalizeMode(body);
  const q0 =
    decodeQuestionIfNeeded(body, pickQuestionFromBody(body)) || "your question";
  const trimmedQuestion = String(q0).trim() || "your question";

  // Agent 1: Business strategy lesson (default)
  const strategy_answer_business =
    `Here is a simple, high-level way I would approach "${trimmedQuestion}". ` +
    "First, clarify the objective and success metrics. Second, analyze the current state and constraints. " +
    "Third, identify 2–3 strategic options, compare impact vs. effort, and choose one to test. " +
    "Finally, define concrete next steps for the next 2–4 weeks.";

  const lessonTitle_business = `Strategy lesson for: ${trimmedQuestion}`;
  const lessonContent_business =
    `In this lesson, we’ll walk through a structured way to think about "${trimmedQuestion}". ` +
    "We’ll cover: (1) clarifying the business goal, (2) mapping stakeholders and constraints, " +
    "(3) generating strategic options, and (4) choosing a focused experiment you can run quickly.";

  // Agent 2: Prompt engineering lesson object (always available)
  const promptLessonObj = buildPromptLessonObject("prompt", trimmedQuestion);

  // If caller is explicitly in prompt mode, we foreground the prompt lesson as the "lesson"
  const isPromptForeground = mode === "prompt";

  const strategy_answer = isPromptForeground
    ? `Here’s how to prompt for this well: define role, constraints, and output structure for "${trimmedQuestion}", ` +
      "ask clarifying questions first, then request options + recommendation + next steps."
    : strategy_answer_business;

  const lessonTitle = isPromptForeground
    ? promptLessonObj.title
    : lessonTitle_business;
  const lessonContent = isPromptForeground
    ? `Goal: ${promptLessonObj.goal}\n\nFramework:\n- ${promptLessonObj.framework.join("\n- ")}\n\n` +
      `Example prompt:\n${promptLessonObj.example_prompt}`
    : lessonContent_business;

  const quizEnvelope = buildQuizEnvelope(trimmedQuestion, mode);

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

    // Canonical fields for Voiceflow blocks (API_*)
    API_LessonTitle: lessonTitle,
    API_LessonContent: lessonContent,
    API_PromptLesson: promptLessonObj.example_prompt,
    API_MCQ,
    API_TF,
    API_OPEN,
    API_Quiz_JSON,
    API_Response: strategy_answer,

    // Optional JSON slots
    API_Lesson_JSON: JSON.stringify({
      title: lessonTitle,
      content: lessonContent,
      promptLesson: promptLessonObj,
    }),
    API_PromptLesson_JSON: JSON.stringify(promptLessonObj),

    // Back-compat (APL_*)
    APL_LessonTitle: lessonTitle,
    APL_lesson_content: lessonContent,
    APL_PromptLesson: promptLessonObj.example_prompt,
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
      promptLesson: promptLessonObj,
      API_MCQ,
      API_TF,
      API_OPEN,
      API_Quiz_JSON,
    },
  };
}

function buildGenerateQuizResponse(body, raw) {
  const mode = normalizeMode(body);
  const question =
    decodeQuestionIfNeeded(body, pickQuestionFromBody(body)) ||
    "Quiz stub question";
  const quizEnvelope = buildQuizEnvelope(question, mode);
  const mcqCount = quizEnvelope.mcq.length;

  return {
    ok: true,
    API_OK: "true",
    raw,
    mcq: quizEnvelope.mcq,
    mcqCount,
    reply: "Stub MCQ quiz generated",
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
  const question =
    decodeQuestionIfNeeded(body, pickQuestionFromBody(body)) ||
    "Lesson stub question";
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
    data: { raw, lesson: lessonText, reply: lessonText },
  };
}

// ---------------------------------------------------------------------------
// Exam generator (10 MCQ + 3 TF + 1 Open), deterministic but mode-aware
// ---------------------------------------------------------------------------

function makeBusinessMcqs(question) {
  const q = String(question || "").trim() || "the problem";
  return [
    {
      type: "mcq",
      question: `For "${q}", what should you define first?`,
      options: [
        "Logo guidelines",
        "Objective + success metrics",
        "Team org chart",
        "Slide theme",
      ],
      answer: "Objective + success metrics",
    },
    {
      type: "mcq",
      question: "Which is the best way to handle missing information?",
      options: [
        "Assume everything",
        "Ask clarifying questions",
        "Skip constraints",
        "Proceed without metrics",
      ],
      answer: "Ask clarifying questions",
    },
    {
      type: "mcq",
      question: "What is a good next step after clarifying objective?",
      options: [
        "Pick a solution immediately",
        "Map current state + constraints",
        "Write the final deck",
        "Launch marketing",
      ],
      answer: "Map current state + constraints",
    },
    {
      type: "mcq",
      question:
        "Which is the BEST decision tool for selecting an option quickly?",
      options: [
        "Impact vs effort comparison",
        "Random choice",
        "Longest document",
        "Most meetings",
      ],
      answer: "Impact vs effort comparison",
    },
    {
      type: "mcq",
      question: "What is a strong experiment definition?",
      options: [
        "Try everything at once",
        "A test with a hypothesis, metric, and timebox",
        "A meeting to discuss ideas",
        "A slide summarizing the goal",
      ],
      answer: "A test with a hypothesis, metric, and timebox",
    },
    {
      type: "mcq",
      question: "Which metric is most useful?",
      options: [
        "Vanity metric only",
        "A metric tied to the objective",
        "Any metric you can find",
        "No metrics needed",
      ],
      answer: "A metric tied to the objective",
    },
    {
      type: "mcq",
      question: "What should you do with constraints?",
      options: [
        "Ignore them",
        "Explicitly list and design around them",
        "Hide them",
        "Only mention at the end",
      ],
      answer: "Explicitly list and design around them",
    },
    {
      type: "mcq",
      question: "What is a practical number of strategic options to compare?",
      options: ["1", "2–3", "10–15", "As many as possible"],
      answer: "2–3",
    },
    {
      type: "mcq",
      question: "What belongs in the recommendation?",
      options: [
        "Only analysis",
        "A choice + rationale + next steps",
        "Only risks",
        "Only cost",
      ],
      answer: "A choice + rationale + next steps",
    },
    {
      type: "mcq",
      question: "What is a strong final output structure?",
      options: [
        "Unstructured stream of thoughts",
        "Objective → Options → Recommendation → Experiments",
        "Only a table",
        "Only a paragraph",
      ],
      answer: "Objective → Options → Recommendation → Experiments",
    },
  ];
}

function makePromptMcqs(question) {
  const q = String(question || "").trim() || "the problem";
  return [
    {
      type: "mcq",
      question: "Which prompt element most improves consistency?",
      options: [
        "More emojis",
        "Role + constraints + output format",
        "Longer sentences",
        "No structure",
      ],
      answer: "Role + constraints + output format",
    },
    {
      type: "mcq",
      question: "What is the best first step when context is missing?",
      options: [
        "Guess",
        "Ask clarifying questions",
        "Refuse",
        "Give generic advice only",
      ],
      answer: "Ask clarifying questions",
    },
    {
      type: "mcq",
      question: "What does 'output format' mean?",
      options: [
        "Font choice",
        "Exact structure requested (headings/bullets/table)",
        "More tokens",
        "Short answers only",
      ],
      answer: "Exact structure requested (headings/bullets/table)",
    },
    {
      type: "mcq",
      question: "What is an effective constraint you can specify?",
      options: [
        "'Be smart'",
        "Time horizon + assumptions + exclusions",
        "Random details",
        "No constraints",
      ],
      answer: "Time horizon + assumptions + exclusions",
    },
    {
      type: "mcq",
      question: "Best practice for reliability is to request…",
      options: [
        "A single paragraph",
        "A checklist and numbered steps",
        "Poetry",
        "No reasoning",
      ],
      answer: "A checklist and numbered steps",
    },
    {
      type: "mcq",
      question: "What is a good way to reduce hallucination risk?",
      options: [
        "Demand certainty",
        "Ask it to state assumptions + unknowns",
        "Avoid constraints",
        "Use sarcasm",
      ],
      answer: "Ask it to state assumptions + unknowns",
    },
    {
      type: "mcq",
      question: "Few-shot prompting is best described as…",
      options: [
        "Asking many questions",
        "Providing examples of desired outputs",
        "Making it shorter",
        "Using only keywords",
      ],
      answer: "Providing examples of desired outputs",
    },
    {
      type: "mcq",
      question: "What’s the best iteration strategy?",
      options: [
        "Restart from scratch always",
        "Refine under a fixed rubric",
        "Never iterate",
        "Only change tone",
      ],
      answer: "Refine under a fixed rubric",
    },
    {
      type: "mcq",
      question: `For "${q}", which request yields the most actionable answer?`,
      options: [
        "Explain the topic generally",
        "Give objective, options, recommendation, and 2-week plan in headings",
        "Tell a story",
        "Summarize in one word",
      ],
      answer:
        "Give objective, options, recommendation, and 2-week plan in headings",
    },
    {
      type: "mcq",
      question: "Which is a strong 'role' instruction?",
      options: [
        "'Act normal'",
        "'You are a senior strategy consultant'",
        "'Be creative'",
        "'Be brief'",
      ],
      answer: "'You are a senior strategy consultant'",
    },
  ];
}

function makeTfs(mode) {
  if (mode === "prompt") {
    return [
      {
        type: "tf",
        question:
          "True or false: Asking clarifying questions can improve answer quality.",
        answer: "True",
      },
      {
        type: "tf",
        question: "True or false: Output format requirements reduce ambiguity.",
        answer: "True",
      },
      {
        type: "tf",
        question:
          "True or false: Constraints are optional for reliable prompts.",
        answer: "False",
      },
    ];
  }
  return [
    {
      type: "tf",
      question: "True or false: Success metrics should be defined early.",
      answer: "True",
    },
    {
      type: "tf",
      question:
        "True or false: Testing 2–3 options is usually better than testing 12 at once.",
      answer: "True",
    },
    {
      type: "tf",
      question:
        "True or false: Constraints can be ignored if the idea is strong.",
      answer: "False",
    },
  ];
}

function makeOpen(mode, question) {
  const q = String(question || "").trim() || "the problem";
  if (mode === "prompt") {
    return [
      {
        type: "open",
        question: `Write a copy-ready prompt to solve: "${q}". Include role, clarifying questions first, constraints, and output format.`,
      },
    ];
  }
  return [
    {
      type: "open",
      question: `For "${q}", propose a 2-week experiment. Include hypothesis, metric, and what decision you’ll make from the results.`,
    },
  ];
}

function buildExamEnvelope(mode, question) {
  const m = mode === "prompt" ? "prompt" : "business";
  const q = String(question || "").trim() || "your question";

  const mcq = m === "prompt" ? makePromptMcqs(q) : makeBusinessMcqs(q);
  const tf = makeTfs(m);
  const open = makeOpen(m, q);

  return { mode: m, question: q, mcq, tf, open };
}

function buildGenerateExamResponse(body, raw) {
  if (body && body._json_parse_error)
    return buildNeedsClarifyResponse(raw, "invalid_json");

  const mode = normalizeMode(body);
  const q0 =
    decodeQuestionIfNeeded(body, pickQuestionFromBody(body)) || "your question";
  const exam = buildExamEnvelope(mode, q0);

  const API_Exam_JSON = JSON.stringify(exam);

  return {
    ok: true,
    API_OK: "true",
    raw,
    component_result: "success",
    API_Exam_JSON,
    API_MCQ: Array.isArray(exam.mcq) ? exam.mcq.length : 0,
    API_TF: Array.isArray(exam.tf) ? exam.tf.length : 0,
    API_OPEN: Array.isArray(exam.open) ? exam.open.length : 0,
    data: { raw, exam },
  };
}

function scoreOpenHeuristics(mode, openAnswer) {
  const text = String(openAnswer || "").toLowerCase();
  const hits = (keys) => keys.some((k) => text.includes(k));

  // simple, deterministic rubric
  let score = 0;
  let strengths = [];
  let gaps = [];

  if (mode === "prompt") {
    if (hits(["you are", "act as", "role"])) {
      score += 1;
      strengths.push("You specified a role.");
    } else
      gaps.push("Add a role (e.g., 'You are a senior strategy consultant').");

    if (hits(["clarifying", "questions", "ask"])) {
      score += 1;
      strengths.push("You asked for clarifying questions first.");
    } else gaps.push("Ask for 1–3 clarifying questions before answering.");

    if (hits(["constraints", "assumptions", "time horizon", "scope"])) {
      score += 1;
      strengths.push("You included constraints/assumptions.");
    } else
      gaps.push("Add constraints (time horizon, assumptions, exclusions).");

    if (hits(["headings", "bullet", "format", "table", "structure"])) {
      score += 1;
      strengths.push("You specified output format.");
    } else gaps.push("Specify an output format (headings/bullets/table).");

    if (
      hits([
        "objective",
        "kpi",
        "options",
        "recommendation",
        "next steps",
        "experiment",
      ])
    ) {
      score += 1;
      strengths.push("You requested actionable strategy elements.");
    } else
      gaps.push(
        "Request objective/KPIs, options, recommendation, and a short experiment plan."
      );
  } else {
    if (hits(["hypothesis"])) {
      score += 1;
      strengths.push("You included a hypothesis.");
    } else gaps.push("Add a clear hypothesis.");

    if (hits(["metric", "kpi", "measure"])) {
      score += 1;
      strengths.push("You included a measurable metric.");
    } else gaps.push("Specify a metric/KPI.");

    if (hits(["2-week", "two-week", "timebox", "timeline"])) {
      score += 1;
      strengths.push("You included a timebox.");
    } else gaps.push("Add a timebox (e.g., 2 weeks).");

    if (hits(["decision", "if", "then"])) {
      score += 1;
      strengths.push("You defined a decision rule.");
    } else gaps.push("Define how results change your decision.");

    if (hits(["experiment", "test", "pilot"])) {
      score += 1;
      strengths.push("You framed it as a test/pilot.");
    } else gaps.push("Frame it explicitly as an experiment/test.");
  }

  return { score, strengths, gaps };
}

function buildGradeOpenResponse(body, raw) {
  if (body && body._json_parse_error)
    return buildNeedsClarifyResponse(raw, "invalid_json");

  const mode = normalizeMode(body);
  const q0 =
    decodeQuestionIfNeeded(body, pickQuestionFromBody(body)) || "your question";
  const open_q = String(body?.open_q || "").trim();
  const open_user_answer = String(
    body?.open_user_answer || body?.answer || ""
  ).trim();

  const rubric = scoreOpenHeuristics(mode, open_user_answer);

  const open_feedback =
    `Strengths:\n- ${rubric.strengths.length ? rubric.strengths.join("\n- ") : "Good start — you answered the question."}\n\n` +
    `Improvements:\n- ${rubric.gaps.length ? rubric.gaps.join("\n- ") : "None — this is solid for MVP."}\n\n` +
    `Score (rubric): ${rubric.score}/5`;

  const model =
    mode === "prompt"
      ? `You are a senior strategy consultant. My question: "${q0}".\n` +
        `First ask up to 3 clarifying questions. Then provide:\n` +
        `1) Objective & success metrics\n2) Assumptions + constraints\n3) 3 options (impact vs effort)\n` +
        `4) Recommendation + 2-week experiment plan (hypothesis + metric)\n5) Risks + mitigations\n` +
        `Output with headings and bullets.`
      : `Hypothesis: If we do X for 2 weeks, metric Y will improve by Z.\n` +
        `Experiment: Run a timeboxed pilot with a clear control/comparison.\n` +
        `Metric: Track Y daily/weekly; success threshold = Z.\n` +
        `Decision: If threshold met, scale; if not, pivot or stop with a documented learning.`;

  const open_model_answer = open_q
    ? `Question: ${open_q}\n\nModel answer:\n${model}`
    : `Model answer:\n${model}`;

  return {
    ok: true,
    API_OK: "true",
    raw,
    component_result: "success",
    open_feedback,
    open_model_answer,
    open_score: String(rubric.score),
    data: { raw, mode, question: q0, open_q, open_user_answer, rubric },
  };
}

// ---------------------------------------------------------------------------
// Diagnostics
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
// Direct endpoints (Voiceflow API blocks)
// ---------------------------------------------------------------------------

app.post("/optimize_question", requireApiKey, async (req, res) => {
  const body = req.body || {};
  const raw = await callPromptService("optimize_question", body); // will stub if PROMPT_URL missing
  logLlmPayloadSnippet(raw);
  return res.json(buildOptimizeQuestionResponse(body, raw));
});

app.post("/teach_and_quiz", requireApiKey, async (req, res) => {
  const body = req.body || {};
  const raw = await callPromptService("teach_and_quiz", body); // will stub if PROMPT_URL missing
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

// NEW: Prompt engineering lesson (Agent 2)
app.post("/prompt_lesson", requireApiKey, async (req, res) => {
  const body = req.body || {};
  const raw = await callPromptService("prompt_lesson", body);
  logLlmPayloadSnippet(raw);
  return res.json(buildPromptLessonResponse(body, raw));
});

// NEW: Exam generator (10 MCQ / 3 TF / 1 open)
app.post("/generate_exam", requireApiKey, async (req, res) => {
  const body = req.body || {};
  const raw = await callPromptService("generate_exam", body);
  logLlmPayloadSnippet(raw);
  return res.json(buildGenerateExamResponse(body, raw));
});

// NEW: Open-answer grading (automated feedback)
app.post("/grade_open", requireApiKey, async (req, res) => {
  const body = req.body || {};
  const raw = await callPromptService("grade_open", body);
  logLlmPayloadSnippet(raw);
  return res.json(buildGradeOpenResponse(body, raw));
});

// ---------------------------------------------------------------------------
// Core webhook handler (action router used by tests + legacy flows)
// ---------------------------------------------------------------------------

app.post("/webhook", requireApiKey, async (req, res) => {
  const body = req.body || {};
  const action = body.action || body.type || "";

  // ping (used in smoke + verify_in_process)
  if (action === "ping") {
    const port =
      currentServer &&
      currentServer.address() &&
      typeof currentServer.address() === "object"
        ? currentServer.address().port
        : Number(process.env.PORT || DEFAULT_PORT);
    return res.json({ ok: true, API_OK: "true", reply: "pong", port });
  }

  // If JSON was invalid, return deterministic needs_clarify response
  if (body && body._json_parse_error) {
    const raw = makeStubRaw("invalid_json", body);
    return res.json(buildNeedsClarifyResponse(raw, "invalid_json"));
  }

  // regression mirror tests
  if (action === "llm_elicit" || action === "invoke_component") {
    const raw = await callPromptService(action, body);
    logLlmPayloadSnippet(raw);
    return res.json({ ok: true, API_OK: "true", raw, data: { raw } });
  }

  if (action === "generate_lesson") {
    const raw = await callPromptService("generate_lesson", body);
    logLlmPayloadSnippet(raw);
    return res.json(buildGenerateLessonResponse(body, raw));
  }

  if (action === "generate_quiz") {
    const raw = await callPromptService("generate_quiz", body);
    logLlmPayloadSnippet(raw);
    return res.json(buildGenerateQuizResponse(body, raw));
  }

  if (action === "optimize_question") {
    const raw = await callPromptService("optimize_question", body);
    logLlmPayloadSnippet(raw);
    return res.json(buildOptimizeQuestionResponse(body, raw));
  }

  if (action === "teach_and_quiz") {
    const raw = await callPromptService("teach_and_quiz", body);
    logLlmPayloadSnippet(raw);
    return res.json(buildTeachAndQuizResponse(body, raw));
  }

  if (action === "prompt_lesson") {
    const raw = await callPromptService("prompt_lesson", body);
    logLlmPayloadSnippet(raw);
    return res.json(buildPromptLessonResponse(body, raw));
  }

  if (action === "generate_exam") {
    const raw = await callPromptService("generate_exam", body);
    logLlmPayloadSnippet(raw);
    return res.json(buildGenerateExamResponse(body, raw));
  }

  if (action === "grade_open") {
    const raw = await callPromptService("grade_open", body);
    logLlmPayloadSnippet(raw);
    return res.json(buildGradeOpenResponse(body, raw));
  }

  // generic fallback
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

if (require.main === module) {
  startServer();
}

// Helpers expected by some tests.
app.startServer = startServer;
app.closeResources = closeResources;

// Default export is the Express app (in-process handler).
module.exports = app;
