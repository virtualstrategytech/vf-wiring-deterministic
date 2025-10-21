// Ensure env is set before requiring the server so module-level flags are evaluated correctly
process.env.WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY || 'test123';
process.env.NODE_ENV = 'development';
process.env.DEBUG_WEBHOOK = 'true';
process.env.PROMPT_URL = process.env.PROMPT_URL || 'http://example.local/prompt';

// Mock global fetch so the server's fetchWithTimeout receives a predictable payload
globalThis.fetch = async () => {
  // Simulate a Response-like object used by fetchWithTimeout
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
  // use supertest to avoid creating a real server (prevents Jest open handles)

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
      // give Node one tick to let any async cleanup settle (helps Jest detect closed handles)
      await new Promise((resolve) => setImmediate(resolve));
    } catch {}
  });

  it('logs llm payload snippet when enabled', async () => {
    const logs = await captureConsoleAsync(async () => {
      const stack = (app && app._router && app._router.stack) || [];
      // Try a couple of heuristics to locate the POST /webhook route
      let layer = stack.find(
        (s) => s.route && s.route.path === '/webhook' && s.route.methods && s.route.methods.post
      );
      if (!layer) layer = stack.find((s) => s.route && String(s.route.path).includes('webhook'));

      const entry =
        layer &&
        layer.route &&
        Array.isArray(layer.route.stack) &&
        layer.route.stack.find((e) => typeof e.handle === 'function');
      const handler = entry && entry.handle;
      if (!handler) {
        const routes = stack
          .filter((s) => s.route)
          .map((s) => ({
            path: s.route.path,
            methods: s.route.methods,
            stackLen: s.route.stack && s.route.stack.length,
          }))
          .slice(0, 20);
        throw new Error(
          'webhook route handler not found. router stack routes: ' + JSON.stringify(routes, null, 2)
        );
      }

      const headers = { 'x-api-key': process.env.WEBHOOK_API_KEY };
      const req = {
        body: { action: 'llm_elicit', question: 'Q', tenantId: 't' },
        get: (k) => headers[k.toLowerCase()],
        rawBody: Buffer.from(JSON.stringify({})),
        method: 'POST',
        originalUrl: '/webhook',
      };

      let resBody = null;
      const res = {
        status(code) {
          this._status = code;
          return this;
        },
        json(obj) {
          resBody = obj;
          return this;
        },
        send(s) {
          resBody = s;
          return this;
        },
        set() {},
      };

      await handler(req, res);
      expect(resBody).toBeTruthy();
    });

    const combined = logs.out.join('\n') + '\n' + logs.err.join('\n');
    expect(combined.includes('llm payload snippet:')).toBe(true);
  });
});
