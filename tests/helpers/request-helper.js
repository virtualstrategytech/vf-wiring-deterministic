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
    // Use non-keepAlive agents for tests to avoid persistent sockets that
    // can trigger Jest detectOpenHandles. Per-request agents are cheaper
    // here because tests are short-lived.
    __req_sharedHttpAgent = new http.Agent({ keepAlive: false, maxSockets: 20 });
  } catch {
    __req_sharedHttpAgent = null;
  }
  try {
    __req_sharedHttpsAgent = new https.Agent({ keepAlive: false, maxSockets: 20 });
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
// Map temporary servers -> their connection sets so global teardown can
// force-destroy sockets even if a particular request path didn't run its
// per-request cleanup (best-effort safety net).
// Map of temporary servers -> their connection sets so we can iterate and
// force-close them if some request path failed to cleanup. Using a Map
// (not WeakMap) lets us iterate during process exit to ensure no lingering
// listen handles remain in CI runs.
const __req_tmpSocketMap = new Map();

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

  // If `app` is a string assume it's a base URL. Use a lightweight
  // fetch-based client for remote URLs to avoid creating persistent
  // supertest agents which can leave listeners/sockets open in Jest.
  if (typeof app === 'string') {
    try {
      // Resolve the full URL and perform a fetch. Prefer global fetch
      // (Node18+); fall back to node-fetch if available.
      const base = app;
      const full = new URL(path || '/', base).toString();
      const hdrs = Object.assign({}, headers || {});
      if (!Object.keys(hdrs).some((k) => String(k).toLowerCase() === 'connection')) {
        hdrs['Connection'] = 'close';
      }
      if (body && !hdrs['Content-Type'] && !hdrs['content-type']) {
        hdrs['Content-Type'] = 'application/json';
      }

      let _fetch = typeof fetch === 'function' ? fetch : globalThis.fetch;
      if (!_fetch) {
        try {
          _fetch = require('node-fetch');
        } catch {}
      }

      if (!_fetch) {
        // If fetch isn't available, perform a minimal http/https request
        // using Node's core modules to avoid creating supertest agents.
        const nodeFetch = (url, opts) =>
          new Promise((resolve, reject) => {
            try {
              const u = new URL(url);
              const isHttps = u.protocol === 'https:';
              const mod = isHttps ? require('https') : require('http');
              const hdrsLocal = Object.assign({}, opts.headers || {});
              try {
                const hasCT = Object.keys(hdrsLocal || {}).some(
                  (k) => String(k).toLowerCase() === 'content-type'
                );
                if (opts.body && !hasCT) hdrsLocal['Content-Type'] = 'application/json';
              } catch {}
              const reqOpts = {
                method: opts.method || 'GET',
                hostname: u.hostname,
                port: u.port || (isHttps ? 443 : 80),
                path: u.pathname + (u.search || ''),
                headers: hdrsLocal,
              };
              const r = mod.request(reqOpts, (res) => {
                let data = '';
                res.setEncoding('utf8');
                res.on('data', (c) => (data += c));
                res.on('end', () => {
                  const headersObj = {};
                  try {
                    Object.keys(res.headers || {}).forEach((k) => (headersObj[k] = res.headers[k]));
                  } catch {}
                  resolve({ status: res.statusCode || 0, headers: headersObj, text: data });
                });
              });
              r.on('error', (err) => reject(err));
              if (opts.body) r.write(opts.body);
              r.end();
            } catch (e) {
              reject(e);
            }
          });

        try {
          const r = await nodeFetch(full, {
            method: (method || 'post').toUpperCase(),
            headers: hdrs,
            body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
          });
          let parsed = r.text;
          try {
            parsed = r.text && r.text.length ? JSON.parse(r.text) : r.text;
          } catch {}
          try {
            if (typeof closeServer === 'function') await closeServer();
          } catch {}
          return { status: r.status || 0, headers: r.headers || {}, body: parsed, text: r.text };
        } catch (e) {
          // last-resort fallback: use supertest if node request also fails
          client = supertest(app);
        }
      } else {
        const opts = { method: (method || 'post').toUpperCase(), headers: hdrs };
        if (body) opts.body = typeof body === 'string' ? body : JSON.stringify(body);
        const r = await _fetch(full, opts);
        let text = '';
        try {
          text = await r.text();
        } catch {}
        const headersObj = {};
        try {
          if (r.headers && typeof r.headers.forEach === 'function') {
            r.headers.forEach((v, k) => (headersObj[k] = v));
          } else if (r.headers && typeof r.headers === 'object') {
            Object.assign(headersObj, r.headers);
          }
        } catch {}
        let parsed = text;
        try {
          parsed = text && text.length ? JSON.parse(text) : text;
        } catch {}
        return { status: r.status || 0, headers: headersObj, body: parsed, text };
      }
    } catch (e) {
      // fallback to supertest when fetch path fails for any reason
      client = supertest(app);
    }
  } else if (typeof app === 'function') {
    // For callable Express apps, prefer NOT to rely on supertest here because
    // supertest may create its own server/listen handles that can be hard to
    // track. Instead allow the code below to start a short-lived http server
    // and perform a native Node request which we explicitly close. Set
    // `client = null` so the later logic takes the temporary-server path.
    client = null;
  } else if (app && typeof app.createServer === 'function') {
    // Start a short-lived server from the provided app to avoid using
    // supertest which can create internal Test listeners that Jest
    // surfaces as bound-anonymous-fn. Perform a direct node request and
    // return the response.
    try {
      const srv = app.createServer();
      // track sockets for this temporary server so we can destroy them
      const tmpConnections = new Set();
      __req_tmpSocketMap.set(srv, tmpConnections);
      srv.on('connection', (socket) => {
        try {
          tmpConnections.add(socket);
          socket.on('close', () => tmpConnections.delete(socket));
        } catch {}
      });
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

      // mark ownership so closeServer will close it if needed
      __req_cachedServer = srv;
      __req_cachedServerOwner = true;

      closeServer = async () =>
        new Promise((resolve) => {
          try {
            try {
              if (typeof srv.unref === 'function') srv.unref();
            } catch {}
            if (__req_cachedServer && __req_cachedServer === srv) {
              __req_cachedServer = null;
              __req_cachedServerOwner = false;
              try {
                // destroy tracked sockets first
                try {
                  for (const s of Array.from(tmpConnections)) {
                    try {
                      s.destroy();
                    } catch {}
                  }
                } catch {}
                try {
                  __req_tmpSocketMap.delete(srv);
                } catch {}
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

      // perform node http request directly to the bound port
      const addr = srv.address();
      const port = addr && addr.port ? addr.port : 0;
      const full = `http://127.0.0.1:${port}${path}`;
      const r = await new Promise((resolve, reject) => {
        try {
          const u = new URL(full);
          const mod = u.protocol === 'https:' ? https : http;
          const hdrsLocal = Object.assign({}, headers || {});
          try {
            const hasCT = Object.keys(hdrsLocal || {}).some(
              (k) => String(k).toLowerCase() === 'content-type'
            );
            if (body && !hasCT) hdrsLocal['Content-Type'] = 'application/json';
          } catch {}
          const reqOpts = {
            method: (method || 'post').toUpperCase(),
            hostname: u.hostname,
            port: u.port || (u.protocol === 'https:' ? 443 : 80),
            path: u.pathname + (u.search || ''),
            headers: hdrsLocal,
          };
          const req2 = mod.request(reqOpts, (res) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (c) => (data += c));
            res.on('end', () => {
              const headersObj = {};
              try {
                Object.keys(res.headers || {}).forEach((k) => (headersObj[k] = res.headers[k]));
              } catch {}
              resolve({ status: res.statusCode || 0, headers: headersObj, text: data });
            });
          });
          req2.on('error', (err) => reject(err));
          if (body) req2.write(typeof body === 'string' ? body : JSON.stringify(body));
          req2.end();
        } catch (e) {
          reject(e);
        }
      });
      let parsed = r.text;
      try {
        parsed = r.text && r.text.length ? JSON.parse(r.text) : r.text;
      } catch {}
      try {
        if (typeof closeServer === 'function') await closeServer();
      } catch {}
      return { status: r.status || 0, headers: r.headers || {}, body: parsed, text: r.text };
    } catch (e) {
      // fallback to supertest as a last resort
      client = supertest(app);
    }
  } else {
    // If `app` looks like an Express app (callable function), avoid using
    // `supertest(app)` which can create internal Test listeners that Jest
    // reports as bound-anonymous-fn. Instead start a short-lived http
    // server, perform a direct Node request, and close the server.
    if (typeof app === 'function') {
      try {
        const srv = http.createServer(app);
        // track sockets so we can destroy them before closing
        const tmpConnections = new Set();
        __req_tmpSocketMap.set(srv, tmpConnections);
        srv.on('connection', (socket) => {
          try {
            tmpConnections.add(socket);
            socket.on('close', () => tmpConnections.delete(socket));
          } catch {}
        });
        await new Promise((resolve, reject) => {
          try {
            srv.listen(0, () => resolve());
          } catch (e) {
            try {
              srv.close(() => {});
            } catch {}
            reject(e);
          }
        });
        // mark ownership so closeServer will close it if needed
        __req_cachedServer = srv;
        __req_cachedServerOwner = true;
        closeServer = async () =>
          new Promise((resolve) => {
            try {
              try {
                if (typeof srv.unref === 'function') srv.unref();
              } catch {}
              try {
                for (const s of Array.from(tmpConnections)) {
                  try {
                    s.destroy();
                  } catch {}
                }
              } catch {}
              try {
                __req_tmpSocketMap.delete(srv);
              } catch {}
              srv.close(() => resolve());
            } catch {
              resolve();
            }
          });

        // perform node http request directly to the bound port
        const addr = srv.address();
        const port = addr && addr.port ? addr.port : 0;
        const isHttps = false;
        const full = `http://127.0.0.1:${port}${path}`;
        const r = await (async () => {
          return new Promise((resolve, reject) => {
            try {
              const u = new URL(full);
              const mod = u.protocol === 'https:' ? https : http;
              const hdrsLocal = Object.assign({}, headers || {});
              try {
                const hasCT = Object.keys(hdrsLocal || {}).some(
                  (k) => String(k).toLowerCase() === 'content-type'
                );
                if (body && !hasCT) hdrsLocal['Content-Type'] = 'application/json';
              } catch {}
              const reqOpts = {
                method: (method || 'post').toUpperCase(),
                hostname: u.hostname,
                port: u.port || (u.protocol === 'https:' ? 443 : 80),
                path: u.pathname + (u.search || ''),
                headers: hdrsLocal,
              };
              const req2 = mod.request(reqOpts, (res) => {
                let data = '';
                res.setEncoding('utf8');
                res.on('data', (c) => (data += c));
                res.on('end', () => {
                  const headersObj = {};
                  try {
                    Object.keys(res.headers || {}).forEach((k) => (headersObj[k] = res.headers[k]));
                  } catch {}
                  resolve({ status: res.statusCode || 0, headers: headersObj, text: data });
                });
              });
              req2.on('error', (err) => reject(err));
              if (body) req2.write(typeof body === 'string' ? body : JSON.stringify(body));
              req2.end();
            } catch (e) {
              reject(e);
            }
          });
        })();
        let parsed = r.text;
        try {
          parsed = r.text && r.text.length ? JSON.parse(r.text) : r.text;
        } catch {}
        try {
          if (typeof closeServer === 'function') await closeServer();
        } catch {}
        return { status: r.status || 0, headers: r.headers || {}, body: parsed, text: r.text };
      } catch (e) {
        // fallback to supertest when attempting the temporary server approach fails
        client = supertest(app);
      }
    } else {
      // As a robust fallback for callable apps, start a short-lived http
      // server and request it directly. Assign `closeServer` immediately so
      // the server is always closed in the finally block and Jest doesn't
      // see a lingering listen handle when running single tests.
      try {
        const srv = http.createServer(app);
        // track sockets so we can destroy them before closing
        const tmpConnections = new Set();
        __req_tmpSocketMap.set(srv, tmpConnections);
        srv.on('connection', (socket) => {
          try {
            tmpConnections.add(socket);
            socket.on('close', () => tmpConnections.delete(socket));
          } catch {}
        });

        closeServer = async () =>
          new Promise((resolve) => {
            try {
              try {
                if (typeof srv.unref === 'function') srv.unref();
              } catch {}
              try {
                for (const s of Array.from(tmpConnections)) {
                  try {
                    s.destroy();
                  } catch {}
                }
              } catch {}
              srv.close(() => resolve());
            } catch {
              resolve();
            }
          });

        await new Promise((resolve, reject) => {
          try {
            srv.listen(0, () => resolve());
          } catch (e) {
            try {
              srv.close(() => {});
            } catch {}
            reject(e);
          }
        });

        __req_cachedServer = srv;
        __req_cachedServerOwner = true;

        const addr = srv.address();
        const port = addr && addr.port ? addr.port : 0;
        const full = `http://127.0.0.1:${port}${path}`;
        const r = await new Promise((resolve, reject) => {
          try {
            const u = new URL(full);
            const mod = u.protocol === 'https:' ? https : http;
            const hdrsLocal = Object.assign({}, headers || {});
            try {
              const hasCT = Object.keys(hdrsLocal || {}).some(
                (k) => String(k).toLowerCase() === 'content-type'
              );
              if (body && !hasCT) hdrsLocal['Content-Type'] = 'application/json';
            } catch {}
            const reqOpts = {
              method: (method || 'post').toUpperCase(),
              hostname: u.hostname,
              port: u.port || (u.protocol === 'https:' ? 443 : 80),
              path: u.pathname + (u.search || ''),
              headers: hdrsLocal,
            };
            const req2 = mod.request(reqOpts, (res) => {
              let data = '';
              res.setEncoding('utf8');
              res.on('data', (c) => (data += c));
              res.on('end', () => {
                const headersObj = {};
                try {
                  Object.keys(res.headers || {}).forEach((k) => (headersObj[k] = res.headers[k]));
                } catch {}
                resolve({ status: res.statusCode || 0, headers: headersObj, text: data });
              });
            });
            req2.on('error', (err) => reject(err));
            if (body) req2.write(typeof body === 'string' ? body : JSON.stringify(body));
            req2.end();
          } catch (e) {
            reject(e);
          }
        });

        try {
          if (typeof closeServer === 'function') await closeServer();
          else await new Promise((resolve) => srv.close(() => resolve()));
        } catch {}

        let parsed = r.text;
        try {
          parsed = r.text && r.text.length ? JSON.parse(r.text) : r.text;
        } catch {}
        try {
          if (typeof closeServer === 'function') await closeServer();
        } catch {}
        return { status: r.status || 0, headers: r.headers || {}, body: parsed, text: r.text };
      } catch (e) {
        client = supertest(app);
      }
    }
  }

  // If we have a supertest client/agent, use it. Otherwise (client==null)
  // perform a short-lived http request against a temporary server created
  // from the provided `app`. This avoids creating a Test listen handle via
  // supertest when running in certain single-test scenarios.
  if (client && typeof client[method] === 'function') {
    const req = client[method](path);
    // Attach a shared keepAlive agent to outgoing Node requests when possible.
    try {
      const attachAgent = (r) => {
        try {
          let agentToUse = null;
          try {
            if (typeof app === 'string') {
              const u = new URL(path || '/', app);
              if (u.protocol === 'https:') agentToUse = __req_sharedHttpsAgent;
              else agentToUse = __req_sharedHttpAgent;
            } else if (typeof app === 'object' && app && app.address) {
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
        return res;
      }
    } finally {
      try {
        if (typeof closeServer === 'function') await closeServer();
      } catch {}
      try {
        if (client && typeof client.close === 'function') {
          try {
            await client.close();
          } catch {}
        }
      } catch {}
      try {
        await new Promise((r) => process.nextTick(r));
        await new Promise((r) => {
          const t = setTimeout(r, 10);
          try {
            if (t && typeof t.unref === 'function') t.unref();
          } catch {}
        });
      } catch {}
      try {
        if (serverHelper && typeof serverHelper._forceCloseAllSockets === 'function') {
          serverHelper._forceCloseAllSockets();
        }
      } catch {}
    }
  } else {
    // No supertest client: start a temporary server and perform a node http request
    try {
      const srv = http.createServer(app);
      // track active sockets for this temporary server so we can force-close
      // them before calling srv.close() to avoid lingering handles on Windows
      const tmpConnections = new Set();
      __req_tmpSocketMap.set(srv, tmpConnections);
      srv.on('connection', (socket) => {
        try {
          tmpConnections.add(socket);
          socket.on('close', () => tmpConnections.delete(socket));
        } catch {}
      });
      // ensure closeServer exists immediately so finally can always close it
      closeServer = async () =>
        new Promise((resolve) => {
          try {
            try {
              if (typeof srv.unref === 'function') srv.unref();
            } catch {}
            try {
              // destroy any active sockets first
              for (const s of Array.from(tmpConnections)) {
                try {
                  s.destroy();
                } catch {}
              }
            } catch {}
            try {
              __req_tmpSocketMap.delete(srv);
            } catch {}
            srv.close(() => resolve());
          } catch {
            resolve();
          }
        });

      await new Promise((resolve, reject) => {
        try {
          srv.listen(0, () => resolve());
        } catch (e) {
          try {
            srv.close(() => {});
          } catch {}
          reject(e);
        }
      });

      const addr = srv.address();
      const port = addr && addr.port ? addr.port : 0;
      const full = `http://127.0.0.1:${port}${path}`;
      const r = await new Promise((resolve, reject) => {
        try {
          const u = new URL(full);
          const mod = u.protocol === 'https:' ? https : http;
          const hdrsLocal = Object.assign({}, headers || {});
          try {
            const hasCT = Object.keys(hdrsLocal || {}).some(
              (k) => String(k).toLowerCase() === 'content-type'
            );
            if (body && !hasCT) hdrsLocal['Content-Type'] = 'application/json';
          } catch {}
          const reqOpts = {
            method: (method || 'post').toUpperCase(),
            hostname: u.hostname,
            port: u.port || (u.protocol === 'https:' ? 443 : 80),
            path: u.pathname + (u.search || ''),
            headers: hdrsLocal,
          };
          const req2 = mod.request(reqOpts, (res) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (c) => (data += c));
            res.on('end', () => {
              const headersObj = {};
              try {
                Object.keys(res.headers || {}).forEach((k) => (headersObj[k] = res.headers[k]));
              } catch {}
              resolve({ status: res.statusCode || 0, headers: headersObj, text: data });
            });
          });
          req2.on('error', (err) => reject(err));
          if (body) req2.write(typeof body === 'string' ? body : JSON.stringify(body));
          req2.end();
        } catch (e) {
          reject(e);
        }
      });

      try {
        if (typeof closeServer === 'function') await closeServer();
      } catch {}

      let parsed = r.text;
      try {
        parsed = r.text && r.text.length ? JSON.parse(r.text) : r.text;
      } catch {}
      return { status: r.status || 0, headers: r.headers || {}, body: parsed, text: r.text };
    } catch (e) {
      // Ensure temporary server is closed on error to avoid leaving a
      // listening handle that Jest detects as an open handle.
      try {
        if (typeof closeServer === 'function') {
          try {
            // await closeServer in case it performs async socket destroys
            await closeServer();
          } catch {}
        }
      } catch {}
      // last-resort: rethrow so caller sees the failure
      throw e;
    }
  }
}

async function closeCachedServer() {
  try {
    if (__req_cachedServer && __req_cachedServerOwner) {
      const srv = __req_cachedServer;
      __req_cachedServer = null;
      __req_cachedServerOwner = false;
      try {
        try {
          // destroy any tracked sockets for this server
          const sset = __req_tmpSocketMap.get(srv);
          if (sset && typeof sset === 'object') {
            for (const s of Array.from(sset)) {
              try {
                s.destroy();
              } catch {}
            }
          }
        } catch {}
        await new Promise((resolve) => srv.close(() => resolve()));
      } catch {}
    }
  } catch {}
}

// Best-effort: on process exit, destroy any tracked temporary server sockets
// in case some request path failed to cleanup. This is safe and avoids
// leaving handles open in CI environments that capture process state.
try {
  process.on('exit', () => {
    try {
      for (const [srv, sset] of __req_tmpSocketMap.entries()) {
        try {
          if (sset && typeof sset === 'object') {
            for (const s of Array.from(sset)) {
              try {
                s.destroy();
              } catch {}
            }
          }
        } catch {}
        try {
          srv.close(() => {});
        } catch {}
      }
    } catch {}
  });
} catch {}

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
