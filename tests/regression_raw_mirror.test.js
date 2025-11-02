// Regression test to ensure the webhook always returns both `raw` and `data.raw`
process.env.WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY || 'test123';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

// In CI environments prefer child-process server isolation to avoid native
// handle flakiness observed on some runners. Enable only when running on CI.
try {
  if (process.env.GITHUB_ACTIONS === 'true' || process.env.CI === 'true') {
    process.env.USE_CHILD_PROCESS_SERVER = process.env.USE_CHILD_PROCESS_SERVER || '1';
  }
} catch {}

const app = require('../novain-platform/webhook/server');

describe('regression: raw/data.raw mirror', () => {
  it('llm_elicit returns raw and data.raw with same payload', async () => {
    try {
      const { requestApp } = require('./helpers/request-helper');
      const respSuper = await requestApp(app, {
        method: 'post',
        path: '/webhook',
        body: { action: 'llm_elicit', question: 'Test', tenantId: 't' },
        headers: { 'x-api-key': process.env.WEBHOOK_API_KEY },
        timeout: 5000,
      });
      const resp = respSuper;

      expect(resp.status).toBe(200);
      const body = resp.body || {};
      expect(body.raw).toBeDefined();
      expect(body.data).toBeDefined();
      expect(body.data.raw).toBeDefined();
      expect(body.raw).toEqual(body.data.raw);
    } finally {
      // ensure any helper-tracked sockets are force-closed as a fallback
      try {
        const serverHelper = require('./helpers/server-helper');
        if (serverHelper && typeof serverHelper._forceCloseAllSockets === 'function') {
          serverHelper._forceCloseAllSockets();
        }
      } catch {}
    }
  });

  it('invoke_component returns raw and data.raw with same payload', async () => {
    try {
      const { requestApp } = require('./helpers/request-helper');
      const respSuper = await requestApp(app, {
        method: 'post',
        path: '/webhook',
        body: {
          action: 'invoke_component',
          component: 'C_CaptureQuestion',
          question: 'Q',
          tenantId: 't',
        },
        headers: { 'x-api-key': process.env.WEBHOOK_API_KEY },
        timeout: 5000,
      });
      const resp = respSuper;

      expect(resp.status).toBe(200);
      const body = resp.body || {};
      expect(body.raw).toBeDefined();
      expect(body.data).toBeDefined();
      expect(body.data.raw).toBeDefined();
      expect(body.raw).toEqual(body.data.raw);
    } finally {
      // ensure any helper-tracked sockets are force-closed as a fallback
      try {
        const serverHelper = require('./helpers/server-helper');
        if (serverHelper && typeof serverHelper._forceCloseAllSockets === 'function') {
          serverHelper._forceCloseAllSockets();
        }
      } catch {}
    }
  });
});
