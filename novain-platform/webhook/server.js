//
// server.js
// Minimal webhook router for Voiceflow → Render
//

const express = require("express");
const crypto = require("crypto");
const bodyParser = require("body-parser");

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------

const PORT = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
const APP_NAME = "vf-webhook-service";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Simple HMAC checker for incoming requests.
 */
function verifySignature(req, res, buf) {
  if (!WEBHOOK_SECRET) return;

  const signature = req.header("x-vf-signature");
  if (!signature) {
    console.warn("[verifySignature] missing x-vf-signature");
    return;
  }

  const hmac = crypto.createHmac("sha256", WEBHOOK_SECRET);
  hmac.update(buf);
  const digest = hmac.digest("hex");

  if (digest !== signature) {
    console.warn("[verifySignature] invalid signature");
    // We *log* the error but do not reject here to keep local dev simple.
  }
}

/**
 * Small logging helper.
 */
function logRequest(label, payload) {
  console.log(`[${APP_NAME}] ${label}`, JSON.stringify(payload, null, 2));
}

// -----------------------------------------------------------------------------
// App
// -----------------------------------------------------------------------------

const app = express();

// Keep raw body for HMAC, but still parse JSON.
app.use(
  bodyParser.json({
    verify: verifySignature,
  })
);

// Basic health endpoint for Render / CI
app.get("/health", (req, res) => {
  res.status(200).json({ ok: true, service: APP_NAME, health: "green" });
});

// -----------------------------------------------------------------------------
// Main webhook router
// -----------------------------------------------------------------------------

app.post("/webhook", async (req, res) => {
  try {
    const action = (req.body && req.body.action) || "";
    const question = (req.body && req.body.question) || "";
    const tenantId = (req.body && req.body.tenantId) || "novain_default";

    logRequest("incoming", { action, tenantId });

    // -------------------------------------------------------------------------
    // Shared debug helper
    // -------------------------------------------------------------------------
    function baseReply(extra = {}) {
      return {
        ok: true,
        tenantId,
        ...extra,
      };
    }

    // -------------------------------------------------------------------------
    // ---- optimize_question
    // -------------------------------------------------------------------------
    if (action === "optimize_question") {
      if (!question.trim()) {
        return res
          .status(400)
          .json({ ok: false, reply: "Missing `question` for optimization" });
      }

      const cleaned = question.trim().replace(/\s+/g, " ");
      const optimized = cleaned.endsWith("?") ? cleaned : `${cleaned}?`;

      const debug_trace = {
        step: "optimize_question_v1",
        input: question,
        output: optimized,
      };

      const agent_reply =
        "Got it, here is your optimized question. If anything looks off, you can always rephrase it.";
      return res.status(200).json(
        baseReply({
          debug_trace,
          optimized_question: optimized,
          agent_reply,
        })
      );
    }

    // -------------------------------------------------------------------------
    // ---- generate_lesson (Agent 1 – business strategy lesson)
    // -------------------------------------------------------------------------
    if (action === "generate_lesson") {
      if (!question.trim()) {
        return res.status(400).json({
          ok: false,
          reply: "Missing `question` for lesson generation",
        });
      }

      const firstName = (req.body && req.body.first_name) || "there";
      const sessionId = (req.body && req.body.session_id) || "session";

      const stubLesson = {
        title: "Clarify Ambiguity with the SPQA Frame",
        objectives: [
          "Clarify ambiguous business asks using SPQA (Situation, Problem, Question, Actions).",
          "Turn messy stakeholder requests into crisp, answerable questions.",
          "Connect strategic thinking to concrete, time-bound actions.",
        ],
        content: [
          `1. **Situation** – briefly restate the context of the request: who, what, where, and when.`,
          `2. **Problem** – define the friction or risk if we do nothing. Avoid vague wording.`,
          `3. **Question** – write 1–3 sharp questions whose answers would unlock the next move.`,
          `4. **Actions** – propose a small set of actions tied directly to those answers.`,
          "",
          `In your case, we’d apply SPQA to: "${question}". Start by writing a 2–3 sentence situation, then one clear problem statement, then 2–3 questions, and finally a short action plan.`,
        ].join("\n"),
        keyTakeaways: [
          "SPQA stands for Situation, Problem, Question, Actions.",
          "Good strategy questions reduce uncertainty instead of creating more noise.",
          "Every strategic insight should end in a clear, time-bound action.",
        ],
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

      const reply = `Lesson ready, ${firstName}.`;
      return res.status(200).json(
        baseReply({
          reply,
          lessonTitle: stubLesson.title,
          bulletCount: stubLesson.keyTakeaways.length,
          lesson: stubLesson,
        })
      );
    }

    // -------------------------------------------------------------------------
    // ---- generate_quiz (lesson-aware prompt engineering)
    //
    // Agent 2 reads the business strategy lesson produced by Agent 1 and
    // turns it into (a) a prompt-design teaching object and (b) a quiz
    // that reinforces both the business concept and the prompt principles.
    // -------------------------------------------------------------------------
    if (action === "generate_quiz") {
      if (!question.trim()) {
        return res.status(400).json({ ok: false, reply: "Missing `question`" });
      }

      // Pull the lesson from the request if present. Voiceflow sends the
      // lesson JSON as `lesson` in the body; it may arrive as a string or object.
      const rawLesson =
        (req.body && (req.body.lesson || req.body.API_Lesson_JSON)) || null;

      let lesson = {};
      if (rawLesson) {
        try {
          lesson =
            typeof rawLesson === "string" ? JSON.parse(rawLesson) : rawLesson;
        } catch {
          lesson = {};
        }
      }

      const title =
        (lesson && lesson.title && String(lesson.title).trim()) ||
        "Clarify Ambiguity with the SPQA Frame";

      const takeaways =
        Array.isArray(lesson && lesson.keyTakeaways) &&
        lesson.keyTakeaways.length > 0
          ? lesson.keyTakeaways.map((t) => String(t).trim()).filter(Boolean)
          : [
              "Use SPQA (Situation, Problem, Question, Actions) to clarify messy asks.",
              "Answer the right questions before you jump into solutions.",
              "Translate insights into specific, near-term actions.",
            ];

      const primaryTakeaway = (takeaways[0] || "").slice(0, 240);

      // Prompt-engineering lesson built from the business lesson
      const promptLesson = {
        strategySummary:
          primaryTakeaway ||
          `Use "${title}" to turn ambiguous tasks into clear, actionable work.`,
        promptPrinciples: [
          `Anchor the AI prompt on the lesson or framework "${title}".`,
          "Restate the situation and problem in 1–2 sentences.",
          "List 2–4 clarifying questions before asking for answers.",
          "Specify output format and horizon (e.g. 30–60–90 day plan).",
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
              'Ask the AI to "do strategy" with no context.',
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

      return res.status(200).json(
        baseReply({
          reply: "Your prompt lesson and quiz are ready.",
          lessonTitle: title,
          mcqCount: quiz.mcq.length,
          tfCount: quiz.tf.length,
          openCount: quiz.open.length,
          promptLesson,
          quiz,
        })
      );
    }

    // -------------------------------------------------------------------------
    // ---- export_lesson (for future use – e.g., saving to KB)
    // -------------------------------------------------------------------------
    if (action === "export_lesson") {
      // This is just a stub for now; you can extend it later to push
      // lessons into Pinecone / Supabase / etc.
      return res
        .status(200)
        .json(
          baseReply({ reply: "Lesson export stub – not implemented yet." })
        );
    }

    // -------------------------------------------------------------------------
    // Unknown action
    // -------------------------------------------------------------------------
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
