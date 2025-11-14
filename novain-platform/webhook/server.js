// server.js
// Minimal webhook router for Voiceflow → Render microservices

const express = require('express');
const app = express();
const cors = require('cors');
// add crypto for request-id
const _crypto = require('crypto');
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Shared agents for outgoing requests. Reusing agents reduces per-request
// Agent/socket churn and lowers the number of connect/listener allocations
// visible to the test instrumentation. Tests can still opt into creating
// per-request agents by setting `FORCE_PER_REQUEST_AGENT=1`.
const sharedHttpAgent = new http.Agent({ keepAlive: true });
const sharedHttpsAgent = new https.Agent({ keepAlive: true });
// Production check
const IS_PROD = process.env.NODE_ENV === 'production';
// Debug flag to enable verbose webhook logs in non-production or when explicitly set
const DEBUG_WEBHOOK = process.env.DEBUG_WEBHOOK === 'true';
// Test debug flag: allow '1' or 'true' to enable verbose test-only logging
const DEBUG_TESTS = process.env.DEBUG_TESTS === 'true' || process.env.DEBUG_TESTS === '1';
// ---- Config (env vars)
// Note: some tests set `process.env.WEBHOOK_API_KEY` after this module is loaded.
// To ensure tests and CI can update the API key at runtime (without requiring
// the server module to be reloaded), read the API key per-request instead of
// capturing it once at module init.
function getApiKey() {
  return process.env.WEBHOOK_API_KEY || process.env.WEBHOOK_KEY || '';
}
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

// Note: DEBUG_TESTS is available above as a boolean; avoid noisy prints at
// module init. Tests and CI can enable `DEBUG_TESTS=1` to get more verbose
// per-request diagnostics which are already gated at call sites.

// add fetchWithTimeout helper for robust downstream calls (longer default for cold starts)
const fetchWithTimeout = async (url, opts = {}, ms = 60000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  // allow callers/tests to force explicit per-request agent usage to avoid
  // keep-alive pooling (useful for Jest detectOpenHandles on CI/WSL)
  let createdAgent = null;
  try {
    opts.signal = controller.signal;
    // If caller didn't supply an agent, and either tests requested a forced
    // per-request agent via FORCE_PER_REQUEST_AGENT=1 or we're in test/non-prod
    // mode, create a short-lived agent and attach it to opts so sockets are
    // closed promptly when the request finishes.
    try {
      // Only create a short-lived per-request agent when explicitly requested
      // via FORCE_PER_REQUEST_AGENT=1. Creating per-request agents by default
      // in non-production can cause many transient sockets/listeners and
      // trigger MaxListenersExceededWarning in CI. Make it opt-in.
      const shouldForce = process.env.FORCE_PER_REQUEST_AGENT === '1';
      // Determine protocol for this URL
      let proto = 'http:';
      try {
        proto = new URL(url).protocol || 'http:';
      } catch {
        proto = String(url || '').startsWith('https:') ? 'https:' : 'http:';
      }

      if (!opts.agent && shouldForce) {
        // Tests explicitly requested a per-request (non-keep-alive) agent.
        createdAgent =
          proto === 'https:'
            ? new https.Agent({ keepAlive: false })
            : new http.Agent({ keepAlive: false });
        opts.agent = createdAgent;
      } else if (!opts.agent) {
        // Use shared keep-alive agents by default to reduce per-request
        // Agent creation churn. This avoids creating many short-lived
        // sockets while still allowing connection reuse. Teardown will
        // attempt to destroy these agents during shutdown.
        opts.agent = proto === 'https:' ? sharedHttpsAgent : sharedHttpAgent;
      }
    } catch {
      // best-effort only
      createdAgent = null;
    }

    if (!IS_PROD || DEBUG_WEBHOOK) console.info('fetch start', opts.method || 'GET', url);
    const start = Date.now();
    // Use the resolved fetch implementation captured during module init
    // (`fetchFn`) where possible so tests that override `globalThis.fetch`
    // before requiring this module reliably get invoked. Fall back to
    // globalThis.fetch if needed.
    const _fetch = typeof fetchFn === 'function' ? fetchFn : globalThis.fetch;
    const r = await _fetch(url, opts);
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
  } finally {
    // ensure per-request agent (if created) is destroyed to avoid pooled
    // sockets lingering and causing Jest detectOpenHandles failures
    try {
      if (createdAgent && typeof createdAgent.destroy === 'function') {
        try {
          createdAgent.destroy();
        } catch {
          void 0;
        }
      }
    } catch {
      void 0;
    }
    try {
      clearTimeout(id);
    } catch {}
    try {
      controller.abort && typeof controller.abort === 'function' && controller.abort();
    } catch {}
  }
};

