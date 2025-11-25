const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");

// -----------------------------------------------------------------------------
// Basic config
// -----------------------------------------------------------------------------

const APP_NAME = process.env.APP_NAME || "vf-webhook-service";
const PORT = process.env.PORT || 3000;

// In a real system this would be a proper logger; for now keep it simple
const logger = console;

// -----------------------------------------------------------------------------
// Helper: very small “LLM-ish” formatter we still fully control
// -----------------------------------------------------------------------------

/**
 * Deterministic helper to turn a “lesson” object into a promptLesson + quiz.
 * This is **not** calling an external LLM – it’s just structured formatting
 * so the rest of the system can be wired and tested safely.
 *
 * @param {object} lesson - lesson object coming from generate_lesson
 * @returns {{ promptLesson: object, quiz: object }}
 */
function buildPromptLessonAndQuizFromLesson(lesson) {
  const fallbackTitle = lesson.title || "Clarify Ambiguity with the SPQA Frame";

  const strategySummary =
    (lesson.strategySummary ||
      "Use SPQA to turn ambiguous tasks into crisp prompts.") + "";

  const promptPrinciples = lesson.promptPrinciples || [
    "Set a clear objective: structure inputs (context + task + criteria).",
    "Specify output format.",
    "Iterate: critique & refine.",
  ];

  const demonstrationPrompts = lesson.demonstrationPrompts || [
    {
      label: "Single-shot",
      prompt:
        "You are a strategy coach. Using SPQA, rewrite this business question: [user's question].",
    },
    {
      label: "Refinement",
      prompt:
        "Critique the following prompt for clarity, constraints, and measurability. Suggest a tighter version. Output: a step plan.",
    },
  ];

  // Build some deterministic MCQs + T/F + open questions
  const mcqQuestions = [
    {
      q: 'In SPQA, what comes after "Problem"?',
      choices: ["Action", "Question", "Scope", "Answer"],
      answer: "B",
      explain: "Answering the right questions reduces uncertainty.",
    },
    {
      q: "Which improvement best leverages critique & refinement?",
      choices: [
        "More meetings",
        "Answer top questions",
        "Add stakeholders",
        "Extend timeline",
      ],
      answer: "B",
      explain: "Answering the right questions reduces uncertainty.",
    },
    {
      q: "Which improvement best leverages critique & refinement?",
      choices: [
        "More meetings",
        "Answer top questions",
        "Add stakeholders",
        "Extend timeline",
      ],
      answer: "B",
      explain: "Answering the right questions reduces uncertainty.",
    },
    {
      q: 'Which improvement best reduces ambiguity in "Draft a short note"?',
      choices: [
        "No constraints",
        "Explicit output format",
        "Skip critique",
        "Answer: C",
      ],
      answer: "C",
      explain: "Specify structure & format.",
    },
  ];

  const tfQuestions = [
    {
      q: "SPQA stands for Situation, Problem, Question, Actions.",
      answer: true,
      explain: "Correct order is SPQA.",
    },
    {
      q: "Refinement is optional for complex prompts.",
      answer: false,
      explain: "Refinement is essential for complex prompts.",
    },
  ];

  const openQuestions = [
    {
      q: "Rewrite the user's question using SPQA. Provide one immediate 48-hour action.",
      rubric: [
        "Situation restated",
        "Problem made specific",
        "Question clarified",
        "At least one concrete, time-bound action",
      ],
    },
  ];

  const promptLesson = {
    title: fallbackTitle,
    strategySummary,
    promptPrinciples,
    demonstrationPrompts,
  };

  const quiz = {
    mcq: mcqQuestions,
    tf: tfQuestions,
    open: openQuestions,
  };

  return {
    promptLesson,
    quiz,
    mcqCount: mcqQuestions.length,
    tfCount: tfQuestions.length,
    openCount: openQuestions.length,
  };
}

// -----------------------------------------------------------------------------
// Express app
// -----------------------------------------------------------------------------

const app = express();

app.use(cors());
app.use(bodyParser.json());

// Simple logging so we can see CI calls if needed
app.use((req, res, next) => {
  logger.log(
    `[${APP_NAME}] ${req.method} ${req.path} - x-request-id=${
      req.headers["x-request-id"] || "-"
    }`
  );
  next();
});

// -----------------------------------------------------------------------------
// Simple health endpoint for Render / CI
// CI and the Jest smoke tests expect a plain-text "ok" response.
// -----------------------------------------------------------------------------

app.get("/health", (req, res) => {
  res.status(200).type("text/plain").send("ok");
});

// -----------------------------------------------------------------------------
// Helpers for deterministic “actions” coming from Voiceflow
// -----------------------------------------------------------------------------

/**
 * Ping handler – purely for wiring / smoke tests.
 */
function handlePingAction(reqBody) {
  const name = reqBody.name || "friend";
  const question = reqBody.question || "";
  return {
    ok: true,
    reply: `Hi ${name}, I received: "${question}"`,
    port: PORT,
  };
}

/**
 * Retrieve handler – deterministic stub for now.
 */
function handleRetrieveAction(reqBody) {
  const topic = reqBody.topic || 4;
  const question =
    reqBody.question || "What is SPQA and how is it applied to discovery?";
  return {
    ok: true,
    reply: "Found 0 passages.",
    hitCount: 0,
    tenantId: reqBody.tenantId || "novain_default",
    topic,
    question,
  };
}

