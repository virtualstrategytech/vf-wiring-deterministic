const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const secretFile = path.resolve(__dirname, 'webhook.secret');
const key =
  process.env.WEBHOOK_API_KEY ||
  (fs.existsSync(secretFile) ? fs.readFileSync(secretFile, 'utf8').trim() : 'test123');

const rawBase = (process.env.WEBHOOK_BASE || '').trim();
// Defensive normalization: strip trailing slashes so joining paths like
// `${base}/health` cannot produce `//health` if the env contained a
// trailing slash. This makes tests robust to CI step ordering.
function _normalizeBase(b) {
  if (!b) return b;
  try {
    // trim whitespace and trailing slashes
    return String(b).trim().replace(/\/+$/u, '');
  } catch {
    return b;
  }
}
// Default to local server when no base provided
const base = _normalizeBase(rawBase) || 'http://127.0.0.1:3000';

// Prefer in-process app when available (reduces TCP races in local runs).
let _localApp = null;
try {
  // Make sure the in-process server sees the same API key the test will send.
  try {
    if (key && !process.env.WEBHOOK_API_KEY) process.env.WEBHOOK_API_KEY = String(key);
  } catch {}
  // require the app for in-process testing when possible
  _localApp = require('../novain-platform/webhook/server');
  if (!_localApp || typeof _localApp !== 'function') _localApp = null;
} catch {}

// Emit a short, always-on debug header so CI logs clearly indicate which
// version of the test file executed. This is intentionally lightweight and
// non-secret (no env values printed).
try {
  console.warn(
    `DEBUG test-file loaded: ${path.basename(__filename)} ts:${new Date().toISOString()}`
  );
} catch {}
// When DEBUG_TESTS is set (CI smoke runs), make extra effort here to ensure
// nock won't block the outgoing requests made by the smoke test. Some test
// harness ordering can still cause nock to reject requests; enabling net
// connect here ensures the smoke test can reach the deployed webhook.
try {
  if (process.env.DEBUG_TESTS === '1' || process.env.DEBUG_TESTS === 'true') {
    try {
      require('nock').enableNetConnect();
    } catch {}
    try {
      writeDebugLog('DEBUG_TESTS: nock.enableNetConnect() invoked in smoke test');
    } catch {}
  }
} catch {}
try {
  // also write the same short debug line to the CI artifact log helper (best-effort)
  writeDebugLog &&
    typeof writeDebugLog === 'function' &&
    writeDebugLog(
      `DEBUG test-file loaded: ${path.basename(__filename)} ts:${new Date().toISOString()}`
    );
} catch {}

// If the user supplied a remote base but didn't provide an API key, fail fast
// with a clear message so CI logs are actionable (instead of hitting "Invalid URL").
if (rawBase) {
  const hasEnvKey = Boolean(process.env.WEBHOOK_API_KEY);
  const secretFileExists = fs.existsSync(secretFile);
  if (!hasEnvKey && !secretFileExists) {
    throw new Error(
      'WEBHOOK_BASE is set but WEBHOOK_API_KEY is not available (env or webhook.secret).\nUse SKIP_SMOKE=true to skip smoke tests, or set the secret in the repo/runner.'
    );
  }
}

function _maskBaseForLogs(b) {
  try {
    const u = new URL(b);
    return `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}`;
  } catch {
    // fallback: don't print the raw value to logs to avoid leaking secrets
    return '[invalid-base]';
  }
}

// Strict validation: ensure `base` is a well-formed URL early so CI shows a
// clear, masked diagnostic instead of a low-level TypeError inside helpers.
try {
  // only validate when a non-empty base was supplied (local default is fine)
  if (rawBase) {
    new URL(base);
  }
} catch {
  throw new Error(`WEBHOOK_BASE is not a valid URL: ${_maskBaseForLogs(base)}`);
}

// Allow CI to override per-request timeouts when contacting deployed services
const HEALTH_TIMEOUT = Number(process.env.WEBHOOK_HEALTH_TIMEOUT) || 5000;
const PING_TIMEOUT = Number(process.env.WEBHOOK_PING_TIMEOUT) || 7000;
const GENERATE_TIMEOUT = Number(process.env.WEBHOOK_GENERATE_TIMEOUT) || 45000;

