process.env.WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY || 'test123';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DEBUG_WEBHOOK = process.env.DEBUG_WEBHOOK || 'false';

const supertest = require('supertest');
const http = require('http');
const app = require('../novain-platform/webhook/server');

describe('in-process webhook app (refactored)', () => {
  jest.setTimeout(20000);

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

  it('returns llm_elicit stub with source "stub"', async () => {
    const resp = await supertest(base)
      .post('/webhook')
      .set('x-api-key', process.env.WEBHOOK_API_KEY)
      .send({ action: 'llm_elicit', question: 'Please clarify X?', tenantId: 'default' });

    // DEBUG: print full response to help diagnose missing fields during test runs
    // (left as temporary; will be removed once test expectation is fixed)
     
    console.log('DEBUG in_process resp:', {
      status: resp && resp.status,
      body: resp && resp.body,
      text: resp && resp.text,
    });

    const body = resp.body || {};
    const rawSource =
      (body && body.raw && body.raw.source) ||
      (body && body.data && body.data.raw && body.data.raw.source);
    expect(rawSource).toBe('stub');
  });
});
