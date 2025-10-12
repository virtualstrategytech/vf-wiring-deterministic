// vf-agent-prompt-engineer/server.js
const express = require('express');
const app = express();
app.use(express.json());
app.use((req,_res,next)=>{ console.log(new Date().toISOString(), req.method, req.url); next(); });

// Health (and optional root) endpoints
app.get('/health', (_req, res) => res.send('ok'));
app.get('/', (_req, res) => res.status(200).send('ok'));

// Combined: teach + quiz
app.post('/v1/teach-and-quiz', (req, res) => {
void String(req.body?.question ?? '');
  const tenantId = String(req.body?.tenantId ?? 'default');

  const promptLesson = {
    strategySummary: "Use SPQA to turn an ambiguous business ask into a crisp prompt.",
    promptPrinciples: [
      "Set role & constraints",
      "Structure inputs (context â†’ task â†’ criteria)",
      "Specify output format",
      "Iterate: critique & refine"
    ],
    demonstrationPrompts: [
      {
        label: "Single-shot",
        prompt: `You are a strategy coach. Using SPQA, rewrite this business question: Â«${question}Â». Output a 4-step plan.`
      },
      {
        label: "Few-shot",
        prompt: `Here are two examples of strong SPQA prompts... Now create one for: Â«${question}Â».`
      },
      {
        label: "Refinement",
        prompt: "Critique the following prompt for clarity/constraints/metrics. Suggest a tighter version."
      }
    ],
    applicationChecklist: [
      "Objective measurable?",
      "Constraints explicit?",
      "Output format unambiguous?",
      "Include critique/refinement?"
    ]
  };

  const quiz = {
    mcq: [
      { q: "In SPQA, what follows Problem?", choices: ["Action","Question","Scope","Answer"], answer: "B", explain: "S â†’ P â†’ Q â†’ A" },
      { q: "Fastest way to reduce ambiguity?", choices: ["More meetings","Answer top questions","Add stakeholders","Extend timeline"], answer: "B", explain: "Answer key questions." },
      { q: "What improves prompt reliability?", choices: ["Vague goals","No constraints","Explicit output format","Skip critique"], answer: "C", explain: "Be explicit." }
    ],
    tf: [
      { q: "SPQA = Situation, Problem, Questions, Actions.", answer: true,  explain: "Correct order." },
      { q: "Refinement is optional for complex tasks.",     answer: false, explain: "Refinement is essential." }
    ],
    open: [
      { q: "Rewrite the userâ€™s question using SPQA. Provide one 48-hour action.", rubric: ["Situation restated","Measurable problem","Top Qs listed","48-hour action present"] }
    ]
  };

  res.json({ ok: true, promptLesson, quiz, tenantId });
});

// Quiz-only (optional)
app.post('/v1/quizzes/generate', (req, res) => {
void String(req.body?.question ?? '');
  const tenantId = String(req.body?.tenantId ?? 'default');

  const quiz = {
    mcq: [
      { q: "In SPQA, what follows Problem?", choices: ["Action","Question","Scope","Answer"], answer: "B", explain: "S â†’ P â†’ Q â†’ A" },
      { q: "Fastest way to reduce ambiguity?", choices: ["More meetings","Answer top questions","Add stakeholders","Extend timeline"], answer: "B", explain: "Answer key questions." },
      { q: "What improves prompt reliability?", choices: ["Vague goals","No constraints","Explicit output format","Skip critique"], answer: "C", explain: "Be explicit." }
    ],
    tf: [
      { q: "SPQA = Situation, Problem, Questions, Actions.", answer: true,  explain: "Correct order." },
      { q: "Refinement is optional for complex tasks.",     answer: false, explain: "Refinement is essential." }
    ],
    open: [
      { q: "Rewrite the userâ€™s question using SPQA. Provide one 48-hour action.", rubric: ["Situation restated","Measurable problem","Top Qs listed","48-hour action present"] }
    ]
  };

  res.json({ ok: true, quiz, tenantId });
});

app.listen(process.env.PORT || 3000, () =>
  console.log('prompt-coach up on', process.env.PORT || 3000)
);

