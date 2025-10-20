// server.js
// Minimal webhook router for Voiceflow → Render microservices

const express = require('express');
const app = express();
const cors = require('cors');
// add crypto for request-id
const _crypto = require('crypto');
// Production check
const IS_PROD = process.env.NODE_ENV === 'production';

// Debug flag requested via env (string check)
const _requestedDebug = process.env.DEBUG_WEBHOOK === 'true';
// Soft guard: if running in production and DEBUG_WEBHOOK was requested, auto-disable it
// and emit a single startup warning. This prevents accidental leakage of sensitive
// debug output in production while still allowing staging/dev to enable verbose logs.
let DEBUG_WEBHOOK = _requestedDebug;
if (IS_PROD && _requestedDebug) {
  // log a succinct warning; avoid printing secrets or payloads
  // Use console.warn once at startup so it's visible in logs but not noisy
  console.warn(
    'WARNING: DEBUG_WEBHOOK was requested in production. For safety it has been disabled.'
  );
  DEBUG_WEBHOOK = false;
}
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

// add fetchWithTimeout helper for robust downstream calls (longer default for cold starts)
const fetchWithTimeout = async (url, opts = {}, ms = 60000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    opts.signal = controller.signal;
    if (!IS_PROD || DEBUG_WEBHOOK) console.info('fetch start', opts.method || 'GET', url);
    const start = Date.now();
    const r = await fetch(url, opts);
    const elapsed = Date.now() - start;
    let bodyText = '';
    try {
      bodyText = await r.clone().text();
    } catch {
      /* ignore */
    }
    if (!IS_PROD || DEBUG_WEBHOOK) {
      console.info(`fetch ${opts.method || 'GET'} ${url} => ${r.status} (${elapsed}ms)`);
      if (bodyText) console.info('fetch response body:', bodyText.slice(0, 8000));
    }
    clearTimeout(id);
    return r;
  } catch (err) {
    clearTimeout(id);
    console.error(`fetch error ${url}:`, err && err.message ? err.message : err);
    throw err;
  }
};

// Minimal runtime safety notice (no secret printed)
if (!API_KEY && !IS_PROD) {
  console.warn(
    'WEBHOOK_API_KEY not set — webhook endpoints will reject requests without a valid key.'
  );
}
// Gate presence logs behind DEBUG_WEBHOOK in non-production to avoid leaking
// configuration truthiness in production logs. Developers can enable DEBUG_WEBHOOK=true
// when debugging locally to see these flags.
if (!IS_PROD && DEBUG_WEBHOOK) {
  console.log('RETRIEVAL_URL set:', !!RETRIEVAL_URL);
  console.info('PROMPT_URL set:', !!PROMPT_URL, 'BUSINESS_URL set:', !!BUSINESS_URL);
  // log presence only (true/false) — never print the actual key value
  console.info('WEBHOOK_API_KEY present:', !!API_KEY);
}

// CORS (optional; enable if browser/iframe clients will call the webhook)
app.use(cors());

