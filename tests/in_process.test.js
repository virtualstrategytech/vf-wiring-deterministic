process.env.WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY || 'test123';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DEBUG_WEBHOOK = process.env.DEBUG_WEBHOOK || 'false';

const supertest = require('supertest');
const app = require('../novain-platform/webhook/server');

describe('in-process webhook app (refactored)', () => {
  jest.setTimeout(20000);
  // Use the express app directly with supertest (no real listening server).
  // This avoids Jest open-handle warnings caused by servers left open.

  it('returns llm_elicit stub with source "stub"', async () => {
    // Use supertest against the Express app in-process to avoid creating a real server.
    const req = supertest(app)
      .post('/webhook')
      .set('x-api-key', process.env.WEBHOOK_API_KEY)
      .send({ action: 'llm_elicit', question: 'Please clarify X?', tenantId: 'default' });
    const resp = await req;
    // If supertest created a temporary server, close it immediately
    try {
      if (req && req._server && typeof req._server.close === 'function') req._server.close();
    } catch (e) {}
    try {
      const http = require('http');
      const https = require('https');
      if (http && http.globalAgent && typeof http.globalAgent.destroy === 'function')
        http.globalAgent.destroy();
      if (https && https.globalAgent && typeof https.globalAgent.destroy === 'function')
        https.globalAgent.destroy();
    } catch (e) {}

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