// Minimal runtime safety notice (no secret printed)
// Use getApiKey() here so the value is resolved at runtime rather than
// referencing a possibly undefined module-scope variable.
if (!getApiKey() && !IS_PROD) {
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
  console.info('WEBHOOK_API_KEY present:', !!getApiKey());
}

// CORS (optional; enable if browser/iframe clients will call the webhook)
app.use(cors());

// ---- Middleware (body parser + JSON error handler)
// Allow tests to disable the body parser to avoid loading raw-body/body-parser
// which can create closures detected as "bound-anonymous-fn" by Jest detectOpenHandles.
const SKIP_BODY_PARSER =
  process.env.SKIP_BODY_PARSER === '1' || process.env.SKIP_BODY_PARSER === 'true';
if (SKIP_BODY_PARSER) {
  console.info('SKIP_BODY_PARSER set — using lightweight JSON body parser (test mode)');
  // Lightweight per-request JSON parser used only in test-mode when the
  // full express.json/body-parser is disabled. This avoids pulling in the
  // heavy raw-body closure that can be reported as an open handle by Jest
  // while still allowing tests that send JSON (supertest) to be parsed.
  app.use((req, res, next) => {
    try {
      const ct =
        (req.headers && (req.headers['content-type'] || req.headers['Content-Type'])) || '';
      if (!String(ct).toLowerCase().includes('application/json')) return next();

      let raw = '';
      if (typeof req.setEncoding === 'function') {
        try {
          req.setEncoding('utf8');
        } catch {}
      }
      req.on('data', (chunk) => {
        try {
          raw += chunk;
        } catch {}
      });
      req.on('end', () => {
        try {
          // emulate express.json verify behavior by saving a Buffer
          req.rawBody = Buffer.from(raw || '', 'utf8');
          try {
            req.body = raw ? JSON.parse(raw) : {};
          } catch {
            req.body = {};
          }
        } catch {}
        next();
      });
      req.on('error', () => next());
    } catch {
      // best-effort: fall through to next middleware on error
      try {
        next();
      } catch {}
    }
  });
} else {
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );
}

// Insert request-id propagation middleware (after body parser or before routes)
app.use((req, res, next) => {
  const incoming = req.get('x-request-id');
  // In test/debug modes, avoid using `crypto.randomUUID()` because on some
  // Node versions it creates short-lived native random jobs that our
  // async-hooks instrumentation reports as open handles (RANDOMBYTESREQUEST).
  // Use a deterministic JS fallback during tests to keep async handle dumps clean.
  const useDeterministicIds =
    process.env.FORCE_DETERMINISTIC_IDS === '1' || process.env.NODE_ENV === 'test' || DEBUG_TESTS;

  const deterministicId = () => {
    // small, readable id: r-<time>-<counter/random>
    try {
      const t = Date.now().toString(36);
      const r = Math.floor(Math.random() * 0x1000000).toString(36);
      return `r-${t}-${r}`;
    } catch {
      return String(Date.now()) + '-' + Math.random();
    }
  };

  const rid = incoming
    ? incoming
    : useDeterministicIds
      ? deterministicId()
      : _crypto.randomUUID
        ? _crypto.randomUUID()
        : _crypto
            .createHash('sha1')
            .update(String(Date.now()) + Math.random())
            .digest('hex');

  req.id = rid;
  res.setHeader('x-request-id', rid);
  next();
});

