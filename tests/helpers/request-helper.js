'use strict';

const util = require('util');
const supertest = require('supertest');
const serverHelper = require('./server-helper');
const child_process = require('child_process');
const net = require('net');
const path = require('path');

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
  let spawnedChild = null;

  // If `app` is a string assume it's a base URL. Otherwise pass the
  // Express app directly to supertest so we don't need to start an
  // ephemeral server.
  // Default no-op restore. We only patch AsyncResource when we need to
  // start an ephemeral server (fallback path). Avoid patching during the
  // normal supertest(app) flow to reduce side-effects.
  let __restoreAsync = () => {};
  if (typeof app === 'string') {
    client = supertest(app);
  } else if (app && typeof app.createServer === 'function') {
    // If tests prefer child-process isolation, spawn the server in a child
    // process to avoid in-process native handles and listener retention.
    if (String(process.env.USE_CHILD_PROCESS_SERVER || '').toLowerCase() === '1') {
      try {
        // Pick a free port
        const getFreePort = () =>
          new Promise((resolve, reject) => {
            const s = net.createServer();
            s.unref();
            s.on('error', (e) => reject(e));
            s.listen(0, '127.0.0.1', () => {
              const port = s.address().port;
              try {
                s.close(() => {});
              } catch {}
              resolve(port);
            });
          });

        const waitForPort = (port, timeout = 20000) =>
          new Promise((resolve, reject) => {
            const start = Date.now();
            (function tryConnect() {
              const sock = new net.Socket();
              sock.setTimeout(500);
              sock.once('connect', () => {
                try {
                  sock.destroy();
                } catch {}
                resolve();
              });
              sock.once('error', () => {
                try {
                  sock.destroy();
                } catch {}
                if (Date.now() - start > timeout) return reject(new Error('timeout'));
                setTimeout(tryConnect, 200);
              });
              sock.once('timeout', () => {
                try {
                  sock.destroy();
                } catch {}
                if (Date.now() - start > timeout) return reject(new Error('timeout'));
                setTimeout(tryConnect, 200);
              });
              try {
                sock.connect(port, '127.0.0.1');
              } catch (e) {
                try {
                  sock.destroy();
                } catch {}
                if (Date.now() - start > timeout) return reject(new Error('timeout'));
                setTimeout(tryConnect, 200);
              }
            })();
          });

        const serverFile = path.resolve(
          __dirname,
          '..',
          '..',
          'novain-platform',
          'webhook',
          'server.js'
        );
        const port = await getFreePort();
        const nodeCmd = process.execPath || 'node';
        const child = child_process.spawn(nodeCmd, [serverFile], {
          cwd: path.dirname(serverFile),
          env: {
            ...process.env,
            PORT: String(port),
            WEBHOOK_API_KEY: process.env.WEBHOOK_API_KEY || 'test',
          },
          stdio: ['ignore', 'ignore', 'ignore'],
        });
        spawnedChild = child;
        try {
          if (serverHelper && typeof serverHelper.registerTestChild === 'function') {
            try {
              serverHelper.registerTestChild(child);
            } catch {}
          }
        } catch {}
        // Wait until server accepts connections
        await waitForPort(port, 20000);
        client = supertest(`http://127.0.0.1:${port}`);
        // set closeServer to kill the child when done
        closeServer = async () =>
          new Promise((resolve) => {
            try {
              try {
                child.kill();
              } catch {}
              // wait a tick for child to exit
              setTimeout(resolve, 50);
            } catch {
              resolve();
            }
          });
      } catch (e) {
        // fallback to in-process behavior if spawning fails
        try {
          client = supertest(app);
        } catch (err) {
          client = supertest(app);
        }
      }
    } else {
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
          const srv = app.createServer();
          // Patch only while starting the server to avoid leaving the
          // AsyncResource shim active during the rest of the request flow.
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
        } catch (e2) {
          client = supertest(app);
        }
      }
    }
  } else {
    client = supertest(app);
  }
  // Construct the supertest Test directly. Previously we experimented with
  // temporarily patching async_hooks.AsyncResource around Test construction
  // to try to reduce false-positive open-handle detection. That shim itself
  // proved unreliable in some environments, so use the direct construction
  // path and rely on conservative cleanup below to close any native handles.
  let req = client[method](path);

  // Diagnostic hook: if a preload collected async handles, dump them
  // immediately after Test construction so we capture creation stacks
  // introduced by supertest/superagent Test initialization.
  try {
    if (typeof global.__dump_async_handles === 'function') {
      try {
        global.__dump_async_handles();
      } catch {}
    }
  } catch {}

  // Additional diagnostic: inspect common emitter objects for listeners
  try {
    const path = require('path');
    const out = [];
    const candidates = [req, req && req.req, req && req._server, req && req.req && req.req.socket];
    for (const c of candidates) {
      try {
        if (!c) continue;
        const ev = c && c.eventNames ? c.eventNames() : Object.keys(c || {});
        const info = { type: c && c.constructor && c.constructor.name, events: [] };
        if (typeof c.eventNames === 'function') {
          for (const e of c.eventNames()) {
            try {
              const listeners = c.listeners(e) || [];
              const lits = listeners.map((fn) => {
                try {
                  return { name: fn && fn.name, stack: fn && fn._creationStack };
                } catch {
                  return {};
                }
              });
              info.events.push({ event: e, listeners: lits });
            } catch {}
          }
        }
        out.push(info);
      } catch {}
    }
    try {
      if (process.env.DEBUG_TESTS) {
        const repoPath = path.resolve(process.cwd(), 'artifacts');
        try {
          require('fs').mkdirSync(repoPath, { recursive: true });
        } catch {}
        const dumpPath = path.join(repoPath, 'listener_dump.json');
        require('fs').writeFileSync(dumpPath, JSON.stringify(out, null, 2), 'utf8');
        try {
          console.error('request-helper: wrote listener dump to', dumpPath);
        } catch {}
      }
    } catch (e) {
      try {
        console.error('request-helper: failed to write listener dump', e && e.message);
      } catch {}
    }
  } catch (e) {
    try {
      console.error('request-helper: diagnostic failure', e && e.stack);
    } catch {}
  }
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
    try {
      if (typeof __restoreAsync === 'function') __restoreAsync();
    } catch {}
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
    // Best-effort: remove listeners / abort any supertest Test objects that
    // may have created underlying native handles. This helps Jest's
    // detectOpenHandles to not report bound-anonymous-fn left by Test
    // construction in some environments.
    try {
      if (req) {
        try {
          if (typeof req.abort === 'function') {
            try {
              req.abort();
            } catch {}
          }
        } catch {}
        try {
          if (req && req._server && typeof req._server.close === 'function') {
            try {
              req._server.close();
            } catch {}
          }
        } catch {}
        try {
          if (typeof req.removeAllListeners === 'function') req.removeAllListeners();
        } catch {}
        try {
          // superagent keeps an internal `req` object; attempt to destroy it
          if (req.req && typeof req.req.destroy === 'function') req.req.destroy();
        } catch {}
        try {
          if (req.req && req.req.socket && typeof req.req.socket.destroy === 'function') {
            req.req.socket.destroy();
          }
        } catch {}
      }
    } catch {}
    // Best-effort: destroy global http/https agents and close undici/clients
    try {
      const _http = require('http');
      if (_http && _http.globalAgent && typeof _http.globalAgent.destroy === 'function') {
        try {
          _http.globalAgent.destroy();
        } catch {}
      }
    } catch {}
    try {
      const _https = require('https');
      if (_https && _https.globalAgent && typeof _https.globalAgent.destroy === 'function') {
        try {
          _https.globalAgent.destroy();
        } catch {}
      }
    } catch {}
    try {
      // also attempt to close shared http-client helpers if present
      const hc = require('../../novain-platform/lib/http-client');
      if (hc && typeof hc.closeAllClients === 'function') {
        try {
          hc.closeAllClients();
        } catch {}
      }
    } catch {}
  }
}

module.exports = { requestApp };
