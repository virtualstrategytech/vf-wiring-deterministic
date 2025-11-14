// Ensure env is set before requiring the server so module-level flags are evaluated correctly
const fs = require('fs');
const path = require('path');
const secretFile = path.resolve(__dirname, 'webhook.secret');
if (!process.env.WEBHOOK_API_KEY && fs.existsSync(secretFile)) {
  try {
    process.env.WEBHOOK_API_KEY = fs.readFileSync(secretFile, 'utf8').trim();
  } catch {
    // ignore
  }
}
process.env.WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY || 'test123';
process.env.NODE_ENV = 'development';
process.env.DEBUG_WEBHOOK = 'true';
process.env.PROMPT_URL = process.env.PROMPT_URL || 'http://example.local/prompt';

// Mock global fetch so the server's fetchWithTimeout receives a predictable payload
globalThis.fetch = async () => {
  const payload = {
    summary: 'Test summary',
    needs_clarify: false,
    followup_question: '',
    debug_meta: 'sensitive-llm-output',
  };
  return {
    ok: true,
    status: 200,
    clone: () => ({ text: async () => JSON.stringify(payload) }),
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  };
};

const request = require('supertest');
const app = require('../novain-platform/webhook/server');

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
  // To avoid leaving handles, create a short-lived local HTTP server from the
  // exported Express `app` instance and target it via its base URL. This lets
  // the test control server env (DEBUG_WEBHOOK) while still ensuring explicit
  // shutdown to avoid Jest open-handle warnings.
  const http = require('http');
  let server;
  let base;

  beforeAll(async () => {
    server = http.createServer(app);
    try {
      if (typeof server.unref === 'function') server.unref();
      if (typeof server.setTimeout === 'function') server.setTimeout(0);
      server.keepAliveTimeout = 0;
    } catch {}
    await new Promise((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    try {
      if (server && typeof server.close === 'function') {
        await new Promise((resolve) => server.close(resolve));
      }
    } catch {}
    try {
      // Ensure exported app shared agents are destroyed to avoid lingering
      // keepAlive sockets that can trigger Jest detectOpenHandles.
      try {
        if (app && typeof app.closeResources === 'function') {
          try {
            app.closeResources();
          } catch {}
        }
      } catch {}
      const http = require('http');
      const https = require('https');
      if (http && http.globalAgent && typeof http.globalAgent.destroy === 'function')
        http.globalAgent.destroy();
      if (https && https.globalAgent && typeof https.globalAgent.destroy === 'function')
        https.globalAgent.destroy();
    } catch {}
  });

  it('logs llm payload snippet when enabled', async () => {
    const logs = await captureConsoleAsync(async () => {
      const req = request(base)
        .post('/webhook')
        .set('x-api-key', process.env.WEBHOOK_API_KEY)
        .send({ action: 'llm_elicit', question: 'Q', tenantId: 't' });
      const resp = await req;

      try {
        if (req && req._server && typeof req._server.close === 'function') req._server.close();
      } catch {}
      try {
        const http = require('http');
        const https = require('https');
        if (http && http.globalAgent && typeof http.globalAgent.destroy === 'function')
          http.globalAgent.destroy();
        if (https && https.globalAgent && typeof https.globalAgent.destroy === 'function')
          https.globalAgent.destroy();
      } catch {}

      expect(resp.status).toBeGreaterThanOrEqual(200);
      expect(resp.status).toBeLessThan(300);
    });

    const combined = logs.out.join('\n') + '\n' + logs.err.join('\n');
    // Server should log a short snippet of the LLM payload when DEBUG_WEBHOOK=true
    expect(/llm payload snippet|llm payload|raw payload/i.test(combined)).toBe(true);
  });
});
// Note: helper removed (unused) to avoid lint warnings in CI
