// Ensure env is set before requiring the server so module-level flags are evaluated correctly
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
const { startTestServer } = require('./helpers/server-helper');

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
    const srv = await startTestServer(app);
    try {
      const logs = await captureConsoleAsync(async () => {
        const resp = await request(srv.base)
          .post('/webhook')
          .set('x-api-key', process.env.WEBHOOK_API_KEY)
          .send({ action: 'llm_elicit', question: 'Q', tenantId: 't' })
          .timeout({ deadline: 5000 });

        expect(resp.status).toBeGreaterThanOrEqual(200);
        expect(resp.status).toBeLessThan(300);
      });

      const combined = logs.out.join('\n') + '\n' + logs.err.join('\n');
      // Server should log a short snippet of the LLM payload when DEBUG_WEBHOOK=true
      expect(/llm payload snippet|llm payload|raw payload/i.test(combined)).toBe(true);
    } finally {
      await srv.close();
    }
  });
});
// (postJson helper intentionally omitted in this test file)
