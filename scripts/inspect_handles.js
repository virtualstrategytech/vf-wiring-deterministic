const http = require('http');
const fetch = (...args) => import('node-fetch').then((m) => m.default(...args));
const app = require('../novain-platform/webhook/server');

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/webhook`;
  console.log('server started', port);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'x-api-key': 'test123', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'llm_elicit', question: 'X', tenantId: 't' }),
    });
    console.log('request status', resp.status);
    const text = await resp.text();
    console.log('resp text', text);
  } catch (e) {
    console.error('request error', e);
  }
  try {
    server.close();
  } catch (e) {}
  await sleep(200);
  const handles = process
    ._getActiveHandles()
    .map((h) => ({ type: h && h.constructor && h.constructor.name, inspect: String(h) }));
  console.log('active handles:', handles);
  // keep process short
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
