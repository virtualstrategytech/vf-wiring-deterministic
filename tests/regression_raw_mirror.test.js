// Regression test to ensure the webhook always returns both `raw` and `data.raw`
process.env.WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY || 'test123';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const request = require('supertest');
const http = require('http');
const app = require('../novain-platform/webhook/server');

describe('regression: raw/data.raw mirror', () => {
  let server;
  let base;

  beforeAll(async () => {
    server = http.createServer(app);
    try {
      if (typeof server.unref === 'function') server.unref();
      if (typeof server.setTimeout === 'function') server.setTimeout(0);
      server.keepAliveTimeout = 0;
    } catch (e) {}
    await new Promise((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    try {
      await new Promise((resolve) => server.close(resolve));
    } catch (e) {}
    try {
      const https = require('https');
      if (http && http.globalAgent && typeof http.globalAgent.destroy === 'function')
        http.globalAgent.destroy();
      if (https && https.globalAgent && typeof https.globalAgent.destroy === 'function')
        https.globalAgent.destroy();
    } catch (e) {}
  });

  it('llm_elicit returns raw and data.raw with same payload', async () => {
    const resp = await request(base)
      .post('/webhook')
      .set('x-api-key', process.env.WEBHOOK_API_KEY)
      .send({ action: 'llm_elicit', question: 'Test', tenantId: 't' });

    expect(resp.status).toBe(200);
    const body = resp.body || {};
    expect(body.raw).toBeDefined();
    expect(body.data).toBeDefined();
    expect(body.data.raw).toBeDefined();
    expect(body.raw).toEqual(body.data.raw);
  });

  it('invoke_component returns raw and data.raw with same payload', async () => {
    const resp = await request(base)
      .post('/webhook')
      .set('x-api-key', process.env.WEBHOOK_API_KEY)
      .send({
        action: 'invoke_component',
        component: 'C_CaptureQuestion',
        question: 'Q',
        tenantId: 't',
      });

    expect(resp.status).toBe(200);
    const body = resp.body || {};
    expect(body.raw).toBeDefined();
    expect(body.data).toBeDefined();
    expect(body.data.raw).toBeDefined();
    expect(body.raw).toEqual(body.data.raw);
  });
});
