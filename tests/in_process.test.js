// supertest not needed for in-process handler invocation
// Ensure required env vars are set before importing the app so module-level
// initialization uses the correct values (API key and debug flags).
process.env.WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY || 'test123';
process.env.PROMPT_URL = process.env.PROMPT_URL || '';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DEBUG_WEBHOOK = process.env.DEBUG_WEBHOOK || 'false';

const app = require('../novain-platform/webhook/server');

// Helpers to capture stdout/stderr during an async action
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

describe('in-process webhook app', () => {
  jest.setTimeout(20000);
  // use supertest agent to avoid starting a real server (prevents open handles)

  it('should return llm_elicit stub with raw.source = "stub"', async () => {
    const logs = await captureConsoleAsync(async () => {
      // locate the webhook route handler on the express app
      const stack = (app && app._router && app._router.stack) || [];
      let layer = stack.find((s) => s.route && s.route.path === '/webhook');
      if (!layer) layer = stack.find((s) => s.route && String(s.route.path).includes('webhook'));
      const entry =
        layer &&
        layer.route &&
        Array.isArray(layer.route.stack) &&
        layer.route.stack.find((e) => typeof e.handle === 'function');
      const handler = entry && entry.handle;
      expect(typeof handler).toBe('function');

      const headers = { 'x-api-key': process.env.WEBHOOK_API_KEY };
      const req = {
        body: { action: 'llm_elicit', question: 'Please clarify X?', tenantId: 'default' },
        get: (k) => headers[k.toLowerCase()],
        rawBody: Buffer.from('{}'),
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

      // Basic status checks
      expect(resBody).toBeDefined();
      expect(resBody.raw).toBeDefined();
      expect(resBody.raw.source).toBe('stub');
    });

    const outText = logs.out.join('\n') + '\n' + logs.err.join('\n');
    // With NODE_ENV=test and DEBUG_WEBHOOK=false we should not log full LLM snippets
    expect(outText.includes('llm payload snippet')).toBe(false);
  });
});

// postJson removed — tests use supertest now
