// debug_call_llm.js - reproduce failing test outside Jest
process.env.WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY || 'test123';
process.env.NODE_ENV = 'development';
process.env.DEBUG_WEBHOOK = 'true';
process.env.PROMPT_URL = process.env.PROMPT_URL || 'http://example.local/prompt';

globalThis.fetch = async () => {
  const payload = {
    summary: 'Test summary',
    needs_clarify: false,
    followup_question: '',
    debug_meta: 'sensitive-llm-output',
  };
  return {
    ok: true,
    status: 200,
    clone: () => ({ text: async () => JSON.stringify(payload) }),
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  };
};

(async () => {
  try {
    const app = require('../novain-platform/webhook/server');
    const { requestApp } = require('../tests/helpers/request-helper');
    const resp = await requestApp(app, {
      method: 'post',
      path: '/webhook',
      body: { action: 'llm_elicit', question: 'Q', tenantId: 't' },
      headers: { 'x-api-key': process.env.WEBHOOK_API_KEY },
      timeout: 5000,
    });
    console.log('RESP:', resp);
  } catch (err) {
    console.error('ERR:', err && err.stack ? err.stack : err);
  }
})();