// Retry wrapper for transient connection failures (ECONNREFUSED)
async function withRetries(fn, retries = 8, delay = 500) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const code =
        err &&
        (err.code || (err.message && err.message.includes('ECONNREFUSED') && 'ECONNREFUSED'));
      if (String(code) !== 'ECONNREFUSED' || i + 1 === retries) throw err;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// Helper: write short debug lines to stderr and a file so CI captures them reliably
function writeDebugLog(line) {
  try {
    console.error(line);
  } catch {}
  try {
    // best-effort: write to a stable repo artifacts folder so CI/workers on Windows
    // and Unix can find the trace reliably.
    fs.appendFileSync(
      path.join(process.cwd(), 'artifacts', 'socket_debug.log'),
      `${new Date().toISOString()} ${line}\n`
    );
  } catch {}
}

describe('webhook smoke', () => {
  if (process.env.SKIP_SMOKE === 'true') {
    // Skip entire smoke suite in CI when no deployed service is available
    // Provide a dummy test so Jest doesn't treat the file as empty (which fails)
    console.warn('SKIP_SMOKE=true, skipping webhook smoke tests');
    test('skipped in CI', () => {
      expect(true).toBe(true);
    });
    return;
  }
  // Allow longer for remote operations in CI (business/prompt services may be slower)
  jest.setTimeout(60000);

  afterAll(async () => {
    try {
      if (http && http.globalAgent && typeof http.globalAgent.destroy === 'function') {
        http.globalAgent.destroy();
      }
      if (https && https.globalAgent && typeof https.globalAgent.destroy === 'function') {
        https.globalAgent.destroy();
      }
      await new Promise((r) => process.nextTick(r));
    } catch {}
    // If DEBUG_TESTS is enabled, persist any async handle map and active handles
    // produced by the test process into /tmp and the repo artifacts folder so
    // the workflow can upload them for offline analysis.
    try {
      if (process.env.DEBUG_TESTS) {
        try {
          const fs = require('fs');
          const path = require('path');
          const out = [];
          try {
            const m = global.__async_handle_map || new Map();
            for (const [id, info] of m.entries()) {
              out.push({
                id,
                type: info && info.type,
                stack: String(info && info.stack).slice(0, 1000),
              });
            }
          } catch {}
          try {
            const repoPath = path.join(process.cwd(), 'artifacts');
            fs.mkdirSync(repoPath, { recursive: true });
            const repoFile = path.join(repoPath, `async_handles_smoke_${Date.now()}.json`);
            fs.writeFileSync(repoFile, JSON.stringify(out, null, 2));
            try {
              console.warn('wrote', repoFile);
            } catch {}
          } catch {}
          try {
            fs.writeFileSync('/tmp/async_handle_map.json', JSON.stringify(out, null, 2));
          } catch {}
          // active handles
          try {
            const ah = (process._getActiveHandles && process._getActiveHandles()) || [];
            const act = ah.map((h, i) => {
              try {
                const name = h && h.constructor && h.constructor.name;
                const info = { idx: i, type: String(name) };
                try {
                  if (h && typeof h._createdStack === 'string')
                    info._createdStack = h._createdStack;
                } catch {}
                try {
                  if (String(name) === 'Socket' || String(name) === 'TLSSocket') {
                    info.socket = {
                      localAddress: h.localAddress,
                      localPort: h.localPort,
                      remoteAddress: h.remoteAddress,
                      remotePort: h.remotePort,
                      destroyed: h.destroyed,
                    };
                  }
                } catch {}
                return info;
              } catch {
                return { idx: i, type: 'error' };
              }
            });
            try {
              const repoPath = require('path').join(process.cwd(), 'artifacts');
              const repoFile = require('path').join(
                repoPath,
                `active_handles_smoke_${Date.now()}.json`
              );
              try {
                require('fs').mkdirSync(require('path').dirname(repoFile), { recursive: true });
              } catch {}
              require('fs').writeFileSync(repoFile, JSON.stringify(act, null, 2));
            } catch {}
            try {
              require('fs').writeFileSync('/tmp/active_handles.json', JSON.stringify(act, null, 2));
            } catch {}
          } catch {}
        } catch {}
      }
    } catch {}
  });

  test('GET /health returns ok', async () => {
    // defensive: ensure base looks like a URL
    if (!base || !(base.startsWith('http://') || base.startsWith('https://'))) {
      throw new Error(`WEBHOOK_BASE is not a valid HTTP URL: ${_maskBaseForLogs(base)}`);
    }
    const url = `${base}/health`;
    const retries = Number(process.env.WEBHOOK_HEALTH_RETRIES) || 12;
    const retryDelay = Number(process.env.WEBHOOK_HEALTH_RETRY_DELAY) || 2000;

    // Try multiple times to allow the remote service to become healthy
    let lastErr;
    let text;
    text = await withRetries(() => getText(url, HEALTH_TIMEOUT), retries, retryDelay);

    if (lastErr) throw lastErr;
    expect(typeof text).toBe('string');
    expect(text.trim().toLowerCase()).toBe('ok');
  });

  test('POST /webhook (ping) returns 2xx', async () => {
    const body = { action: 'ping', question: 'hello', name: 'Bob', tenantId: 'default' };
    const resp = await withRetries(
      () => postJson(`${base}/webhook`, body, { 'x-api-key': String(key) }, PING_TIMEOUT),
      6,
      300
    );
    expect(resp.status).toBeGreaterThanOrEqual(200);
    expect(resp.status).toBeLessThan(300);
    expect(resp.data).toBeDefined();
  });

  test('POST /webhook generate_lesson (best-effort)', async () => {
    const body = { action: 'generate_lesson', question: 'Teach me SPQA', tenantId: 'default' };
    const resp = await withRetries(
      () => postJson(`${base}/webhook`, body, { 'x-api-key': String(key) }, GENERATE_TIMEOUT),
      4,
      500
    );

    // Accept success (2xx) OR a controlled server-side failure (500) when external services are not configured.
    if (resp.status >= 200 && resp.status < 300) {
      if (resp.data && typeof resp.data === 'object') {
        expect(
          resp.data.lessonTitle !== undefined ||
            resp.data.lesson !== undefined ||
            resp.data.reply !== undefined
        ).toBeTruthy();
      } else {
        expect(resp.data).toBeDefined();
      }
    } else {
      // allow 500 but fail other unexpected statuses
      expect(resp.status).toBe(500);
    }
  });

  test('POST /webhook generate_quiz (best-effort)', async () => {
    const body = { action: 'generate_quiz', question: 'Quiz me on SPQA', tenantId: 'default' };
    const resp = await withRetries(
      () => postJson(`${base}/webhook`, body, { 'x-api-key': String(key) }, GENERATE_TIMEOUT),
      4,
      500
    );

    if (resp.status >= 200 && resp.status < 300) {
      if (resp.data && typeof resp.data === 'object') {
        expect(
          resp.data.quiz !== undefined ||
            resp.data.mcqCount !== undefined ||
            resp.data.mcq !== undefined ||
            resp.data.reply !== undefined
        ).toBeTruthy();
      } else {
        expect(resp.data).toBeDefined();
      }
    } else {
      // allow 500 as above
      expect(resp.status).toBe(500);
    }
  });
});

