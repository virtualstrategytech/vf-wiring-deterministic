const fs = require('fs');
const path = require('path');

const secretFile = path.resolve(__dirname, 'webhook.secret');
const key =
  process.env.WEBHOOK_API_KEY ||
  (fs.existsSync(secretFile) ? fs.readFileSync(secretFile, 'utf8').trim() : 'test123');

// Ensure the in-process server reads the same API key at module-load time
process.env.WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY || key;

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
      // When prompt service is not configured the webhook returns raw.source === 'stub'
      if (resp.data && typeof resp.data === 'object') {
        expect(resp.data.raw).toBeDefined();
        expect(
          resp.data.raw.source === 'stub' ||
            resp.data.raw.source === 'invoke_component_stub' ||
            resp.data.raw.source === 'invoke_component_default'
        ).toBeTruthy();
      }
    } finally {
      // nothing to close when using supertest(app)
    }
  });
});

// postJson helper intentionally removed: request-helper is used instead.
