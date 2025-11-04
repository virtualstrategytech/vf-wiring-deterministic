const express = require('express');
const app = express();
app.use(express.json());

// keep the existing simple route
app.post('/generate_lesson', (req, res) => {
  return res.json({
    ok: true,
    lesson: {
      title: 'Mock Lesson: SPQA',
      content: 'Short mock lesson content',
      keyTakeaways: ['Use SPQA', 'Keep prompts short'],
      references: [],
    },
  });
});

// add the endpoint the webhook expects
app.post('/v1/lessons/generate', (req, res) => {
  // mirror the same response shape the real BUSINESS service uses
  return res.json({
    ok: true,
    lesson: {
      title: 'Mock Lesson: SPQA',
      content: 'Short mock lesson content',
      keyTakeaways: ['Use SPQA', 'Keep prompts short'],
      references: [],
    },
  });
});

const mockResponse = {
  lesson: {
    title: 'Mock Lesson: SPQA',
    content: 'Short mock lesson content',
    keyTakeaways: ['Use SPQA', 'Keep prompts short'],
    references: [],
  },
  quiz: {
    title: 'Mock Quiz: SPQA',
    questions: [{ q: 'What does SPQA stand for?', a: 'Short Prompt Question Answer' }],
  },
  elicitation: {
    prompts: ['Tell me about the problem you face', 'What outcome do you want?'],
  },
};

function maybeDelay(req) {
  const d = Number(req.body?.delayMs || 0);
  return new Promise((resolve) => globalThis.setTimeout(resolve, Math.max(0, d)));
}

async function handler(req, res, payload) {
  // simulate errors for testing: send { mode: 'error' } in request body
  if (req.body && req.body.mode === 'error') {
    return res.status(500).json({ ok: false, reply: 'mock_error' });
  }
  await maybeDelay(req);
  return res.json({ ok: true, ...payload });
}

// compatibility routes + canonical v1 routes
app.post('/generate_lesson', (req, res) => handler(req, res, { lesson: mockResponse.lesson }));
app.post('/v1/lessons/generate', (req, res) => handler(req, res, { lesson: mockResponse.lesson }));

app.post('/generate_quiz', (req, res) => handler(req, res, { quiz: mockResponse.quiz }));
app.post('/v1/quizzes/generate', (req, res) => handler(req, res, { quiz: mockResponse.quiz }));

app.post('/elicitation', (req, res) =>
  handler(req, res, { elicitation: mockResponse.elicitation })
);
app.post('/v1/elicitation/generate', (req, res) =>
  handler(req, res, { elicitation: mockResponse.elicitation })
);

const port = process.env.PORT || 4000;
const server = app.listen(port, () => console.log(`Mock BUSINESS service listening on ${port}`));

function gracefulShutdown(signal) {
  try {
    console.log(`Received ${signal}; shutting down mock business server`);
  } catch {}
  try {
    const client = require('../lib/http-client');
    if (client && typeof client.closeAllClients === 'function') client.closeAllClients();
  } catch (e) {}
  try {
    server.close(() => {
      try {
        process.exit(0);
      } catch {}
    });
  } catch (e) {}
  setTimeout(() => {
    try {
      process.exit(1);
    } catch {}
  }, 5000).unref();
}
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
