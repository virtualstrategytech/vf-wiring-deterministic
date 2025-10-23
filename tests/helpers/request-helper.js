const supertest = require('supertest');
const serverHelper = require('./server-helper');

async function requestApp(
  app,
  { method = 'post', path = '/', body, headers = {}, timeout = 5000 } = {}
) {
  let client;

  // If `app` is a string, treat it as a base URL.
  // If `app` looks like an Express app (has .listen), prefer using
  // `supertest(app)` (in-process) to avoid creating a real TCP listener
  // which can lead to Jest open-handle diagnostics. Only start a real
  // server when the caller provides a string base URL.
  let closeServerFn = null;
  if (typeof app === 'string') {
    client = supertest(app);
  } else if (app && typeof app.listen === 'function') {
    // Use in-process supertest to avoid ephemeral TCP servers in tests.
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
    // nothing to close for in-process supertest(app)
  }
}

module.exports = { requestApp };