// Normalize JSON responses so callers/tests that expect both `raw` and
// `data.raw` shapes receive equivalent data. This wraps `res.json` per
// request and mirrors `raw` <=> `data.raw` when one is present but the
// other is missing. It's intentionally conservative: it doesn't fabricate
// complex payloads, only mirrors existing `raw` payloads to `data.raw`.
app.use((req, res, next) => {
  try {
    const _origJson = res.json && res.json.bind(res);
    if (typeof _origJson === 'function') {
      res.json = function (obj) {
        try {
          if (obj && typeof obj === 'object') {
            // If top-level `raw` exists but `data.raw` is missing, mirror it.
            if (obj.raw && (!obj.data || !obj.data.raw)) {
              obj.data = Object.assign({}, obj.data || {}, { raw: obj.raw });
            }
            // If `data.raw` exists but top-level `raw` is missing, mirror it.
            if ((!obj.raw || obj.raw === undefined) && obj.data && obj.data.raw) {
              obj.raw = obj.data.raw;
            }
          }
        } catch (e) {
          // best-effort only; do not block response on normalization errors
          try {
            console.warn('res.json normalization failed', e && e.message ? e.message : e);
          } catch {}
        }
        return _origJson(obj);
      };
    }
  } catch {
    /* ignore - normalization is best-effort */
  }
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
// Immediate lightweight health check used by external load balancers.
app.get('/health', (_req, res) => res.status(200).send('ok'));

// Readiness: returns 200 only once the HTTP server has actually bound and
// startup logs have been emitted. This is useful for CI or scripts that want
// to wait until the service is actually ready to serve heavier traffic.
let __ready = false;
app.get('/ready', (_req, res) => {
  if (__ready) return res.status(200).json({ ok: true });
  return res.status(503).json({ ok: false, reason: 'not_ready' });
});

// Top-level visibility for uncaught errors and unhandled rejections.
// Write a short trace to the OS temp directory so CI can collect it if needed.
try {
  const UNHANDLED_REJECTIONS_LOG =
    process.env.UNHANDLED_REJECTIONS_LOG || path.join(os.tmpdir(), 'vf_unhandled_rejections.log');

  process.on('unhandledRejection', (reason) => {
    try {
      const line = `[${new Date().toISOString()}] unhandledRejection: ${
        reason && reason.stack ? reason.stack : String(reason)
      }\n`;
      try {
        fs.appendFileSync(UNHANDLED_REJECTIONS_LOG, line);
      } catch {}
    } catch {}
    try {
      console.error('Unhandled Rejection at:', reason);
    } catch {}
    try {
      // exit with non-zero after a short delay so CI shows a failing job and
      // logs are flushed. We unref the timer so it doesn't keep the process alive.
      setTimeout(() => process.exit(1), 50).unref();
    } catch {}
  });

  process.on('uncaughtException', (err) => {
    try {
      const line = `[${new Date().toISOString()}] uncaughtException: ${
        err && err.stack ? err.stack : String(err)
      }\n`;
      try {
        fs.appendFileSync(UNHANDLED_REJECTIONS_LOG, line);
      } catch {}
    } catch {}
    try {
      console.error('Uncaught Exception:', err && err.stack ? err.stack : err);
    } catch {}
    try {
      setTimeout(() => process.exit(1), 50).unref();
    } catch {}
  });
} catch {
  // best-effort only: do not crash if logging setup fails
}

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
  // authenticate request (read expected key at request time so tests can set
  // process.env.WEBHOOK_API_KEY dynamically before making requests)
  const key = (req.get('x-api-key') || req.get('x-voiceflow-signature') || '').toString();
  const expected = getApiKey();
  if (key !== expected) {
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
          if (DEBUG_TESTS) {
            try {
              console.info('DEBUG_TESTS: llm_elicit: PROMPT_URL present:', !!PROMPT_URL);
              console.info('DEBUG_TESTS: llm_elicit: fetchFn type:', typeof fetchFn);
              try {
                // best-effort show whether globalThis.fetch === fetchFn
                console.info(
                  'DEBUG_TESTS: llm_elicit: fetch equality:',
                  globalThis.fetch === fetchFn
                );
              } catch {}
            } catch {}
          }

          const r = await fetchWithTimeout(PROMPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'llm_elicit', question, tenantId }),
          });

          if (DEBUG_TESTS) {
            try {
              console.info('DEBUG_TESTS: llm_elicit: fetched status:', r && r.status);
              try {
                const ct =
                  r.headers &&
                  (r.headers.get ? r.headers.get('content-type') : r.headers['content-type']);
                console.info('DEBUG_TESTS: llm_elicit: content-type:', ct);
              } catch {}
            } catch {}
          }

          if (!r.ok) {
            const text = await r.text().catch(() => '');
            console.error('prompt service error:', r.status, text);
            return res.status(502).json({ ok: false, reply: 'prompt_service_failed' });
          }

          // Prefer explicit try/catch for JSON parsing so we can log parse failures
          let payload = {};
          try {
            payload = await r.json();
          } catch (pj) {
            if (DEBUG_TESTS) {
              try {
                console.info(
                  'DEBUG_TESTS: llm_elicit: JSON parse failed:',
                  pj && pj.message ? pj.message : pj
                );
                const txt = await r
                  .clone()
                  .text()
                  .catch(() => '');
                console.info(
                  'DEBUG_TESTS: llm_elicit: response body (on parse fail):',
                  String(txt).slice(0, 4000)
                );
              } catch {}
            }
            payload = {};
          }

          // Mirror payload into both `raw` and `data.raw` so callers/tests that
          // expect either shape will receive the same information.
          const rawPayload = payload || {};

          // debug: log trimmed payload only when explicitly enabled (DEBUG_WEBHOOK)
          // and not in production. This prevents accidental leakage of LLM outputs.
          if (!IS_PROD && DEBUG_WEBHOOK) {
            try {
              console.info('llm payload snippet:', JSON.stringify(payload).slice(0, 2000));
            } catch {}
          }

          if (DEBUG_TESTS) {
            try {
              console.info(
                'DEBUG_TESTS: llm_elicit: payload snippet:',
                JSON.stringify(payload).slice(0, 2000)
              );
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
            raw: rawPayload,
            data: { raw: rawPayload },
          });
        }

        // Local deterministic stub for dev
        const summary = (question || '').toString().slice(0, 400);
        const needs_clarify = false;
        const followup_question = '';
        // Return both top-level `raw` and a `data.raw` mirror so tests and
        // external callers that expect either shape can work reliably.
        const rawPayload = { source: 'stub' };
        return res.status(200).json({
          ok: true,
          summary,
          needs_clarify,
          followup_question,
          raw: rawPayload,
          data: { raw: rawPayload },
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
        const rawPayload = { component: comp, source: 'invoke_component_stub' };
        return res.status(200).json({
          ok: true,
          summary,
          needs_clarify,
          followup_question,
          raw: rawPayload,
          data: { raw: rawPayload },
        });
      }

      // default invoke_component stub
      const rawPayload = { component: comp || 'unknown', source: 'invoke_component_default' };
      return res.status(200).json({
        ok: true,
        summary,
        needs_clarify: false,
        followup_question: '',
        raw: rawPayload,
        data: { raw: rawPayload },
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
  // Log runtime info early for Render / cloud logs troubleshooting.
  try {
    console.log('Starting webhook server', { node: process.version, pid: process.pid });
  } catch {
    // ignore logging failures
  }

  // Save server so we can close it cleanly on shutdown and attempt to
  // close any persistent HTTP/undici resources that may keep sockets alive.
  const server = app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    // Mark readiness once the server has actually bound the port.
    __ready = true;
  });

  // Graceful shutdown helper: close undici global dispatcher (if present),
  // destroy http/https global agents, and close the server. This reduces
  // the chance of lingering TLSSocket/TCPWRAP handles after process exit.
  const gracefulShutdown = (signal) => {
    try {
      console.log(`Received ${signal}; performing graceful shutdown`);
    } catch {}
    __ready = false;

    // Use centralized cleanup for HTTP/undici resources.
    try {
      const client = require('../lib/http-client');
      if (client && typeof client.closeAllClients === 'function') {
        try {
          client.closeAllClients();
        } catch (e) {
          void e;
        }
      }
    } catch (e) {
      void e;
    }

    // Destroy shared HTTP(S) agents to ensure sockets are closed and do not
    // keep the process alive in test/CI environments.
    try {
      if (sharedHttpAgent && typeof sharedHttpAgent.destroy === 'function') {
        try {
          sharedHttpAgent.destroy();
        } catch {}
      }
    } catch {}
    try {
      if (sharedHttpsAgent && typeof sharedHttpsAgent.destroy === 'function') {
        try {
          sharedHttpsAgent.destroy();
        } catch {}
      }
    } catch {}

    // Stop accepting new connections and close existing ones. If server
    // close hangs, force exit after a short timeout to avoid stalls in CI.
    try {
      server.close(() => {
        try {
          console.log('gracefulShutdown: HTTP server closed');
        } catch {}
        // allow process to exit normally
        try {
          process.exit(0);
        } catch {
          /* ignore */
        }
      });
    } catch (e) {
      try {
        console.error('gracefulShutdown: server.close failed', e && e.stack ? e.stack : e);
      } catch {}
    }

    // Force exit after 5s if graceful close did not complete.
    setTimeout(() => {
      try {
        console.error('gracefulShutdown: forcing process exit');
      } catch {}
      try {
        process.exit(1);
      } catch {}
    }, 5000).unref();
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

// Attach a helper to create a raw http.Server for tests that need explicit
// start/stop control. Keep the default export as the Express `app` for
// backward compatibility with existing code that requires the app directly.
try {
  const _http = require('http');
  Object.defineProperty(app, 'createServer', {
    value: () => _http.createServer(app),
    writable: false,
    enumerable: false,
  });
} catch {
  // ignore in constrained environments
}

// Export the app for in-process tests and programmatic use.
// Export a helper to clean up shared resources (useful for tests).
try {
  Object.defineProperty(app, 'closeResources', {
    value: () => {
      try {
        if (sharedHttpAgent && typeof sharedHttpAgent.destroy === 'function') {
          try {
            sharedHttpAgent.destroy();
          } catch {}
        }
      } catch {}
      try {
        if (sharedHttpsAgent && typeof sharedHttpsAgent.destroy === 'function') {
          try {
            sharedHttpsAgent.destroy();
          } catch {}
        }
      } catch {}
      try {
        // If fetch implementation exposes a close method (undici client), try to close it.
        if (fetchFn && typeof fetchFn === 'object' && typeof fetchFn.close === 'function') {
          try {
            fetchFn.close();
          } catch {}
        }
      } catch {}
    },
    writable: false,
    enumerable: false,
  });
} catch {}

module.exports = app;
