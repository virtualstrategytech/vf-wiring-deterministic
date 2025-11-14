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
process.env.DEBUG_WEBHOOK = process.env.DEBUG_WEBHOOK || 'false';
// Use lightweight body parser during tests to avoid the raw-body/body-parser
// closure which can be reported as an open handle by Jest's detectOpenHandles.
process.env.SKIP_BODY_PARSER = process.env.SKIP_BODY_PARSER || '1';

const supertest = require('supertest');

describe('in-process webhook app (refactored)', () => {
  jest.setTimeout(20000);

  // Prefer in-process app to avoid TCP races. If `WEBHOOK_BASE` is set we
  // target that external URL (used for deployed smoke tests). Otherwise
  // require the app and use supertest(app).
  const base = process.env.WEBHOOK_BASE || `http://127.0.0.1:${process.env.PORT || 3000}`;
  let requester;
  let _appInstance = null;
  if (process.env.WEBHOOK_BASE) {
    requester = supertest(base);
  } else {
    try {
      _appInstance = require('../novain-platform/webhook/server');
      // Use a plain supertest instance (not an agent) to avoid creating a
      // persistent underlying server handle that sometimes lingers in Jest.
      requester = supertest(_appInstance);
    } catch (e) {
      requester = supertest(base);
    }
  }

  afterAll(async () => {
    // Best-effort async cleanup: destroy shared agents and other resources
    // the app may have created (keeps sockets from lingering in Jest runs).
    try {
      if (_appInstance && typeof _appInstance.closeResources === 'function') {
        try {
          _appInstance.closeResources();
        } catch {}
      }
      if (requester && typeof requester.close === 'function') {
        try {
          // supertest.agent returns a closeable instance in recent versions
          await requester.close();
        } catch {}
      }
    } catch {}
    // allow a short grace period for any async handles to finish closing
    try {
      await new Promise((r) => setTimeout(r, 50));
    } catch {}
  });

  it('returns llm_elicit stub with source "stub"', async () => {
    // Use a small retry wrapper to avoid transient ECONNREFUSED flakes in CI
    async function postWithRetry(_baseUrl, path, body, headers = {}, retries = 5) {
      for (let i = 0; i < retries; i++) {
        try {
          const resp = await requester.post(path).set(headers).send(body);
          return resp;
        } catch (err) {
          const isConnRefused =
            err && (err.code === 'ECONNREFUSED' || err.errno === 'ECONNREFUSED');
          if (!isConnRefused || i + 1 === retries) throw err;
          await new Promise((r) => setTimeout(r, 150 * (i + 1)));
        }
      }
    }

    const resp = await postWithRetry(
      base,
      '/webhook',
      { action: 'llm_elicit', question: 'Please clarify X?', tenantId: 'default' },
      { 'x-api-key': process.env.WEBHOOK_API_KEY }
    );

    const body = resp.body || {};
    const rawSource =
      (body && body.raw && body.raw.source) ||
      (body && body.data && body.data.raw && body.data.raw.source);

    if (!rawSource) {
      // Add helpful debug output so CI and local runs surface the actual
      // response shape when the assertion fails.
      try {
        // truncate long bodies for readability
        const asJson = JSON.stringify(body || {}, null, 2).slice(0, 2000);
         
        console.error('in-process test: unexpected response body:', asJson);
      } catch (e) {
        // ignore logging failures
      }
    }

    expect(rawSource).toBe('stub');
  });
});
