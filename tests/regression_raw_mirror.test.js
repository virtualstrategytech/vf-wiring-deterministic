// Regression test to ensure the webhook always returns both `raw` and `data.raw`
process.env.WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY || 'test123';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const request = require('supertest');
const app = require('../novain-platform/webhook/server');
const { startTestServer } = require('./helpers/server-helper');

describe('regression: raw/data.raw mirror', () => {
  it('llm_elicit returns raw and data.raw with same payload', async () => {
    const srv = await startTestServer(app);
    try {
      const resp = await request(srv.base)
        .post('/webhook')
        .set('x-api-key', process.env.WEBHOOK_API_KEY)
        .send({ action: 'llm_elicit', question: 'Test', tenantId: 't' })
        .timeout({ deadline: 5000 });

      expect(resp.status).toBe(200);
      const body = resp.body || {};
      expect(body.raw).toBeDefined();
      expect(body.data).toBeDefined();
      expect(body.data.raw).toBeDefined();
      expect(body.raw).toEqual(body.data.raw);
    } finally {
      await srv.close();
    }
  });

  it('invoke_component returns raw and data.raw with same payload', async () => {
    const srv = await startTestServer(app);
    try {
      const resp = await request(srv.base)
        .post('/webhook')
        .set('x-api-key', process.env.WEBHOOK_API_KEY)
        .send({
          action: 'invoke_component',
          component: 'C_CaptureQuestion',
          question: 'Q',
          tenantId: 't',
        })
        .timeout({ deadline: 5000 });

      expect(resp.status).toBe(200);
      const body = resp.body || {};
      expect(body.raw).toBeDefined();
      expect(body.data).toBeDefined();
      expect(body.data.raw).toBeDefined();
      expect(body.raw).toEqual(body.data.raw);
    } finally {
      await srv.close();
    }
  });
});
