process.env.WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY || 'test123';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DEBUG_WEBHOOK = process.env.DEBUG_WEBHOOK || 'false';

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
      try {
        // eslint-disable-next-line no-console
        console.log('DEBUG resp.body:', JSON.stringify(resp.body));
      } catch {}

      expect(resp.status).toBe(200);

      const body = resp.body || {};
      const rawSource =
        (body && body.raw && body.raw.source) ||
        (body && body.data && body.data.raw && body.data.raw.source);
      expect(rawSource).toBe('stub');
    } finally {
      // no TCP server to close when using supertest(app)
    }
  });
});
