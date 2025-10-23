const supertest = require('supertest');
const serverHelper = require('./server-helper');

async function requestApp(
  app,
  { method = 'post', path = '/', body, headers = {}, timeout = 5000 } = {}
) {
  let client;

  // If `app` is a string, treat it as a base URL.
  // If `app` looks like an Express app (has .listen), start an ephemeral
  // real HTTP server via server-helper.startTestServer so we get explicit
  // close control and avoid jest open-handle warnings that sometimes
  // originate from supertest internal bindings.
  let closeServerFn = null;
  if (typeof app === 'string') {
    client = supertest(app);
  } else if (app && typeof app.listen === 'function') {
    // startTestServer returns { base, close }
    const started = await serverHelper.startTestServer(app);
    client = supertest(started.base);
    closeServerFn = started.close;
  } else {
    client = supertest(app);
  }

  const req = client[method](path);
  if (headers) {
    for (const [k, v] of Object.entries(headers)) req.set(k, v);
  }
  if (body) req.send(body);
  if (timeout) req.timeout({ deadline: timeout });

  try {
    const res = await req;
    return res;
  } finally {
    try {
      if (typeof closeServerFn === 'function') await closeServerFn();
    } catch {}
    try {
      if (serverHelper && typeof serverHelper._forceCloseAllSockets === 'function') {
        serverHelper._forceCloseAllSockets();
      }
    } catch {}
  }
}

module.exports = { requestApp };
