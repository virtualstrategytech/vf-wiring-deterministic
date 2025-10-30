// Ensure env is set before requiring the server so module-level flags are evaluated correctly
process.env.WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY || 'test123';
process.env.NODE_ENV = 'development';
process.env.DEBUG_WEBHOOK = 'true';
process.env.PROMPT_URL = process.env.PROMPT_URL || 'http://example.local/prompt';

// Use nock to stub the external PROMPT_URL so tests don't rely on global
// fetch mocking; this will make tests robust and compatible with eventual
// child-process server mode in CI.
const nock = require('nock');
const promptUrl = new URL(process.env.PROMPT_URL);
const promptOrigin = `${promptUrl.protocol}//${promptUrl.host}`;
const payload = {
  summary: 'Test summary',
  needs_clarify: false,
  followup_question: '',
  debug_meta: 'sensitive-llm-output',
};
// Intercept POST requests to the prompt service and return a deterministic payload.
// Use a broad path matcher so the stub still matches when child-process
// server mode or per-request agent instrumentation changes the request URL
// shape slightly.
nock(promptOrigin).post(/.*/).reply(200, payload).persist();

// Ensure tests use a node-style fetch implementation (node-fetch) so nock can
// intercept outgoing HTTP requests that the server makes. Node 18+ exposes
// a global fetch backed by undici which nock cannot intercept reliably.
try {
  // Use require so this runs in CommonJS tests.
  // If node-fetch is not installed, this will throw and we fall back to the
  // environment's global fetch (might not be interceptable by nock).
  globalThis.fetch = require('node-fetch');
} catch {}

// If tests are running the server in a child process, parent-installed nock
// interceptors won't affect the child. Propagate a small env-driven stub so
// the child-runner can install the same stub automatically.
if (process.env.USE_CHILD_PROCESS_SERVER === '1') {
  try {
    process.env.TEST_PROMPT_STUB = '1';
    process.env.TEST_PROMPT_PAYLOAD_JSON = JSON.stringify(payload);
  } catch {}
}

const app = require('../novain-platform/webhook/server');
// Note: tests use `requestApp` helper which internally uses supertest(app).

async function captureConsoleAsync(action) {
  const logs = { out: [], err: [] };
  const origLog = console.log;
  const origInfo = console.info;
  const origError = console.error;
  console.log = (...args) => logs.out.push(args.join(' '));
  console.info = (...args) => logs.out.push(args.join(' '));
  console.error = (...args) => logs.err.push(args.join(' '));
  try {
    await action();
    return logs;
  } finally {
    console.log = origLog;
    console.info = origInfo;
    console.error = origError;
  }
}

describe('llm payload logging when DEBUG_WEBHOOK=true', () => {
  jest.setTimeout(20000);

  afterAll(async () => {
    try {
      const http = require('http');
      const https = require('https');
      if (http && http.globalAgent && typeof http.globalAgent.destroy === 'function') {
        http.globalAgent.destroy();
      }
      if (https && https.globalAgent && typeof https.globalAgent.destroy === 'function') {
        https.globalAgent.destroy();
      }
      await new Promise((resolve) => setImmediate(resolve));
    } catch {}
  });

  it('logs llm payload snippet when enabled', async () => {
    try {
      const { requestApp } = require('./helpers/request-helper');
      const logs = await captureConsoleAsync(async () => {
        const resp = await requestApp(app, {
          method: 'post',
          path: '/webhook',
          body: { action: 'llm_elicit', question: 'Q', tenantId: 't' },
          headers: { 'x-api-key': process.env.WEBHOOK_API_KEY },
          timeout: 5000,
        });

        expect(resp.status).toBeGreaterThanOrEqual(200);
        expect(resp.status).toBeLessThan(300);
      });

      const combined = logs.out.join('\n') + '\n' + logs.err.join('\n');
      // Server should log a short snippet of the LLM payload when DEBUG_WEBHOOK=true
      expect(/llm payload snippet|llm payload|raw payload/i.test(combined)).toBe(true);
    } finally {
      // nothing to close when using supertest(app)
    }
  });
});
// (postJson helper intentionally omitted in this test file)
