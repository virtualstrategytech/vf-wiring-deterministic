// server.js
// Minimal webhook router for Voiceflow → Render microservices

const express = require('express');
const app = express();

// ---- Config (env vars)
const API_KEY = process.env.WEBHOOK_API_KEY || process.env.WEBHOOK_KEY || '';
const PORT = process.env.PORT || 3000;
const RETRIEVAL_URL = process.env.RETRIEVAL_URL || ''; // e.g. https://vf-retrieval-service.onrender.com/v1/retrieve
const BUSINESS_URL = process.env.BUSINESS_URL || ''; // (future)
const PROMPT_URL = process.env.PROMPT_URL || ''; // // e.g. https://vf-prompt-service.onrender.com

let fetchFn = globalThis.fetch;
if (!fetchFn) {
  try {
    const nf = require('node-fetch'); // install: npm i node-fetch@2 (or v3)
    fetchFn = nf;
    globalThis.fetch = fetchFn;
  } catch (err) {
    console.warn('fetch not available. Install node 18+ or node-fetch@2', err);
  }
}
// Minimal runtime safety notice (no secret printed)
if (!API_KEY) {
  console.warn(
    'WEBHOOK_API_KEY not set — webhook endpoints will reject requests without a valid key.'
  );
}
console.log('WEBHOOK_API_KEY present:', !!API_KEY, 'len=', (API_KEY || '').length);
console.log('RETRIEVAL_URL set:', !!RETRIEVAL_URL);

// ---- Middleware (body parser + JSON error handler)
app.use(
  express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    console.error('JSON parse error:', err.message);
    return res.status(400).json({ ok: false, reply: 'bad_json' });
  }
  next(err);
});

// Request logger (before routes)
app.use((req, _res, next) => {
  const rid = req.get('x-request-id') || 'no-request-id';
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} rid=${rid}`);
  next();
});

// ---- Health
app.get('/health', (_req, res) => res.status(200).send('ok'));

function makeMarkdownFromLesson(title, lesson) {
  const head = `# ${title}\n\n`;
  const objectives = (lesson.objectives || []).map((o) => `- ${o}`).join('\n');
  const takeaways = (lesson.keyTakeaways || []).map((t) => `- ${t}`).join('\n');

  let refs = '';
  if (Array.isArray(lesson.references)) {
    refs = lesson.references.map((r) => `- [${r.label || r.url}](${r.url || '#'})`).join('\n');
  }

  const content = lesson.content || '';
  const metaQ = lesson.meta?.question ? `> **User Question:** ${lesson.meta.question}\n\n` : '';

  return [
    head,
    metaQ,
    objectives ? '## Objectives\n' + objectives + '\n\n' : '',
    '## Lesson\n',
    content + '\n\n',
    takeaways ? '## Key Takeaways\n' + takeaways + '\n\n' : '',
    refs ? '## References\n' + refs + '\n' : '',
  ].join('');
}

