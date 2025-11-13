process.env.WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY || 'test123';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DEBUG_WEBHOOK = process.env.DEBUG_WEBHOOK || 'false';

const supertest = require('supertest');
const app = require('../novain-platform/webhook/server');

describe('in-process webhook app (refactored)', () => {
  jest.setTimeout(20000);
  let server;
  beforeAll(() => {
    server = app.listen();
    if (server && typeof server.unref === 'function') {
      try {
        server.unref();
      } catch {}
    }
    server._sockets = new Set();
    server.on('connection', (s) => {
      server._sockets.add(s);
      s.on('close', () => server._sockets.delete(s));
    });
  });

  afterAll(async () => {
    try {
      if (server && typeof server.close === 'function') {
        await new Promise((r) => server.close(r));
      }
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
        if (http && http.globalAgent && typeof http.globalAgent.destroy === 'function') {
          http.globalAgent.destroy();
        }
        if (https && https.globalAgent && typeof https.globalAgent.destroy === 'function') {
          https.globalAgent.destroy();
        }
      } catch {}
    } catch {}
  });

  it('returns llm_elicit stub with source "stub"', async () => {
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
  });
});
