// Regression test to ensure the webhook always returns both `raw` and `data.raw`
process.env.WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY || 'test123';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const request = require('supertest');
const app = require('../novain-platform/webhook/server');

describe('regression: raw/data.raw mirror', () => {
  let server;
  beforeAll(() => {
    server = app.listen();
  });

  afterAll(async () => {
    try {
      if (server && typeof server.close === 'function') {
        await new Promise((r) => server.close(r));
      }
      const http = require('http');
      const https = require('https');
      if (http && http.globalAgent && typeof http.globalAgent.destroy === 'function') {
        http.globalAgent.destroy();
      }
      if (https && https.globalAgent && typeof https.globalAgent.destroy === 'function') {
        https.globalAgent.destroy();
      }
      await new Promise((r) => setImmediate(r));
    } catch {}
  });
  it('llm_elicit returns raw and data.raw with same payload', async () => {
    const resp = await request(server)
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
  });

  it('invoke_component returns raw and data.raw with same payload', async () => {
    const resp = await request(server)
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
  });
});
