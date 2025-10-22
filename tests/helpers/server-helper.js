const http = require('http');

// Start an Express `app` on an ephemeral port and return a small helper for
// making requests and closing the server safely. This centralizes socket
// tracking and cleanup to avoid Jest open-handle warnings.
function startTestServer(app) {
  const server = http.createServer(app);
  const sockets = new Set();
  server.on('connection', (s) => {
    sockets.add(s);
    // Allow the test process to exit without waiting for these sockets
    // to be referenced; we'll still explicitly destroy them in `close()`.
    try {
      if (typeof s.unref === 'function') s.unref();
    } catch {}
    s.on('close', () => sockets.delete(s));
  });
  // Reduce keep-alive time to avoid sockets lingering after server.close
  if (typeof server.keepAliveTimeout === 'number') {
    try {
      server.keepAliveTimeout = 1000; // 1s
    } catch {}
  }

  return new Promise((resolve, reject) => {
    server.listen(0, () => {
      const addr = server.address();
      const base = `http://127.0.0.1:${addr.port}`;
      try {
        if (typeof server.unref === 'function') server.unref();
      } catch {}
      const close = async () => {
        // Destroy sockets first, remove listeners, then close server.
        for (const s of sockets) {
          try {
            s.destroy();
          } catch {
            /* ignore */
          }
        }
        server.removeAllListeners('connection');
        // Attempt to close the server; if it doesn't close within 2s, force destroy any remaining sockets
        await new Promise((resolve) => {
          let called = false;
          const to = setTimeout(() => {
            if (!called) {
              // force destroy remaining sockets and resolve
              for (const s of sockets) {
                try {
                  s.destroy();
                } catch {}
              }
              called = true;
              resolve();
            }
          }, 2000);
          server.close(() => {
            if (!called) {
              called = true;
              try {
                clearTimeout(to);
              } catch {}
              resolve();
            }
          });
        });
      };
      resolve({ base, close });
    });
    server.on('error', reject);
  });
}

module.exports = { startTestServer };