// ---- Middleware (body parser + JSON error handler)
app.use(
  express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// Insert request-id propagation middleware (after body parser or before routes)
app.use((req, res, next) => {
  const incoming = req.get('x-request-id');
  const rid =
    incoming ||
    (_crypto.randomUUID
      ? _crypto.randomUUID()
      : _crypto
          .createHash('sha1')
          .update(String(Date.now()) + Math.random())
          .digest('hex'));
  req.id = rid;
  res.setHeader('x-request-id', rid);
  next();
});

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

// ---- Internal: debug flags (non-production only)
// Returns a small set of non-sensitive runtime flags to help with debugging.
app.get('/internal/debug', (_req, res) => {
  if (IS_PROD) return res.status(404).send('not_found');
  try {
    return res.status(200).json({
      ok: true,
      node_env: process.env.NODE_ENV || 'not_set',
      debug_webhook_enabled: _requestedDebug === true,
      api_key_present: !!API_KEY,
      retrieval_url_present: !!RETRIEVAL_URL,
      prompt_url_present: !!PROMPT_URL,
      business_url_present: !!BUSINESS_URL,
      port: PORT,
    });
  } catch (e) {
    console.error('internal debug error', e && e.message);
    return res.status(500).json({ ok: false });
  }
});

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
  // authenticate request
  const key = (req.get('x-api-key') || '').toString();
  if (key !== API_KEY) {
    console.warn('unauthorized: key mismatch');
    return res.status(401).json({ ok: false, reply: 'unauthorized' });
  }
  {
    // (per-request key log removed for production)
    // ...existing code...
  }

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
      if (!RETRIEVAL_URL) {
        // explicit controlled error when retrieval not configured
        return res.status(400).json({ ok: false, reply: 'RETRIEVAL_URL_not_configured' });
      }
      const r = await fetchWithTimeout(
        RETRIEVAL_URL,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: question, topK, tenantId }),
        },
        45000
      );

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

    // ---- generate_lesson (stub or remote)
    if (action === 'generate_lesson') {
      if (BUSINESS_URL) {
        try {
          const r = await fetchWithTimeout(
            `${BUSINESS_URL.replace(/\/$/, '')}/v1/lessons/generate`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ question, tenantId }),
            },
            60000
          );
          if (!r.ok) {
            const text = await r.text().catch(() => '');
            console.error('business generate error:', r.status, text);
            // fall through to stub fallback if remote fails
            throw new Error('business_generate_failed');
          }
          const data = await r.json().catch(() => ({}));
          const lesson = data.lesson || data;
          const bulletCount = Array.isArray(lesson.keyTakeaways) ? lesson.keyTakeaways.length : 0;
          return res.status(200).json({
            ok: true,
            reply: 'Lesson ready.',
            lessonTitle: lesson.title || '',
            bulletCount,
            lesson,
          });
        } catch (e) {
          console.warn('generate_lesson: remote call failed, using stub fallback', e && e.message);
        }
      }
      // local deterministic stub fallback
      const stubLesson = {
        title: `Stub Lesson: ${String(question).slice(0, 80)}`,
        objectives: [
          'Clarify the user intent and scope',
          'Provide a concise lesson outline',
          'Deliver actionable next steps',
        ],
        content: `This is a deterministic stub lesson generated for the question:\n\n"${question}"`,
        keyTakeaways: ['Restate the problem concisely', 'List 2–3 actionable next steps'],
        references: [],
        meta: { question },
      };
      const bulletCount = Array.isArray(stubLesson.keyTakeaways)
        ? stubLesson.keyTakeaways.length
        : 0;
      return res.status(200).json({
        ok: true,
        reply: 'Lesson (stub) ready.',
        lessonTitle: stubLesson.title,
        bulletCount,
        lesson: stubLesson,
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
          const r = await fetchWithTimeout(PROMPT_URL, {
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
          // debug: log trimmed payload only when explicitly enabled (DEBUG_WEBHOOK)
          // and not in production. This prevents accidental leakage of LLM outputs.
          if (!IS_PROD && DEBUG_WEBHOOK) {
            try {
              console.info('llm payload snippet:', JSON.stringify(payload).slice(0, 2000));
            } catch {}
          }

          // tolerant mapping: try multiple fields and combine if useful
          let summary = '';
          if (payload.summary && String(payload.summary).trim()) {
            summary = String(payload.summary).trim();
          } else if (payload.promptLesson && payload.promptLesson.strategySummary) {
            summary = String(payload.promptLesson.strategySummary).trim();
          } else if (
            payload.promptLesson &&
            Array.isArray(payload.promptLesson.demonstrationPrompts) &&
            payload.promptLesson.demonstrationPrompts[0]?.prompt
          ) {
            summary = String(payload.promptLesson.demonstrationPrompts[0].prompt)
              .slice(0, 800)
              .trim();
          } else {
            // last resort: try common top-level text fields
            const candidates = ['text', 'result', 'output', 'answer']
              .map((k) => payload[k])
              .filter(Boolean);
            if (candidates.length) summary = String(candidates[0]).slice(0, 800).trim();
          }

          // If still empty, optionally synthesise from promptLesson pieces
          if (!summary && payload.promptLesson) {
            const parts = [];
            if (payload.promptLesson.strategySummary)
              parts.push(payload.promptLesson.strategySummary);
            if (Array.isArray(payload.promptLesson.demonstrationPrompts)) {
              payload.promptLesson.demonstrationPrompts.slice(0, 2).forEach((p) => {
                if (p?.prompt) parts.push(p.prompt);
              });
            }
            summary = parts.join(' — ').slice(0, 1000).trim();
          }

          const needs_clarify = Boolean(payload.needs_clarify) || false;
          const followup_question = payload.followup_question || payload.suggested_followup || '';

          return res.status(200).json({
            ok: true,
            summary,
            needs_clarify,
            followup_question,
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

    // ---- invoke_component
    if (action === 'invoke_component') {
      const comp = String(req.body?.component || '').trim();
      // base summary used by most component stubs
      const summary = (question || '').toString().slice(0, 400);

      // per-component behavior
      if (comp === 'C_CaptureQuestion') {
        const qLower = (question || '').toLowerCase();
        const needs_clarify = qLower.includes('clarify') || qLower.includes('?');
        const followup_question = needs_clarify ? 'Can you clarify what you mean by X?' : '';
        return res.status(200).json({
          ok: true,
          summary,
          needs_clarify,
          followup_question,
          raw: { component: comp, source: 'invoke_component_stub' },
        });
      }

      // default invoke_component stub
      return res.status(200).json({
        ok: true,
        summary,
        needs_clarify: false,
        followup_question: '',
        raw: { component: comp || 'unknown', source: 'invoke_component_default' },
      });
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

// ---- Start when run directly
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

// Export the app for in-process tests and programmatic use.
module.exports = app;
