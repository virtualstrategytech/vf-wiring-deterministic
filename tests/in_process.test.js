// in_process.test.js — start a short-lived server and hit it with supertest
// Ensure required env vars are set before importing the app so module-level
// initialization uses the correct values (API key and debug flags).
process.env.WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY || 'test123';
process.env.PROMPT_URL = process.env.PROMPT_URL || '';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DEBUG_WEBHOOK = process.env.DEBUG_WEBHOOK || 'false';

const request = require('supertest');
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

  it('should return llm_elicit stub with raw.source = "stub"', async () => {
    const logs = await captureConsoleAsync(async () => {
      const http = require('http');
      // Create an explicit server so we can control its lifecycle.
      const server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, resolve));
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;
      let resp;
      try {
        resp = await request(baseUrl)
          .post('/webhook')
          .set('Connection', 'close')
          .set('x-api-key', process.env.WEBHOOK_API_KEY)
          .send({ action: 'llm_elicit', question: 'Please clarify X?', tenantId: 'default' })
          .timeout({ response: 5000, deadline: 6000 });
      } finally {
        try {
          await new Promise((resolve) => server.close(resolve));
        } catch (e) {
          /* ignore */
        }
      }

      // Basic status checks
      expect(resp.status).toBeGreaterThanOrEqual(200);
      expect(resp.status).toBeLessThan(300);
      // supertest exposes parsed body as resp.body
      expect(resp.body).toBeDefined();
      // llm_elicit stub returns raw.source === 'stub'
      // Some callers wrap the LLM payload in `data.raw`; accept either.
      const raw = resp.body.raw || (resp.body.data && resp.body.data.raw);
      expect(raw).toBeDefined();
      expect(raw.source).toBe('stub');
    });

    const outText = logs.out.join('\n') + '\n' + logs.err.join('\n');
    // With NODE_ENV=test and DEBUG_WEBHOOK=false we should not log full LLM snippets
    expect(outText.includes('llm payload snippet')).toBe(false);
  });
});
