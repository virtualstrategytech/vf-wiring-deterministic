//
// server.js
// Webhook service for NovAIn Teach & Quiz
//

const express = require("express");
const crypto = require("crypto");
const bodyParser = require("body-parser");

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------

const PORT = process.env.PORT || 3000;

// Shared API key guard (for Voiceflow / curls / CI)
const WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY || "";

// Optional HMAC secret (for Voiceflow x-vf-signature)
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";

const APP_NAME = "vf-webhook-service";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Keep the raw body so we can validate x-vf-signature with HMAC, but
 * still let bodyParser.json turn the body into req.body.
 */
function verifySignature(req, res, buf) {
  if (!WEBHOOK_SECRET) return; // disabled if secret not set

  const signature = req.header("x-vf-signature");
  if (!signature) {
    console.warn("[verifySignature] missing x-vf-signature");
    return;
  }

  try {
    const hmac = crypto.createHmac("sha256", WEBHOOK_SECRET);
    hmac.update(buf);
    const digest = hmac.digest("hex");

    if (digest !== signature) {
      console.warn("[verifySignature] invalid signature");
      // Intentionally *log only* so local dev stays simple.
    }
  } catch (err) {
    console.warn("[verifySignature] error while verifying", err.message);
  }
}

/**
 * Small logging helper.
 */
function logRequest(label, payload) {
  console.log(`[${APP_NAME}] ${label}`, JSON.stringify(payload, null, 2));
}

/**
 * Consistent base reply shape.
 */
function baseReply(tenantId, extra = {}) {
  return {
    ok: true,
    tenantId,
    ...extra,
  };
}

// -----------------------------------------------------------------------------
// App setup
// -----------------------------------------------------------------------------

const app = express();

// Parse JSON and keep raw body for HMAC verification.
app.use(
  bodyParser.json({
    verify: verifySignature,
  })
);

// API key guard – applies to all POST routes, but is a no-op if
// WEBHOOK_API_KEY is not set (local dev).
app.use((req, res, next) => {
  if (req.method !== "POST") return next();

  if (!WEBHOOK_API_KEY) {
    // No key configured → allow everything (useful for local dev).
    return next();
  }

  const incomingKey = req.header("x-api-key") || "";
  if (incomingKey !== WEBHOOK_API_KEY) {
    return res.status(401).json({
      ok: false,
      reply: "unauthorized",
    });
  }

  return next();
});

// Simple health endpoint for Render / CI
app.get("/health", (req, res) => {
  res.status(200).json({ ok: true, service: APP_NAME, health: "green" });
});

// -----------------------------------------------------------------------------
// Core business helpers
// -----------------------------------------------------------------------------

/**
 * Shared optimize-question logic so both /optimize_question and /webhook
 * (action = optimize_question) can use the same behaviour.
 */
function optimizeQuestionCore(rawQuestion) {
  const input = (rawQuestion || "").trim();

  if (!input) {
    return {
      error: "Missing `question` for optimization",
    };
  }

  const cleaned = input.replace(/\s+/g, " ");
  const optimized = cleaned.endsWith("?") ? cleaned : `${cleaned}?`;

  const debug_trace = {
    step: "optimize_question_v1",
    input,
    output: optimized,
  };

  const agent_reply =
    "Got it, here is your optimized question. If anything looks off, you can rephrase it and I’ll try again.";

  return {
    optimized_question: optimized,
    debug_trace,
    agent_reply,
  };
}

/**
 * Build the “business strategy” lesson (Agent 1).
 */
function buildLesson(question, sessionId) {
  const title = "Clarify Ambiguity with the SPQA Frame";

  const keyTakeaways = [
    "Use SPQA (Situation, Problem, Question, Actions) to clarify ambiguous business requests.",
    "Turn messy stakeholder asks into crisp, answerable questions.",
    "Connect strategic insight directly to concrete, time-bound actions.",
  ];

  const contentLines = [
    "1. **Situation** – briefly restate the context of the request: who, what, where, and when.",
    "2. **Problem** – define the friction or risk if nothing changes. Avoid vague wording.",
    "3. **Question** – write 1–3 sharp questions whose answers would unlock the next move.",
    "4. **Actions** – propose a short set of actions tied directly to those answers.",
    "",
    `In your case, we’d apply SPQA to: "${question}". Start with a 2–3 sentence situation, then one clear problem statement, then 2–3 questions, and finally a short action plan.`,
  ];

  return {
    title,
    objectives: [
      "Clarify ambiguous business asks using SPQA.",
      "Reduce noise by focusing on the right questions.",
      "Translate strategic framing into specific actions.",
    ],
    content: contentLines.join("\n"),
    keyTakeaways,
    references: [
      "Internal: NovAIn SPQA one-pager.",
      "External: Basic strategy problem-framing articles.",
    ],
    meta: {
      question,
      createdBy: "Agent 1 – business strategist",
      sessionId,
    },
  };
}

