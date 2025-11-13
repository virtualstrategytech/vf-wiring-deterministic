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
    const server = app.listen();
    // track sockets so we can forcefully destroy them on teardown
    server._sockets = new Set();
    server.on('connection', (s) => {
      server._sockets.add(s);
      s.on('close', () => server._sockets.delete(s));
    });
    let resp;
    try {
      resp = await supertest(server)
        .post('/webhook')
        .set('x-api-key', process.env.WEBHOOK_API_KEY)
        .send({ action: 'llm_elicit', question: 'Please clarify X?', tenantId: 'default' })
        .timeout({ deadline: 5000 });

      expect(resp.status).toBe(200);
    } finally {
      await new Promise((r) => server.close(r));
      try {
        if (server && server._sockets) {
          for (const s of server._sockets) {
            try {
              s.destroy();
            } catch {}
          }
        }
      } catch {}
      try {
        const http = require('http');
        const https = require('https');
        if (http && http.globalAgent && typeof http.globalAgent.destroy === 'function')
          http.globalAgent.destroy();
        if (https && https.globalAgent && typeof https.globalAgent.destroy === 'function')
          https.globalAgent.destroy();
      } catch {}
    }

    const body = resp.body || {};
    const rawSource =
      (body && body.raw && body.raw.source) ||
      (body && body.data && body.data.raw && body.data.raw.source);
    expect(rawSource).toBe('stub');
  });
});
