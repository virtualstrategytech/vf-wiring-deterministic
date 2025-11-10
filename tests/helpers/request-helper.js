'use strict';

const util = require('util');
const supertest = require('supertest');
const serverHelper = require('./server-helper');

// Lightweight, low-dependency request helper for tests. Uses supertest
// to call an Express app directly (no ephemeral server/network sockets),
// or treats a string as a base URL for remote tests. This avoids creating
// long-lived http.Agent sockets in most in-process test scenarios.
async function requestApp(
  app,
  { method = 'post', path = '/', body, headers = {}, timeout = 5000 } = {}
) {
  let closeServer = null;
  let client;

  // If `app` is a string assume it's a base URL. Otherwise pass the
  // Express app directly to supertest so we don't need to start an
  // ephemeral server.
  if (typeof app === 'string') {
    client = supertest(app);
  } else if (app && typeof app.createServer === 'function') {
    // If the Express app exposes a createServer helper, start an ephemeral
    // http.Server so we can close it cleanly after the request to avoid
    // lingering handles reported by Jest's detectOpenHandles.
    try {
      const srv = app.createServer();
      await new Promise((resolve, reject) => {
        try {
          srv.listen(0, resolve);
        } catch (e) {
          try {
            srv.close(() => {});
          } catch {}
          reject(e);
        }
      });
      closeServer = async () =>
        new Promise((resolve) => {
          try {
            try {
              if (typeof srv.unref === 'function') srv.unref();
            } catch {}
            srv.close(() => resolve());
          } catch {
            resolve();
          }
        });
      client = supertest(srv);
    } catch (e) {
      // fallback to passing the app directly
      client = supertest(app);
    }
  } else {
    client = supertest(app);
  }

  const req = client[method](path);
  if (headers) {
    for (const [k, v] of Object.entries(headers)) req.set(k, v);
  }
  // Prefer explicit Connection: close for remote requests to avoid lingering
  // keep-alive sockets that can show up as open handles in Jest.
  try {
    const hasConnection = Object.keys(headers || {}).some(
      (k) => String(k).toLowerCase() === 'connection'
    );
    if (!hasConnection) req.set('Connection', 'close');
  } catch {}
  if (body) req.send(body);
  if (timeout) req.timeout({ deadline: timeout });

  try {
    const res = await req;
    // Normalize response for tests: supertest sometimes leaves `res.body` as
    // an empty object for plain-text responses; prefer `res.text` when body
    // is empty so callers that expect string results (eg: /health) receive
    // the textual payload.
    try {
      const out = {
        status: res.status || res.statusCode || 0,
        headers: res.headers || res.header || {},
        body: res.body,
        text: typeof res.text === 'string' ? res.text : undefined,
      };
      if (
        out &&
        out.body &&
        typeof out.body === 'object' &&
        Object.keys(out.body || {}).length === 0 &&
        typeof out.text === 'string'
      ) {
        out.body = out.text;
      }
      return out;
    } catch (e) {
      // fallback: return the raw supertest response if normalization fails
      return res;
    }
  } finally {
    // close any server we started
    try {
      if (typeof closeServer === 'function') await closeServer();
    } catch {}
    // Small pause to allow native handles to settle after server close.
    try {
      await new Promise((r) => process.nextTick(r));
      await new Promise((r) => {
        const t = setTimeout(r, 10);
        try {
          if (t && typeof t.unref === 'function') t.unref();
        } catch {}
      });
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
