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

// Ensure PROMPT_URL is defined for the test (globalSetup/jest.setup may set it)
process.env.PROMPT_URL = process.env.PROMPT_URL || 'http://127.0.0.1:3000';

// Use in-process `app` when possible to avoid network races. If `WEBHOOK_BASE`
// is set explicitly we will target that external base instead (useful for
// deployed smoke tests). Otherwise prefer `require('../novain-platform/webhook/server')`.
let requester;
const base = process.env.WEBHOOK_BASE || `http://127.0.0.1:${process.env.PORT || 3000}`;
let useRequestAppForRemote = false;
try {
  // Prefer in-process Express app when available

  const app = require('../novain-platform/webhook/server');
  // Prefer using our request helper which creates and tears down a
  // temporary server for each request to avoid lingering supertest
  // internal server/listen handles that can keep Jest from exiting.
  requester = null;
  useRequestAppForRemote = true;
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
        return { status: out.status || 0, body: out.body, headers: out.headers, text: out.text };
      }
      const resp = await requester.post(path).set(headers).send(body);
      return resp;
    } catch (err) {
      const isConnRefused = err && (err.code === 'ECONNREFUSED' || err.errno === 'ECONNREFUSED');
      // If this is the last retry or a non-ECONNREFUSED error, surface
      // helpful debug information before throwing so CI logs capture
      // the HTTP response shape and headers.
      if (!isConnRefused || i + 1 === retries) {
        try {
          console.error('postWithRetry: final error', err && err.stack ? err.stack : String(err));
          if (err && err.response) {
            try {
              console.error('postWithRetry: response status:', err.response.status);
              console.error('postWithRetry: response headers:', err.response.headers);
              console.error(
                'postWithRetry: response body:',
                err.response.data || err.response.text
              );
            } catch {}
          }
        } catch {}
        throw err;
      }
      // backoff
      await new Promise((r) => setTimeout(r, 150 * (i + 1)));
    }
  }
}

describe('regression: raw/data.raw mirror', () => {
  // Prompt mock is started centrally in `tests/globalSetup.js`.
  it('llm_elicit returns raw and data.raw with same payload', async () => {
    const resp = await postWithRetry(
      base,
      '/webhook',
      { action: 'llm_elicit', question: 'Test', tenantId: 't' },
      { 'x-api-key': process.env.WEBHOOK_API_KEY }
    );
    // If the HTTP response is not 200, print full details to aid CI debugging.
    if (!resp || resp.status !== 200) {
      try {
        console.error('regression test: unexpected response status:', resp && resp.status);
        try {
          console.error('regression test: response headers:', resp && resp.headers);
        } catch {}
        try {
          console.error(
            'regression test: response body/text:',
            resp && (resp.body || resp.text || resp.text)
          );
        } catch {}
      } catch {}
    }
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
