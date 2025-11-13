// Regression test to ensure the webhook always returns both `raw` and `data.raw`
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
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const request = require('supertest');
const { requestApp } = require('./helpers/request-helper');

// Use in-process `app` when possible to avoid network races. If `WEBHOOK_BASE`
// is set explicitly we will target that external base instead (useful for
// deployed smoke tests). Otherwise prefer `require('../novain-platform/webhook/server')`.
let requester;
const base = process.env.WEBHOOK_BASE || `http://127.0.0.1:${process.env.PORT || 3000}`;
let useRequestAppForRemote = false;
try {
  // Prefer in-process Express app when available
   
  const app = require('../novain-platform/webhook/server');
  requester = request(app);
} catch (e) {
  // Fall back to using the shared request helper which creates and
  // tears down remote connections safely (sets Connection: close, destroys
  // ephemeral servers, and forces socket cleanup).
  requester = null;
  useRequestAppForRemote = true;
}

// Helper: POST with a few retries on ECONNREFUSED to reduce CI flakiness.
async function postWithRetry(baseUrl, path, body, headers = {}, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      if (useRequestAppForRemote) {
        // Use the request helper which properly closes sockets for remote bases
        const out = await requestApp(base, {
          method: 'post',
          path,
          body,
          headers,
          timeout: 10000,
        });
        // Normalize to supertest-like shape for assertions in the tests
        return { status: out.status || 0, body: out.body };
      }
      const resp = await requester.post(path).set(headers).send(body);
      return resp;
    } catch (err) {
      const isConnRefused = err && (err.code === 'ECONNREFUSED' || err.errno === 'ECONNREFUSED');
      if (!isConnRefused || i + 1 === retries) throw err;
      // backoff
      await new Promise((r) => setTimeout(r, 150 * (i + 1)));
    }
  }
}

describe('regression: raw/data.raw mirror', () => {
  it('llm_elicit returns raw and data.raw with same payload', async () => {
    const resp = await postWithRetry(
      base,
      '/webhook',
      { action: 'llm_elicit', question: 'Test', tenantId: 't' },
      { 'x-api-key': process.env.WEBHOOK_API_KEY }
    );

    expect(resp.status).toBe(200);
    const body = resp.body || {};
    expect(body.raw).toBeDefined();
    expect(body.data).toBeDefined();
    expect(body.data.raw).toBeDefined();

    expect(body.raw).toEqual(body.data.raw);
  });

  it('invoke_component returns raw and data.raw with same payload', async () => {
    const resp = await postWithRetry(
      base,
      '/webhook',
      {
        action: 'invoke_component',
        component: 'C_CaptureQuestion',
        question: 'Q',
        tenantId: 't',
      },
      { 'x-api-key': process.env.WEBHOOK_API_KEY }
    );

    expect(resp.status).toBe(200);
    const body = resp.body || {};
    expect(body.raw).toBeDefined();
    expect(body.data).toBeDefined();
    expect(body.data.raw).toBeDefined();
    expect(body.raw).toEqual(body.data.raw);
  });
});
