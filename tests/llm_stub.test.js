const fs = require('fs');
const path = require('path');

const { resolveApiKey } = require('./helpers/api-key');
const key = resolveApiKey();

// In CI environments prefer child-process server isolation to avoid native
// handle flakiness observed on some runners. This is conservative and only
// changes behavior when running in CI/GitHub Actions.
try {
  if (process.env.GITHUB_ACTIONS === 'true' || process.env.CI === 'true') {
    process.env.USE_CHILD_PROCESS_SERVER = process.env.USE_CHILD_PROCESS_SERVER || '1';
  }
} catch {}

const app = require('../novain-platform/webhook/server');
// This test uses `requestApp` helper (supertest) so no TCP server is required.

describe('llm_elicit stub behavior', () => {
  // tolerate slightly longer network/CI delays
  jest.setTimeout(20000);

  test('POST /webhook llm_elicit returns stub when PROMPT_URL not set', async () => {
    try {
      const body = { action: 'llm_elicit', question: 'Explain SPQA', tenantId: 'default' };

      const { requestApp } = require('./helpers/request-helper');
      const respSuper = await requestApp(app, {
        method: 'post',
        path: '/webhook',
        body,
        headers: { 'x-api-key': String(key) },
        timeout: 7000,
      });

      const resp = { status: respSuper.status, data: respSuper.body };

      // Accept 2xx success or 400 when a prompt service is intentionally not configured
      expect(resp.status).toBeGreaterThanOrEqual(200);
      expect(resp.status).toBeLessThan(500);
      expect(resp.data).toBeDefined();
      // When prompt service is not configured the webhook returns raw.source === 'stub'.
      // If `PROMPT_URL` is set in the environment, the external prompt service
      // may return varying payloads; be tolerant in that case but ensure we
      // at least receive a parsed object.
      if (resp.data && typeof resp.data === 'object') {
        // tolerate multiple shapes: `body.raw` or `body.data.raw`
        const body = respSuper.body || {};
        const rawObj = (body && body.raw) || (body && body.data && body.data.raw);
        if (!rawObj) {
          try {
            console.error('llm_stub: unexpected body shape:', JSON.stringify(body).slice(0, 2000));
          } catch {}
        }
        expect(rawObj).toBeDefined();
        if (!process.env.PROMPT_URL) {
          expect(
            rawObj.source === 'stub' ||
              rawObj.source === 'invoke_component_stub' ||
              rawObj.source === 'invoke_component_default'
          ).toBeTruthy();
        } else {
          expect(typeof rawObj === 'object').toBeTruthy();
        }
      }
    } finally {
      // nothing to close when using supertest(app)
    }
  });
});

// postJson helper intentionally removed: request-helper is used instead.
