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

const supertest = require('supertest');

describe('in-process webhook app (refactored)', () => {
  jest.setTimeout(20000);

  // Prefer in-process app to avoid TCP races. If `WEBHOOK_BASE` is set we
  // target that external URL (used for deployed smoke tests). Otherwise
  // require the app and use supertest(app).
  const base = process.env.WEBHOOK_BASE || `http://127.0.0.1:${process.env.PORT || 3000}`;
  let requester;
  if (process.env.WEBHOOK_BASE) {
    requester = supertest(base);
  } else {
    try {
       
      const app = require('../novain-platform/webhook/server');
      requester = supertest(app);
    } catch (e) {
      requester = supertest(base);
    }
  }

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
    expect(rawSource).toBe('stub');
  });
});
