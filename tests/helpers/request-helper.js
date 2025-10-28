const serverHelper = require('./server-helper');
const fetch = require('node-fetch');
const http = require('http');
const https = require('https');

async function requestApp(
  app,
  { method = 'post', path = '/', body, headers = {}, timeout = 5000 } = {}
) {
  // If app is a string base URL, use node-fetch directly.
  if (typeof app === 'string') {
    // Defensive: normalize base by stripping any trailing slashes so callers
    // that accidentally include a trailing '/' (or environment values) don't
    // produce URLs with '//' which can lead to 404s like `//health`.
    const base = (app || '').replace(/\/+$/, '');
    const url = `${base}${path}`;
    // provide a clearer error when an invalid/empty base is supplied
    // parse the URL once and reuse the parsed object below (was previously
    // calling `new URL(url)` without storing it, then referencing `u` which
    // caused a ReferenceError).
    let u;
    try {
      u = new URL(url);
    } catch {
      throw new Error(`requestApp: invalid URL constructed from base: ${String(app)}`);
    }
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), timeout || 5000);
    // use a per-request agent (no keepAlive) so node-fetch does not reuse sockets
    const agent =
      u.protocol === 'https:'
        ? new https.Agent({ keepAlive: false })
        : new http.Agent({ keepAlive: false });
    try {
      const resp = await fetch(url, {
        method: method.toUpperCase(),
        // explicitly close connections to avoid keep-alive sockets lingering in CI
        headers: Object.assign(
          { 'Content-Type': 'application/json', Connection: 'close' },
          headers || {}
        ),
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        agent,
      });
      const text = await resp.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
      // ensure any response body streams are destroyed to avoid lingering sockets
      try {
        if (resp && resp.body && typeof resp.body.destroy === 'function') {
          try {
            resp.body.destroy();
          } catch {}
        }
      } catch {}
      return { status: resp.status, headers: resp.headers.raw && resp.headers.raw(), body: parsed };
    } finally {
      clearTimeout(to);
      try {
        // ensure controller is aborted to free any associated request resources
        controller.abort && typeof controller.abort === 'function' && controller.abort();
      } catch {}
      try {
        if (agent && typeof agent.destroy === 'function') agent.destroy();
      } catch {}
    }
  }

  // If app looks like an Express app (function with listen), start a
  // controlled ephemeral server and perform a normal HTTP request. This
  // avoids letting supertest create internal servers which can leave
  // bound anonymous handles detected by Jest.
  if (app && typeof app.listen === 'function') {
    const started = await serverHelper.startTestServer(app);
    // Normalize any trailing slash on the ephemeral server base as well.
    const base = (started.base || '').replace(/\/+$/, '');
    const close = started.close;
    const url = `${base}${path}`;
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), timeout || 5000);
    // per-request agent for ephemeral server requests as well
    const agent = base.startsWith('https://')
      ? new https.Agent({ keepAlive: false })
      : new http.Agent({ keepAlive: false });
    try {
      const resp = await fetch(url, {
        method: method.toUpperCase(),
        // explicitly close connections to avoid keep-alive sockets lingering in CI
        headers: Object.assign(
          { 'Content-Type': 'application/json', Connection: 'close' },
          headers || {}
        ),
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        agent,
      });
      const text = await resp.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
      // ensure any response body streams are destroyed to avoid lingering sockets
      try {
        if (resp && resp.body && typeof resp.body.destroy === 'function') {
          try {
            resp.body.destroy();
          } catch {}
        }
      } catch {}
      return { status: resp.status, headers: resp.headers.raw && resp.headers.raw(), body: parsed };
    } finally {
      clearTimeout(to);
      try {
        await close();
      } catch {}
      try {
        // ensure the fetch controller is aborted to free any associated request resources
        controller.abort && typeof controller.abort === 'function' && controller.abort();
      } catch {}
      try {
        if (agent && typeof agent.destroy === 'function') agent.destroy();
      } catch {}
      try {
        if (serverHelper && typeof serverHelper._forceCloseAllSockets === 'function') {
          // allow a tick for server.close to finish, then aggressively sweep
          await new Promise((r) => setImmediate(r));
          serverHelper._forceCloseAllSockets();
        }
      } catch {}
    }
  }

  // For other inputs, fallback to throwing to surface incorrect usage.
  throw new Error('requestApp expects an Express app or a base URL string');
}

module.exports = { requestApp };
