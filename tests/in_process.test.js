const { resolveApiKey } = require('./helpers/api-key');
resolveApiKey();
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DEBUG_WEBHOOK = process.env.DEBUG_WEBHOOK || 'false';
// Ensure external service URLs are blank for in-process tests so the
// `llm_elicit` handler uses the deterministic local stub instead of
// attempting network calls that change the response shape (and can
// cause flakiness when developers or CI set these globals).
process.env.PROMPT_URL = process.env.PROMPT_URL || '';
process.env.BUSINESS_URL = process.env.BUSINESS_URL || '';
process.env.RETRIEVAL_URL = process.env.RETRIEVAL_URL || '';

const app = require('../novain-platform/webhook/server');

describe('in-process webhook app (refactored)', () => {
  jest.setTimeout(20000);

  it('returns llm_elicit stub with source "stub"', async () => {
    try {
      const { requestApp } = require('./helpers/request-helper');
      const resp = await requestApp(app, {
        method: 'post',
        path: '/webhook',
        body: { action: 'llm_elicit', question: 'Please clarify X?', tenantId: 'default' },
        headers: { 'x-api-key': process.env.WEBHOOK_API_KEY },
        timeout: 5000,
      });

      // Debug: print the response body to capture actual shape when tests fail
      // (helps diagnose mismatch between test expectation and server response)
      // (debug logging removed) response shape is asserted below

      expect(resp.status).toBe(200);

      const body = resp.body || {};
      // tolerate either shape: prefer `data.raw.source` but fall back to `raw.source`
      const rawSource = body?.data?.raw?.source ?? body?.raw?.source;
      expect(rawSource).toBe('stub');
    } finally {
      // no TCP server to close when using supertest(app)
    }
  });
});
