#!/usr/bin/env node
// Temporary helper to capture the in-process server response shape
process.env.WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY || 'test123';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DEBUG_WEBHOOK = process.env.DEBUG_WEBHOOK || 'false';
process.env.PROMPT_URL = '';
process.env.BUSINESS_URL = '';
process.env.RETRIEVAL_URL = '';

(async () => {
  try {
    // require the app (exports the express `app`)
    const app = require('../novain-platform/webhook/server');
    const { requestApp } = require('../tests/helpers/request-helper');

    const resp = await requestApp(app, {
      method: 'post',
      path: '/webhook',
      body: { action: 'llm_elicit', question: 'Please clarify X?', tenantId: 'default' },
      headers: { 'x-api-key': process.env.WEBHOOK_API_KEY },
      timeout: 10000,
    });

    console.log('DEBUG resp:', JSON.stringify(resp && resp.body ? resp.body : resp));
    process.exit(0);
  } catch (err) {
    console.error('CAPTURE ERROR:', err && err.stack ? err.stack : String(err));
    process.exit(2);
  }
})();
