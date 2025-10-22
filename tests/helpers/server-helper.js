const http = require('http');

// Start an Express `app` on an ephemeral port and return a small helper for
// making requests and closing the server safely. This centralizes socket
// tracking and cleanup to avoid Jest open-handle warnings.
function startTestServer(app) {
  const server = http.createServer(app);
  const sockets = new Set();
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });

  return new Promise((resolve, reject) => {
    server.listen(0, () => {
      const addr = server.address();
      const base = `http://127.0.0.1:${addr.port}`;
      const close = async () => {
        // Destroy sockets first, remove listeners, then close server.
        for (const s of sockets) {
          try {
            s.destroy();
          } catch (e) {
            /* ignore */
          }
        }
        server.removeAllListeners('connection');
        await new Promise((r) => server.close(r));
      };
      resolve({ base, close });
    });
    server.on('error', reject);
  });
}

module.exports = { startTestServer };
