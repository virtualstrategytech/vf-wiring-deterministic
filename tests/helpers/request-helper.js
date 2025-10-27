const serverHelper = require('./server-helper');
const fetch = require('node-fetch');

async function requestApp(
  app,
  { method = 'post', path = '/', body, headers = {}, timeout = 5000 } = {}
) {
  // If app is a string base URL, use node-fetch directly.
  if (typeof app === 'string') {
    const url = `${app}${path}`;
    // provide a clearer error when an invalid/empty base is supplied
    try {
      new URL(url);
    } catch {
      throw new Error(`requestApp: invalid URL constructed from base: ${String(app)}`);
    }
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), timeout || 5000);
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
    }
  }

  // If app looks like an Express app (function with listen), start a
  // controlled ephemeral server and perform a normal HTTP request. This
  // avoids letting supertest create internal servers which can leave
  // bound anonymous handles detected by Jest.
  if (app && typeof app.listen === 'function') {
    const started = await serverHelper.startTestServer(app);
    const base = started.base;
    const close = started.close;
    const url = `${base}${path}`;
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), timeout || 5000);
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
    }
  }

  // For other inputs, fallback to throwing to surface incorrect usage.
  throw new Error('requestApp expects an Express app or a base URL string');
}

module.exports = { requestApp };
