const http = require('http');

// Module-level tracking of servers and sockets so we can force-close them
// from tests or global setup if needed.
const _servers = new Set();
const _sockets = new Set();

function _attachSocketTracking(server, sockets) {
  function _onConnection(s) {
    // attach a creation stack trace to the socket for CI diagnostics
    try {
      const stack = new Error('socket-created-at').stack;
      s._createdStack = stack;
    } catch {}
    sockets.add(s);
    _sockets.add(s);
    try {
      if (typeof s.setKeepAlive === 'function') s.setKeepAlive(false);
      if (typeof s.setTimeout === 'function') s.setTimeout(1000);
      if (typeof s.unref === 'function') s.unref();
    } catch {}

    function _onSocketClose() {
      sockets.delete(s);
      _sockets.delete(s);
      try {
        s.removeListener && s.removeListener('close', _onSocketClose);
      } catch {}
    }

    s.on('close', _onSocketClose);
  }

  server.on('connection', _onConnection);
}

// Start an Express `app` on an ephemeral port and return a small helper for
// making requests and closing the server safely. This centralizes socket
// tracking and cleanup to avoid Jest open-handle warnings.
function startTestServer(app) {
  const server = http.createServer(app);
  const sockets = new Set();
  _attachSocketTracking(server, sockets);
  _servers.add(server);

  // Reduce keep-alive time to avoid sockets lingering after server.close
  if (typeof server.keepAliveTimeout === 'number') {
    try {
      server.keepAliveTimeout = 1000; // 1s
    } catch {}
  }
  // Reduce other timeouts that may keep handles alive
  try {
    if (typeof server.headersTimeout === 'number') server.headersTimeout = 2000;
  } catch {}
  try {
    if (typeof server.timeout === 'number') server.timeout = 1000;
  } catch {}

  return new Promise((resolve, reject) => {
    function onListen() {
      const addr = server.address();
      const base = `http://127.0.0.1:${addr.port}`;
      try {
        if (process.env.DEBUG_TESTS) console.warn && console.warn(`test-server listening ${base}`);
      } catch {}
      try {
        if (typeof server.unref === 'function') server.unref();
      } catch {}

      const close = async () => {
        try {
          if (process.env.DEBUG_TESTS)
            console.warn &&
              console.warn(
                `test-server close requested ${server.address && server.address() ? JSON.stringify(server.address()) : 'addr-unknown'}`
              );
        } catch {}

        // Remove connection listener first to avoid new sockets being tracked
        server.removeAllListeners('connection');
        // Also remove any 'listening' listeners that may have been attached
        // (some Node internals can leave bound anonymous functions). Removing
        // them proactively reduces Jest's "bound-anonymous-fn" open-handle
        // reports when the server is closed.
        try {
          server.removeAllListeners('listening');
        } catch {}

        // Also remove any other listeners that might keep references
        server.removeAllListeners('listening');
        server.removeAllListeners('error');
        server.removeAllListeners('request');

        // Destroy sockets synchronously
        for (const s of Array.from(sockets)) {
          try {
            s.destroy();
          } catch {}
          sockets.delete(s);
          _sockets.delete(s);
        }

        // Wait for server.close to fire; if it doesn't within timeout, forcefully remove sockets
        await new Promise((res) => {
          let called = false;
          const timeout = setTimeout(() => {
            if (!called) {
              for (const s of Array.from(sockets)) {
                try {
                  s.destroy();
                } catch {}
              }
              called = true;
              res();
            }
          }, 2000);

          function onClose() {
            if (!called) {
              called = true;
              try {
                clearTimeout(timeout);
              } catch {}
              // allow a tick for listeners to detach
              setImmediate(() => res());
            }
          }

          function onErrorClose() {
            if (!called) {
              called = true;
              try {
                clearTimeout(timeout);
              } catch {}
              // ensure sockets destroyed
              for (const s of Array.from(sockets)) {
                try {
                  s.destroy();
                } catch {}
              }
              setImmediate(() => res());
            }
          }

          try {
            server.once('close', onClose);
            server.once('error', onErrorClose);
            // use a named callback to avoid creating anonymous bound functions
            function _serverCloseCallback(err) {
              if (err) {
                try {
                  onErrorClose();
                } catch {}
              }
            }
            server.close(_serverCloseCallback);
          } catch {
            // If close throws (rare), destroy sockets and resolve immediately
            for (const s of Array.from(sockets)) {
              try {
                s.destroy();
              } catch {}
            }
            try {
              clearTimeout(timeout);
            } catch {}
            res();
          }
        });

        try {
          if (process.env.DEBUG_TESTS) {
            const handles = process._getActiveHandles && process._getActiveHandles();
            try {
              console.warn &&
                console.warn(`test-server post-close activeHandles=${handles && handles.length}`);
            } catch {}
          }
        } catch {}

        // After close completes, give Node a short moment to release native handles
        await new Promise((r) => setImmediate(r));

        try {
          if (typeof server.unref === 'function') server.unref();
        } catch {}

        try {
          if (process.env.DEBUG_TESTS)
            console.warn &&
              console.warn(
                `test-server close completed ${server.address && server.address() ? JSON.stringify(server.address()) : 'addr-unknown'}`
              );
        } catch {}

        // Remove from module-level registry
        _servers.delete(server);

        // Final aggressive sweep: ensure no leftover sockets/servers remain
        try {
          for (const s of Array.from(_sockets)) {
            try {
              s.destroy();
            } catch {}
          }
          for (const serv of Array.from(_servers)) {
            try {
              serv.removeAllListeners('connection');
              serv.removeAllListeners('listening');
              // call close without anonymous callback to avoid bound handles
              try {
                serv.close();
              } catch {}
            } catch {}
          }
        } catch {}
      };

      // remove error listener when server is successfully listening
      server.removeListener('error', onError);
      // prune any other 'listening' listeners that are not the named onListen
      // This helps avoid internal bound/anonymous listeners remaining attached
      // which can show up as Jest 'bound-anonymous-fn' open-handle reports.
      try {
        const ls =
          server.listeners && typeof server.listeners === 'function'
            ? server.listeners('listening')
            : [];
        for (const l of ls) {
          if (l !== onListen) {
            try {
              server.removeListener('listening', l);
            } catch {}
          }
        }
      } catch {}
      resolve({ base, close });
    }

    function onError(err) {
      reject(err);
    }

    server.once('error', onError);
    // Start listening and pass the named `onListen` callback directly to
    // `server.listen(...)`. Some Node versions create an internal bound
    // anonymous function when `listen` is called without a callback; by
    // supplying the named callback we avoid that and reduce Jest's false
    // positive "bound-anonymous-fn" open handle reports.
    try {
      if (typeof server.unref === 'function') server.unref();
    } catch {}
    server.listen(0, '127.0.0.1', onListen);
    // attach a close event logger when debugging
    try {
      if (process.env.DEBUG_TESTS) {
        server.once('close', () => {
          try {
            console.warn &&
              console.warn(
                `test-server received close event for ${server.address && server.address() ? JSON.stringify(server.address()) : 'addr-unknown'}`
              );
          } catch {}
        });
      }
    } catch {}
    // Note: we already called `server.listen(..., onListen)` above. Ensure
    // the server is unref'd so it doesn't keep the Node process alive.
    try {
      if (typeof server.unref === 'function') server.unref();
    } catch {}
  });
}

// Force-close all sockets and servers tracked by this helper. Used by global
// teardown or jest.setup to aggressively clear handles.
function _forceCloseAllSockets() {
  for (const s of Array.from(_sockets)) {
    try {
      s.destroy();
    } catch {}
  }
  for (const serv of Array.from(_servers)) {
    try {
      serv.removeAllListeners('connection');
      // use a named callback instead of an anonymous function so Node doesn't
      // create a bound-anonymous-fn that Jest may report as an open handle.
      try {
        serv.close(function _forceCloseCallback() {});
      } catch {}
    } catch {}
  }
  _sockets.clear();
  _servers.clear();
}

module.exports = { startTestServer, _forceCloseAllSockets };