/**
 * Generate lesson – Agent 1 (business strategy) deterministic stub.
 * Returns a structured lesson object.
 */
function handleGenerateLessonAction(reqBody) {
  const question =
    reqBody.question || "Teach me SPQA with an example for discovery.";

  const lessonTitle = "Clarify Ambiguity with the SPQA Frame";

  const lesson = {
    title: lessonTitle,
    question,
    frames: [
      {
        id: "spqa_basics",
        label: "Why SPQA",
        bullets: [
          "Ambiguous inputs create ambiguous outputs.",
          "SPQA stands for Situation, Problem, Question, Actions.",
          "Use SPQA to transform vague requests into executable prompts.",
        ],
      },
      {
        id: "spqa_example",
        label: "Example",
        bullets: [
          "Situation: Founder unsure which ICP segment to focus on.",
          "Problem: Limited marketing budget and weak signal on best-fit segment.",
          "Question: Which ICP segment shows strongest pull and scalable economics?",
          "Actions: Define 3 segments, compare activation + retention, rank by LTV/CAC.",
        ],
      },
    ],
    steps: [
      "Restate the situation.",
      "Name the problem specifically.",
      "Ask 1–3 sharp questions.",
      "List actions that can be executed in the next 7–30 days.",
    ],
    checklist: [
      "Is the objective measurable?",
      "Are constraints explicit?",
      "Is the output format unambiguous?",
      "Does the prompt include a critique step?",
    ],
  };

  return {
    ok: true,
    reply: "Lesson ready.",
    lessonTitle,
    bulletCount: lesson.frames.reduce(
      (sum, f) => sum + (f.bullets ? f.bullets.length : 0),
      0
    ),
    lesson,
  };
}

/**
 * Generate quiz – Agent 2 (prompt engineer) consumes the lesson object and
 * returns promptLesson + quiz in a deterministic, testable way.
 */
function handleGenerateQuizAction(reqBody) {
  const lesson = reqBody.lesson || {};
  const base = handleGenerateLessonAction(reqBody);
  const lessonObj = Object.keys(lesson).length ? lesson : base.lesson;

  const { promptLesson, quiz, mcqCount, tfCount, openCount } =
    buildPromptLessonAndQuizFromLesson(lessonObj);

  const reply =
    "Your prompt lesson and quiz are ready. " +
    `lessonTitle="${lessonObj.title || base.lessonTitle}", ` +
    `mcqCount=${mcqCount}, tfCount=${tfCount}, openCount=${openCount}.`;

  return {
    ok: true,
    reply,
    lessonTitle: lessonObj.title || base.lessonTitle,
    promptLesson,
    quiz,
    mcqCount,
    tfCount,
    openCount,
  };
}

/**
 * Optimize question – takes a raw question and normalises it.
 * Still deterministic: we do not call an external LLM here.
 */
function handleOptimizeQuestionAction(reqBody) {
  const lastUtterance =
    reqBody.last_utterance ||
    reqBody.question ||
    "confused how to do business requirements";

  const optimized = lastUtterance.trim();

  return {
    ok: true,
    optimized_question: optimized,
    agent_reply:
      "Got it, paulina (as NovAIn business strategist and prompt-engineering coach). " +
      'So your core problem is: "confused how to do business requirements". ' +
      "Is that a fair summary, and who is the main audience you're working with?",
    debug_trace: "optimize_question_stub_v1",
  };
}

// -----------------------------------------------------------------------------
// Webhook router
// -----------------------------------------------------------------------------

/**
 * Request body is expected to carry an `action` field which decides what
 * deterministic behaviour we execute. This lets Voiceflow wire one
 * `/webhook` URL and switch on `action` in the JSON body.
 */

app.post("/webhook", async (req, res) => {
  try {
    const action = req.body.action;

    logger.log(`[${APP_NAME}] /webhook action=${action || "none"}`);

    if (!action) {
      return res.status(400).json({
        ok: false,
        reply: "Missing `action` in request body.",
      });
    }

    switch (action) {
      case "ping": {
        const payload = handlePingAction(req.body);
        return res.status(200).json(payload);
      }

      case "retrieve": {
        const payload = handleRetrieveAction(req.body);
        return res.status(200).json(payload);
      }

      case "generate_lesson": {
        const payload = handleGenerateLessonAction(req.body);
        return res.status(200).json(payload);
      }

      case "generate_quiz": {
        const payload = handleGenerateQuizAction(req.body);
        return res.status(200).json(payload);
      }

      case "optimize_question": {
        const payload = handleOptimizeQuestionAction(req.body);
        return res.status(200).json(payload);
      }

      default: {
        logger.warn(`[${APP_NAME}] Unknown action`, { action });
        return res.status(400).json({
          ok: false,
          reply: `Unknown action: ${action}`,
        });
      }
    }
  } catch (err) {
    logger.error(`[${APP_NAME}] /webhook unhandled error`, err);
    return res.status(500).json({
      ok: false,
      reply: "Unhandled error in webhook.",
    });
  }
});

// Start
// -----------------------------------------------------------------------------

// Only start the listener when this file is executed directly.
// When the module is `require`d (for example in Jest tests) we
// just export the Express app instance so tests can attach their
// own listener without hitting EADDRINUSE.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[${APP_NAME}] listening on port ${PORT}`);
  });
}

// Export the app for tests and for potential reuse.
module.exports = app;