/**
 * Build prompt-engineering lesson + quiz (Agent 2) from a business lesson.
 */
function buildPromptLessonAndQuiz(question, lesson) {
  const safeLesson = lesson || {};
  const title =
    (safeLesson.title && String(safeLesson.title).trim()) ||
    "Clarify Ambiguity with the SPQA Frame";

  const takeaways =
    Array.isArray(safeLesson.keyTakeaways) && safeLesson.keyTakeaways.length > 0
      ? safeLesson.keyTakeaways.map((t) => String(t).trim()).filter(Boolean)
      : [
          "Use SPQA (Situation, Problem, Question, Actions) to clarify messy asks.",
          "Answer the right questions before jumping into solutions.",
          "Translate insights into specific, near-term actions.",
        ];

  const primaryTakeaway = (takeaways[0] || "").slice(0, 240);

  const promptLesson = {
    strategySummary:
      primaryTakeaway ||
      `Use "${title}" to turn ambiguous tasks into clear, actionable work.`,
    promptPrinciples: [
      `Anchor the AI prompt on the lesson or framework "${title}".`,
      "Restate the situation and problem in 1–2 sentences.",
      "List 2–4 clarifying questions before asking for answers.",
      "Specify output structure and timeframe (e.g., 30–60–90 day plan).",
      "Include a critique/refinement step for complex work.",
    ],
    demonstrationPrompts: [
      {
        label: "Single-shot",
        prompt: `You are a strategy coach. Using the lesson "${title}", rewrite this business question: "${question}". Output: a 4-step action plan that clearly applies the lesson.`,
      },
      {
        label: "Few-shot",
        prompt: `Here are key takeaways from the lesson "${title}": ${takeaways
          .slice(0, 3)
          .join(
            "; "
          )}. Using these, design an AI prompt that first gathers context, then applies the lesson to propose 3–5 concrete actions.`,
      },
      {
        label: "Refinement",
        prompt: `You are a prompt engineer. Critique the following AI prompt for how well it applies the lesson "${title}". Suggest a tighter version that better reflects these takeaways: ${takeaways
          .slice(0, 3)
          .join("; ")}.`,
      },
    ],
    applicationChecklist: [
      "Does the prompt explicitly reference the lesson or framework?",
      "Does it ask for context (situation, audience, constraints, timeframe)?",
      "Is the desired output format clear and unambiguous?",
      "Is there a built-in critique or refinement step?",
    ],
  };

  const quiz = {
    mcq: [
      {
        q: `Which option best reflects a key takeaway from the lesson "${title}"?`,
        choices: [
          primaryTakeaway ||
            "Use SPQA to clarify the situation, problem, questions, and actions.",
          "Jump straight into drafting assets without clarifying the problem.",
          "Ask the AI to “do strategy” with no context.",
          "Focus only on tools and ignore the business situation.",
        ],
        answer: "A",
        explain:
          "Option A mirrors the lesson; the other options skip context and structured thinking.",
      },
      {
        q: "When turning a business lesson into an AI prompt, what should you do first?",
        choices: [
          "Specify the model temperature.",
          "Paste every document you have into the prompt.",
          "Restate the user's situation and problem clearly.",
          "Ask for a 20-page report to be safe.",
        ],
        answer: "C",
        explain:
          "Clarity on situation and problem comes before model parameters or output length.",
      },
      {
        q: "Which prompt pattern most improves reliability for strategy work?",
        choices: [
          "Keep everything vague so the model can be creative.",
          "Avoid setting any constraints or success criteria.",
          "Specify structure, constraints, and explicit output format.",
          "Rely only on the model's default behaviour.",
        ],
        answer: "C",
        explain:
          "Structure + constraints + explicit output format reduce ambiguity and make results usable.",
      },
    ],
    tf: [
      {
        q: "True or false: for complex work, you should usually include a refinement or critique step in your prompt.",
        answer: true,
        explain:
          "Iterating and critiquing the first answer surfaces gaps and improves quality.",
      },
      {
        q: `True or false: the lesson "${title}" should only be used once at the end of a project.`,
        answer: false,
        explain:
          "You apply the lesson iteratively as you clarify the problem and execute actions.",
      },
    ],
    open: [
      {
        q: `Rewrite your current business question as an AI prompt that applies the lesson "${title}". Include context, the problem, and a clear desired output.`,
        rubric: [
          "Mentions or clearly applies the lesson/framework.",
          "Includes concrete context (situation, audience, constraints).",
          "Defines a clear problem or outcome.",
          "Specifies output format and immediate next-step actions.",
        ],
      },
    ],
  };

  return { promptLesson, quiz, lessonTitle: title };
}

