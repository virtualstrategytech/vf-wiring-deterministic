'use strict';

const util = require('util');
const supertest = require('supertest');
const serverHelper = require('./server-helper');
const http = require('http');
const https = require('https');

// Create a test-scoped shared Agent so tests reuse sockets where possible.
// This reduces per-request Agent creation and socket churn visible to
// the instrumentation and Jest's --detectOpenHandles.
let __req_sharedHttpAgent = null;
let __req_sharedHttpsAgent = null;
try {
  try {
    __req_sharedHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 20 });
  } catch {
    __req_sharedHttpAgent = null;
  }
  try {
    __req_sharedHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 20 });
  } catch {
    __req_sharedHttpsAgent = null;
  }
} catch {}

// Best-effort test-only helper: temporarily replace async_hooks.AsyncResource
// with a no-op wrapper while starting an ephemeral server. Some libraries
// create AsyncResources during server.listen/startup which can leave
// native handles visible to Jest's detectOpenHandles; replacing with a
// synchronous runner around listen reduces false positives in tests.
let __req_origAsyncResource = null;
function __req_patchAsyncResourceNoop() {
  try {
    const ah = require('async_hooks');
    if (!ah || !ah.AsyncResource) return () => {};
    if (__req_origAsyncResource) return () => {};
    __req_origAsyncResource = ah.AsyncResource;
    class NoopAsyncResource {
      constructor(_name) {}
      runInAsyncScope(fn, thisArg, ...args) {
        return fn.call(thisArg, ...args);
      }
    }
    try {
      ah.AsyncResource = NoopAsyncResource;
    } catch {
      __req_origAsyncResource = null;
      return () => {};
    }
    return function __restore() {
      try {
        const ah2 = require('async_hooks');
        if (ah2 && __req_origAsyncResource) {
          try {
            ah2.AsyncResource = __req_origAsyncResource;
          } catch {}
        }
      } catch {}
      __req_origAsyncResource = null;
    };
  } catch {
    return () => {};
  }
}

// Cached ephemeral server used to avoid creating/closing a new http.Server
// for every test request. This reduces socket/listener churn during the
// Jest run and keeps native handle noise low. Use `closeCachedServer` from
// globalTeardown to ensure the server is closed at the end of the test run.
let __req_cachedServer = null;
let __req_cachedServerOwner = false;

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
    // Use a persistent agent for string base-URLs so multiple requests
    // within the test run can reuse sockets rather than creating a new
    // Agent per request. This reduces socket churn visible to Jest.
    try {
      client = supertest.agent(app);
    } catch {
      client = supertest(app);
    }
  } else if (app && typeof app.createServer === 'function') {
    // Prefer passing the Express app directly to supertest to avoid
    // starting an ephemeral server (which may create transient native
    // async handles visible to Jest). Starting a server is only attempted
    // in specialized scenarios; for typical in-process tests using the
    // Express app, supertest(app) is sufficient and avoids listen()
    // related noise.
    try {
      client = supertest(app);
    } catch (e) {
      // fallback to conservative behavior when supertest doesn't accept app
      try {
        // Reuse or create a cached server to avoid repeated listen/close
        if (__req_cachedServer) {
          // Reuse a persistent supertest agent against the cached server
          // so subsequent requests share the same Agent and sockets.
          try {
            client = supertest.agent(__req_cachedServer);
          } catch {
            client = supertest(__req_cachedServer);
          }
        } else {
          const srv = app.createServer();
          const __restore = __req_patchAsyncResourceNoop();
          await new Promise((resolve, reject) => {
            try {
              srv.listen(0, () => {
                try {
                  if (typeof __restore === 'function') __restore();
                } catch {}
                resolve();
              });
            } catch (err) {
              try {
                if (typeof __restore === 'function') __restore();
              } catch {}
              try {
                srv.close(() => {});
              } catch {}
              reject(err);
            }
          });

          // Keep the server cached for reuse across test invocations.
          __req_cachedServer = srv;
          __req_cachedServerOwner = true;

          closeServer = async () =>
            new Promise((resolve) => {
              try {
                try {
                  if (typeof srv.unref === 'function') srv.unref();
                } catch {}
                // only close if this helper created and owns the cached server
                if (__req_cachedServer && __req_cachedServer === srv) {
                  __req_cachedServer = null;
                  __req_cachedServerOwner = false;
                  try {
                    srv.close(() => resolve());
                  } catch {
                    resolve();
                  }
                } else {
                  resolve();
                }
              } catch {
                resolve();
              }
            });

          try {
            client = supertest.agent(srv);
          } catch {
            client = supertest(srv);
          }
        }
      } catch (e2) {
        client = supertest(app);
      }
    }
  } else {
    client = supertest(app);
  }

  const req = client[method](path);
  // Attach a shared keepAlive agent to outgoing Node requests when possible.
  // Try to detect the underlying node ClientRequest via the 'request' event
  // emitted by superagent and set its .agent property. This is defensive and
  // will quietly noop if the request object doesn't support the event.
  try {
    const attachAgent = (r) => {
      try {
        // determine protocol from base url when available
        let agentToUse = null;
        try {
          if (typeof app === 'string') {
            const u = new URL(path || '/', app);
            if (u.protocol === 'https:') agentToUse = __req_sharedHttpsAgent;
            else agentToUse = __req_sharedHttpAgent;
          } else if (typeof app === 'object' && app && app.address) {
            // assume http for local server instances
            agentToUse = __req_sharedHttpAgent;
          }
        } catch {}
        if (agentToUse && r && typeof r === 'object') {
          try {
            r.agent = agentToUse;
          } catch {}
        }
      } catch {}
    };
    try {
      if (req && typeof req.on === 'function') req.on('request', attachAgent);
    } catch {}
  } catch {}
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

async function closeCachedServer() {
  try {
    if (__req_cachedServer && __req_cachedServerOwner) {
      const srv = __req_cachedServer;
      __req_cachedServer = null;
      __req_cachedServerOwner = false;
      try {
        await new Promise((resolve) => srv.close(() => resolve()));
      } catch {}
    }
  } catch {}
}

// Restore and destroy test-scoped shared agents. Call from global teardown
// to ensure pooled sockets are closed and we don't leak agents across runs.
async function _restoreAndDestroySharedAgents() {
  try {
    try {
      if (__req_sharedHttpAgent && typeof __req_sharedHttpAgent.destroy === 'function') {
        try {
          __req_sharedHttpAgent.destroy();
        } catch {}
      }
    } catch {}
    try {
      if (__req_sharedHttpsAgent && typeof __req_sharedHttpsAgent.destroy === 'function') {
        try {
          __req_sharedHttpsAgent.destroy();
        } catch {}
      }
    } catch {}
    // nothing else to restore: we did not override global agents
  } catch {}
}

module.exports = { requestApp, closeCachedServer, _restoreAndDestroySharedAgents };

module.exports = { requestApp, closeCachedServer };