// ---- export_lesson_file (download endpoint) - must be after express.json middleware
app.post('/export_lesson_file', (req, res) => {
  try {
    const title = String(req.body?.title || 'Lesson');
    const raw = req.body?.lesson || '{}';
    let lesson = {};
    try {
      lesson = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      lesson = {};
    }

    const md = makeMarkdownFromLesson(title, lesson);
    const safe = title.replace(/[^a-z0-9_-]+/gi, '_unused').slice(0, 64) || 'lesson';
    res.set('Content-Type', 'text/markdown; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${safe}.md"`);

    return res.status(200).send(md);
  } catch (_e) {
    console.error('export_lesson_file error:', _e);
    return res.status(500).send('export_failed');
  }
});

// ---- Webhook
app.post('/webhook', async (req, res) => {
  const key = req.get('x-api-key');
  if (key !== API_KEY) return res.status(401).json({ ok: false, reply: 'unauthorized' });

  // ✅ SAFE coercion
  const actionRaw = (req.body && req.body.action) ?? 'ping';
  const action = String(actionRaw).toLowerCase();

  const name = req.body?.name || req.body?.first_name || 'Guest';
  const tenantId = req.body?.tenantId || 'default';
  const topK = Number(req.body?.topK) || 6;

  // Safely coerce question (handles non-strings so .trim() never throws)
  const qRaw = (req.body && (req.body.question ?? req.body.message)) ?? '';
  const question = String(qRaw);
  console.log(`webhook: action=${action} name=${name} tenantId=${tenantId}`);

  try {
    // ---- ping
    if (action === 'ping') {
      const reply = `Hi ${name}, I received: "${question}".`;
      return res.status(200).json({ ok: true, reply, port: PORT });
    }

    // ---- retrieve
    if (action === 'retrieve') {
      if (!RETRIEVAL_URL)
        return res.status(400).json({ ok: false, reply: 'RETRIEVAL_URL not configured' });
      if (!question.trim()) return res.status(400).json({ ok: false, reply: 'Missing `question`' });

      const r = await fetch(RETRIEVAL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: question, topK, tenantId }),
      });

      if (!r.ok) {
        const text = await r.text().catch(() => '');
        console.error('retrieval error:', r.status, text);
        return res.status(502).json({ ok: false, reply: 'retrieval_failed' });
      }

      const data = await r.json().catch(() => ({}));
      const hitCount = Array.isArray(data?.hits) ? data.hits.length : 0;
      const reply = data?.reply || `Found ${hitCount} passages.`;
      return res.status(200).json({ ok: true, reply, hitCount, tenantId });
    }

    // ---- generate_lesson (stub)
    if (action === 'generate_lesson') {
      if (!BUSINESS_URL)
        return res.status(500).json({ ok: false, reply: 'BUSINESS_URL not configured' });
      if (!question.trim()) return res.status(400).json({ ok: false, reply: 'Missing `question`' });

      const r = await fetch(`${BUSINESS_URL}/v1/lessons/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, tenantId }),
      });

      if (!r.ok) {
        const text = await r.text().catch(() => '');
        console.error('business generate error:', r.status, text);
        return res.status(502).json({ ok: false, reply: 'business_generate_failed' });
      }

      const data = await r.json().catch(() => ({}));
      const lesson = data.lesson || {};
      const bulletCount = Array.isArray(lesson.keyTakeaways) ? lesson.keyTakeaways.length : 0;

      return res.status(200).json({
        ok: true,
        reply: 'Lesson ready.',
        lessonTitle: lesson.title || '',
        bulletCount,
        lesson,
      });
    }

    // ---- generate_quiz (stub)
    if (action === 'generate_quiz') {
      if (!question.trim()) return res.status(400).json({ ok: false, reply: 'Missing `question`' });

      const promptLesson = {
        strategySummary: 'Use SPQA to turn ambiguous tasks into crisp prompts.',
        promptPrinciples: [
          'Set a clear role & constraints',
          'Structure inputs (context → task → criteria)',
          'Specify output format',
          'Iterate: critique & refine',
        ],
        demonstrationPrompts: [
          {
            label: 'Single-shot',
            prompt:
              'You are a strategy coach. Using SPQA, rewrite this business question… [user’s question]. Output: a 4-step plan.',
          },
          {
            label: 'Few-shot',
            prompt:
              'Here are 2 examples of good SPQA prompts… Now create one for: [user’s question].',
          },
          {
            label: 'Refinement',
            prompt:
              'Critique the following prompt for clarity, constraints, and measurability. Suggest a tighter version.',
          },
        ],
        applicationChecklist: [
          'Is the objective measurable?',
          'Are constraints explicit?',
          'Is the output format unambiguous?',
          'Does the prompt include a critique step?',
        ],
      };

      const quiz = {
        mcq: [
          {
            q: 'In SPQA, what comes after Problem?',
            choices: ['Action', 'Question', 'Scope', 'Answer'],
            answer: 'B',
            explain: 'S → P → Q → A',
          },
          {
            q: 'Best lever to reduce ambiguity fastest?',
            choices: [
              'More meetings',
              'Answer top questions',
              'Add stakeholders',
              'Extend timeline',
            ],
            answer: 'B',
            explain: 'Answering the right questions reduces uncertainty.',
          },
          {
            q: 'Which improves prompt reliability?',
            choices: ['Vague goals', 'No constraints', 'Explicit output format', 'Skip critique'],
            answer: 'C',
            explain: 'Specify structure & format.',
          },
        ],
        tf: [
          {
            q: 'SPQA stands for Situation, Problem, Question, Actions.',
            answer: true,
            explain: 'Correct order.',
          },
          {
            q: 'Refinement/critique is optional for complex tasks.',
            answer: false,
            explain: 'Refinement is essential for complex prompts.',
          },
        ],
        open: [
          {
            q: 'Rewrite the user’s question using SPQA. Provide one immediate 48-hour action.',
            rubric: [
              'Situation restated',
              'Problem measurable',
              'Top Qs listed',
              '48-hour action present',
            ],
          },
        ],
      };

      return res.status(200).json({
        ok: true,
        reply: 'Your prompt lesson and quiz are ready.',
        lessonTitle: 'Clarify Ambiguity with the SPQA Frame',
        mcqCount: quiz.mcq.length,
        tfCount: quiz.tf.length,
        openCount: quiz.open.length,
        promptLesson,
        quiz,
      });
    }

    // ---- export_lesson (markdown data URL)
    if (action === 'export_lesson') {
      try {
        const title = String(req.body?.title || 'Lesson');
        const raw = req.body?.lesson || '{}';
        let lesson = {};
        try {
          lesson = typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch {
          // Ignore parse errors and fallback to empty lesson
          lesson = {};
        }

        const md = makeMarkdownFromLesson(title, lesson);
        const b64 = Buffer.from(md, 'utf8').toString('base64');
        const url = `data:text/markdown;base64,${b64}`;

        return res.status(200).json({ ok: true, reply: 'Export ready.', url });
      } catch (err) {
        console.error('export_lesson error:', err);
        return res.status(500).json({ ok: false, reply: 'export_failed' });
      }
    }

    // ---- llm_elicit (LLM elicit / optimize)
    if (action === 'llm_elicit') {
      try {
        if (PROMPT_URL) {
          const r = await fetch(PROMPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'llm_elicit', question, tenantId }),
          });
          if (!r.ok) {
            const text = await r.text().catch(() => '');
            console.error('prompt service error:', r.status, text);
            return res.status(502).json({ ok: false, reply: 'prompt_service_failed' });
          }
          const payload = await r.json().catch(() => ({}));
          return res.status(200).json({
            ok: true,
            summary: payload.summary ?? '',
            needs_clarify: Boolean(payload.needs_clarify),
            followup_question: payload.followup_question ?? '',
            raw: payload,
          });
        }

        // Local deterministic stub for dev
        const summary = (question || '').toString().slice(0, 400);
        const needs_clarify = false;
        const followup_question = '';
        return res.status(200).json({
          ok: true,
          summary,
          needs_clarify,
          followup_question,
          raw: { source: 'stub' },
        });
      } catch (_e) {
        console.error('llm_elicit handler error:', _e);
        return res.status(502).json({ ok: false, reply: 'llm_elicit_failed' });
      }
    }

    // unknown action
    return res.status(400).json({ ok: false, reply: `Unknown action: ${action}` });
  } catch (err) {
    console.error('webhook handler error:', err);
    return res.status(500).json({ ok: false, reply: 'internal_error' });
  }
});

// ---- Error handler (after routes)
app.use((err, _req, res, _next) => {
  console.error('unhandled error middleware:', err);
  res.status(500).json({ ok: false, reply: 'internal_error' });
});

// ---- Start
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
