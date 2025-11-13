process.env.WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY || 'test123';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DEBUG_WEBHOOK = process.env.DEBUG_WEBHOOK || 'false';

const supertest = require('supertest');
const app = require('../novain-platform/webhook/server');

describe('in-process webhook app (refactored)', () => {
  jest.setTimeout(20000);

  it('returns llm_elicit stub with source "stub"', async () => {
    const server = app.listen();
    try {
      const resp = await supertest(server)
        .post('/webhook')
        .set('x-api-key', process.env.WEBHOOK_API_KEY)
        .send({ action: 'llm_elicit', question: 'Please clarify X?', tenantId: 'default' })
        .timeout({ deadline: 5000 });

      expect(resp.status).toBe(200);

      const body = resp.body || {};
      const rawSource =
        (body && body.raw && body.raw.source) ||
        (body && body.data && body.data.raw && body.data.raw.source);
      expect(rawSource).toBe('stub');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
