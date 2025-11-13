const fs = require('fs');
const path = require('path');
const secretFile = path.resolve(__dirname, 'webhook.secret');
if (!process.env.WEBHOOK_API_KEY && fs.existsSync(secretFile)) {
  try {
    process.env.WEBHOOK_API_KEY = fs.readFileSync(secretFile, 'utf8').trim();
  } catch {
    // ignore
  }
}
process.env.WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY || 'test123';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DEBUG_WEBHOOK = process.env.DEBUG_WEBHOOK || 'false';

const supertest = require('supertest');

describe('in-process webhook app (refactored)', () => {
  jest.setTimeout(20000);

  // Use the global server started by tests/globalSetup.js. globalSetup starts
  // the webhook on process.env.PORT (default 3000). Tests should use that
  // server to avoid creating additional listeners which can trigger Jest
  // detectOpenHandles.
  const base = process.env.WEBHOOK_BASE || `http://127.0.0.1:${process.env.PORT || 3000}`;

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