// -----------------------------------------------------------------------------
// Routes
// -----------------------------------------------------------------------------

// 1) Legacy / direct endpoint for optimize_question
app.post("/optimize_question", (req, res) => {
  const tenantId =
    req.body && req.body.tenantId ? req.body.tenantId : "novain_default";

  // Voiceflow sends last_utterance; allow both.
  const rawQuestion =
    (req.body && (req.body.question || req.body.last_utterance)) || "";

  const result = optimizeQuestionCore(rawQuestion);
  if (result.error) {
    return res.status(400).json({ ok: false, reply: result.error });
  }

  const { optimized_question, debug_trace, agent_reply } = result;
  return res.status(200).json(
    baseReply(tenantId, {
      optimized_question,
      debug_trace,
      agent_reply,
    })
  );
});

// 2) Main multi-action webhook
app.post("/webhook", async (req, res) => {
  try {
    const action = (req.body && req.body.action) || "";
    const tenantId = (req.body && req.body.tenantId) || "novain_default";

    const firstName = (req.body && req.body.first_name) || "there";
    const sessionId = (req.body && req.body.session_id) || "session";

    // For most flows, “question” is the optimized business question.
    // Fallback to last_utterance so OptimizeQuestion can also use /webhook.
    const question =
      (req.body &&
        (req.body.question ||
          req.body.optimized_question ||
          req.body.last_utterance)) ||
      "";

    logRequest("incoming", { action, tenantId });

    // -----------------------------------------------------------------------
    // action: optimize_question
    // -----------------------------------------------------------------------
    if (action === "optimize_question") {
      const result = optimizeQuestionCore(question);
      if (result.error) {
        return res.status(400).json({ ok: false, reply: result.error });
      }
      const { optimized_question, debug_trace, agent_reply } = result;
      return res.status(200).json(
        baseReply(tenantId, {
          optimized_question,
          debug_trace,
          agent_reply,
        })
      );
    }

    // -----------------------------------------------------------------------
    // action: generate_lesson  (Agent 1 – business strategy)
    // -----------------------------------------------------------------------
    if (action === "generate_lesson") {
      if (!question.trim()) {
        return res.status(400).json({
          ok: false,
          reply: "Missing `question` for lesson generation",
        });
      }

      const lesson = buildLesson(question, sessionId);

      const reply = `Lesson ready, ${firstName}.`;
      return res.status(200).json(
        baseReply(tenantId, {
          reply,
          lessonTitle: lesson.title,
          bulletCount: lesson.keyTakeaways.length,
          lesson,
        })
      );
    }

    // -----------------------------------------------------------------------
    // action: generate_quiz  (Agent 2 – prompt engineering)
    // -----------------------------------------------------------------------
    if (action === "generate_quiz") {
      if (!question.trim()) {
        return res.status(400).json({
          ok: false,
          reply: "Missing `question` for quiz generation",
        });
      }

      // Voiceflow sends the previously generated lesson as `lesson`.
      const rawLesson =
        (req.body && (req.body.lesson || req.body.API_Lesson_JSON)) || null;

      let lesson = null;
      if (rawLesson) {
        try {
          lesson =
            typeof rawLesson === "string" ? JSON.parse(rawLesson) : rawLesson;
        } catch (err) {
          console.warn("[generate_quiz] failed to parse lesson JSON:", err);
          lesson = null;
        }
      }

      const { promptLesson, quiz, lessonTitle } = buildPromptLessonAndQuiz(
        question,
        lesson
      );

      const reply = "Your prompt lesson and quiz are ready.";
      return res.status(200).json(
        baseReply(tenantId, {
          reply,
          lessonTitle,
          mcqCount: quiz.mcq.length,
          tfCount: quiz.tf.length,
          openCount: quiz.open.length,
          promptLesson,
          quiz,
        })
      );
    }

    // -----------------------------------------------------------------------
    // action: export_lesson (stub for future KB export)
    // -----------------------------------------------------------------------
    if (action === "export_lesson") {
      return res.status(200).json(
        baseReply(tenantId, {
          reply: "Lesson export stub – not implemented yet.",
        })
      );
    }

    // -----------------------------------------------------------------------
    // Unknown action
    // -----------------------------------------------------------------------
    return res.status(400).json({
      ok: false,
      reply: `Unknown action: ${action}`,
    });
  } catch (err) {
    console.error("[/webhook] unhandled error", err);
    return res.status(500).json({
      ok: false,
      reply: "Unhandled error in webhook.",
    });
  }
});

// -----------------------------------------------------------------------------
// Start
// -----------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`[${APP_NAME}] listening on port ${PORT}`);
});
