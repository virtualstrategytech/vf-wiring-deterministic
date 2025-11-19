// debug_call_llm3.js - reproduce failing test and confirm fetch mock invocation
process.env.WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY || 'test123';
process.env.NODE_ENV = 'development';
process.env.DEBUG_WEBHOOK = 'true';
process.env.PROMPT_URL = process.env.PROMPT_URL || 'http://example.local/prompt';

const origErr = console.error;
console.error = (...args) => {
  origErr('ERR_CAPTURE:', ...args);
};

globalThis.fetch = async (...args) => {
  console.log('MOCK_FETCH_CALLED with', args && args[0]);
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
