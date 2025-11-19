// Lightweight in-process verification test: require the Express app without listening
// and exercise a couple of endpoints using supertest.

// Ensure tests run deterministically in CI (use provided secret when present,
// otherwise fall back to a stable test key). Capture the runtime key into
// a local constant so requests use the exact expected value.
const API_KEY = (process.env.WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY || 'test123');

const path = require('path');
const { requestApp } = require('./helpers/request-helper');

// require the app directly (exports the Express app and a createServer helper)
const app = require(path.join(__dirname, '..', 'novain-platform', 'webhook', 'server.js'));

describe('in-process app smoke', () => {
  test('GET /health returns ok', async () => {
    const res = await requestApp(app, { method: 'get', path: '/health' });
    expect(res.status).toBe(200);
    expect(String(res.body)).toBe('ok');
  });

  test('POST /webhook ping (in-process) works with API key', async () => {
    const payload = require('./fixtures/ping.json');
    const res = await requestApp(app, {
      method: 'post',
      path: '/webhook',
      headers: { 'x-api-key': API_KEY, 'content-type': 'application/json' },
      body: payload,
    });

    expect(res.status).toBe(200);
    expect(res.body && res.body.ok).toBe(true);
    expect(typeof (res.body && res.body.reply)).toBe('string');
    expect(res.body && res.body.port).toBeDefined();
  });
});
