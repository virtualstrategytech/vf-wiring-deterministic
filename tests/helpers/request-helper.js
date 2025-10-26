const serverHelper = require('./server-helper');
const fetch = require('node-fetch');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

async function requestApp(
  app,
  { method = 'post', path: pathParam = '/', body, headers = {}, timeout = 5000 } = {}
) {
  try {
    // shared_server_base.txt is written to the repository `tests/` directory by globalSetup.
    let candidate = path.resolve(__dirname, '..', 'shared_server_base.txt');
    if (!fs.existsSync(candidate)) {
      // fallback to same-dir (rare)
      const alt = path.resolve(__dirname, 'shared_server_base.txt');
      if (fs.existsSync(alt)) candidate = alt;
    }
    if (candidate && fs.existsSync(candidate)) {
      const base = fs.readFileSync(candidate, 'utf8').trim();
      // Only override the provided `app` if the caller did not pass an
      // Express app object. Prefer an in-process worker server when an
      // Express `app` is supplied.
      if (base && !(app && typeof app.listen === 'function')) app = base; // override app param to use shared base URL
    }
  } catch {}

  // If app is a string base URL, use node-fetch directly.
  if (typeof app === 'string') {
    const url = `${app}${pathParam}`;
    // provide a clearer error when an invalid/empty base is supplied
    try {
      new URL(url);
    } catch {
      throw new Error(`requestApp: invalid URL constructed from base: ${String(app)}`);
    }
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), timeout || 5000);
    let agent;
    try {
      // Provide a non-keepAlive agent to prevent client-side sockets from
      // sticking around in CI and showing up as open handles.
      agent = url.startsWith('https:')
        ? new https.Agent({ keepAlive: false })
        : new http.Agent({ keepAlive: false });
      if (process.env.DEBUG_TESTS) {
        try {
          console.warn &&
            console.warn(`[requestApp] fetch ${url} headers=${JSON.stringify(headers || {})}`);
        } catch {}
      }
      const resp = await fetch(url, {
        method: method.toUpperCase(),
        // explicitly close connections to avoid keep-alive sockets lingering in CI
        headers: Object.assign(
          { 'Content-Type': 'application/json', Connection: 'close' },
          headers || {}
        ),
        body: body ? JSON.stringify(body) : undefined,
        // explicitly supply an agent that does not keep sockets alive
        agent,
        signal: controller.signal,
      });
      const text = await resp.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
      return { status: resp.status, headers: resp.headers.raw && resp.headers.raw(), body: parsed };
    } finally {
      clearTimeout(to);
      try {
        agent && typeof agent.destroy === 'function' && agent.destroy();
      } catch {}
    }
  }

  // If app looks like an Express app (function with listen), start a
  // controlled ephemeral server and perform a normal HTTP request. This
  // avoids letting supertest create internal servers which can leave
  // bound anonymous handles detected by Jest.
  if (app && typeof app.listen === 'function') {
    // Prefer a per-worker in-process server to avoid repeated listen/close
    // churn. If present, the worker-server will start the app and return
    // a base URL to use for requests. Fall back to existing shared/pid
    // heuristics if the worker-server cannot be started.
    try {
      const workerServer = require('./worker-server');
      try {
        const started = await workerServer.start(app);
        if (started && started.base) app = started.base;
      } catch {}
    } catch {}
    // If a shared server was started via globalSetup, prefer using it as
    // a fallback when a worker-server isn't used.
    try {
      const pidFile = path.resolve(__dirname, '..', 'webhook.pid');
      if (fs.existsSync(pidFile)) {
        const port = Number(process.env.PORT || 3000);
        const sharedBase = `http://127.0.0.1:${port}`;
        // Use the shared server only if we do not already have an app/base set.
        // If a per-worker server was started above (app becomes a string base),
        // prefer that rather than overriding with the shared base.
        if (!app) app = sharedBase;
      }
    } catch {}

    // If `app` was switched to a base string (shared server), fall through
    // to the string handling path below; otherwise, start an ephemeral server.
    if (typeof app === 'string') {
      const url = `${app}${pathParam}`;
      const controller = new AbortController();
      const to = setTimeout(() => controller.abort(), timeout || 5000);
      let agent;
      try {
        agent = url.startsWith('https:')
          ? new https.Agent({ keepAlive: false })
          : new http.Agent({ keepAlive: false });
        if (process.env.DEBUG_TESTS) {
          try {
            console.warn &&
              console.warn(`[requestApp] fetch ${url} headers=${JSON.stringify(headers || {})}`);
          } catch {}
        }
        const resp = await fetch(url, {
          method: method.toUpperCase(),
          headers: Object.assign(
            { 'Content-Type': 'application/json', Connection: 'close' },
            headers || {}
          ),
          body: body ? JSON.stringify(body) : undefined,
          agent,
          signal: controller.signal,
        });
        const text = await resp.text();
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
        return {
          status: resp.status,
          headers: resp.headers.raw && resp.headers.raw(),
          body: parsed,
        };
      } finally {
        clearTimeout(to);
        try {
          agent && typeof agent.destroy === 'function' && agent.destroy();
        } catch {}
      }
    }

    // otherwise, fall back to starting an ephemeral test server
    const started = await serverHelper.startTestServer(app);
    const base = started.base;
    const close = started.close;
    const url = `${base}${pathParam}`;
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), timeout || 5000);
    let agent;
    try {
      // Provide a non-keepAlive agent to prevent client-side sockets from
      // sticking around in CI and showing up as open handles.
      agent = url.startsWith('https:')
        ? new https.Agent({ keepAlive: false })
        : new http.Agent({ keepAlive: false });
      if (process.env.DEBUG_TESTS) {
        try {
          console.warn &&
            console.warn(`[requestApp] fetch ${url} headers=${JSON.stringify(headers || {})}`);
        } catch {}
      }
      const resp = await fetch(url, {
        method: method.toUpperCase(),
        // explicitly close connections to avoid keep-alive sockets lingering in CI
        headers: Object.assign(
          { 'Content-Type': 'application/json', Connection: 'close' },
          headers || {}
        ),
        body: body ? JSON.stringify(body) : undefined,
        // explicitly supply an agent that does not keep sockets alive
        agent,
        signal: controller.signal,
      });
      const text = await resp.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
      return { status: resp.status, headers: resp.headers.raw && resp.headers.raw(), body: parsed };
    } finally {
      clearTimeout(to);
      try {
        await close();
      } catch {}
      try {
        if (serverHelper && typeof serverHelper._forceCloseAllSockets === 'function') {
          // allow a tick for server.close to finish, then aggressively sweep
          await new Promise((r) => setImmediate(r));
          serverHelper._forceCloseAllSockets();
        }
      } catch {}
      try {
        agent && typeof agent.destroy === 'function' && agent.destroy();
      } catch {}
    }
  }

  // For other inputs, fallback to throwing to surface incorrect usage.
  throw new Error('requestApp expects an Express app or a base URL string');
}

module.exports = { requestApp };
