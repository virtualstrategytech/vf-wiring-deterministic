// Thin per-worker delegating server. Consumers call `start(app)` and get
// back { base, server } (server may be null because the delegated helper
// doesn't expose the raw server). `close()` will stop the delegated server.

const serverHelper = require('./server-helper');
const net = require('net');

let _started = false;
let _base = null;
let _delegateClose = null;

async function _isPortOpen(base) {
  try {
    if (!base) return false;
    const u = new URL(base);
    const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
    const host = u.hostname || '127.0.0.1';
    return await new Promise((resolve) => {
      const s = net.connect({ host, port }, () => {
        try {
          s.destroy();
        } catch {}
        resolve(true);
      });
      s.on('error', () => {
        try {
          s.destroy();
        } catch {}
        resolve(false);
      });
      // safety timeout
      setTimeout(() => {
        try {
          s.destroy();
        } catch {}
        resolve(false);
      }, 200);
    });
  } catch {
    return false;
  }
}

async function start(app) {
  // If we've previously started a server, verify the port is still open.
  // If it's closed (for example tests forced sockets closed), cleanup and
  // start a fresh instance. This avoids returning a stale base that will
  // produce ECONNREFUSED in subsequent requests.
  if (_started && _base) {
    try {
      const ok = await _isPortOpen(_base);
      if (ok) return { base: _base, server: null };
      // otherwise cleanup and start anew
      try {
        await close();
      } catch {}
    } catch {
      try {
        await close();
      } catch {}
    }
  }
  if (!app || typeof app.listen !== 'function') {
    throw new Error('worker-server.start requires an Express `app`');
  }

  const res = await serverHelper.startTestServer(app);
  _base = res && res.base ? res.base : null;
  _delegateClose = res && res.close ? res.close : null;
  _started = true;
  return { base: _base, server: null };
}

function get() {
  if (!_started) return null;
  return { base: _base, server: null };
}

async function close() {
  if (!_started) return;
  try {
    if (_delegateClose) await _delegateClose();
  } catch {}
  _started = false;
  _base = null;
  _delegateClose = null;
}

module.exports = { start, get, close };
