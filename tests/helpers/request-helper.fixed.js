const supertest = require('supertest');
const serverHelper = require('./server-helper');

async function requestApp(
  app,
  { method = 'post', path = '/', body, headers = {}, timeout = 5000 } = {}
) {
  let closeServer = null;
  let client;

  // If `app` is a string assume it's a base URL. Otherwise pass the Express
  // app directly to supertest so we don't need to start an ephemeral server.
  if (typeof app === 'string') {
    client = supertest(app);
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
    // close any server we started
    try {
      if (typeof closeServer === 'function') await closeServer();
    } catch {}
    // fallback: ensure helper-tracked sockets are destroyed
    try {
      if (serverHelper && typeof serverHelper._forceCloseAllSockets === 'function') {
        serverHelper._forceCloseAllSockets();
      }
    } catch {}
  }
}

module.exports = { requestApp };