// Delegate to the shared request helper which uses node-fetch and has
// its own defensive cleanup. This reduces low-level socket handling and
// avoids reimplementing HTTP bookkeeping here.
const { requestApp } = require('./helpers/request-helper');

async function postJson(url, body, headers = {}, timeout = 5000) {
  const u = new URL(url);
  const baseUrl = `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}`;
  const path = u.pathname + u.search;
  const target =
    _localApp && (baseUrl === 'http://127.0.0.1:3000' || baseUrl === 'http://localhost:3000')
      ? _localApp
      : baseUrl;
  const result = await requestApp(target, {
    method: 'post',
    path,
    body,
    headers,
    timeout,
  });
  // normalize shape to { status, data }
  return {
    status:
      result && result.status ? result.status : result && result.statusCode ? result.statusCode : 0,
    data: result && (result.body || result.data),
  };
}

// Delegate GET requests to the shared request helper which already applies
// Connection: close, AbortController timeouts and response-body destruction.
async function getText(url, timeout = 3000) {
  const u = new URL(url);
  const baseUrl = `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}`;
  const path = u.pathname + u.search;
  // If we're targeting the local default base and an in-process app is available,
  // prefer calling the Express app directly to avoid network races.
  const target =
    _localApp && (baseUrl === 'http://127.0.0.1:3000' || baseUrl === 'http://localhost:3000')
      ? _localApp
      : baseUrl;
  const result = await requestApp(target, { method: 'get', path, timeout });
  // requestApp returns { status, headers, body }
  return typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
}
