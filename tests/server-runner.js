const http = require('http');

// This runner boots the exported Express `app` from novain-platform/webhook/server
// and sends the chosen ephemeral port back to the parent using IPC (process.send).
// Used only by tests when USE_CHILD_PROCESS_SERVER=1 to isolate server internals.

try {
  const app = require('../novain-platform/webhook/server');
  const server = http.createServer(app);
  server.listen(0, '127.0.0.1', () => {
    const addr = server.address();
    try {
      if (process.send) {
        process.send({ port: addr.port });
      } else {
        // fallback for manual runs where IPC isn't available
        // print a machine-parseable line to stdout
        console.log(`TEST_SERVER_PORT:${addr.port}`);
      }
    } catch {
      // ignore
    }
  });

  process.on('message', (m) => {
    if (m === 'shutdown') {
      try {
        server.close(() => process.exit(0));
      } catch {
        try {
          process.exit(0);
        } catch {}
      }
    }
  });

  // Ensure we exit if parent dies (best-effort)
  setInterval(() => {
    try {
      // noop - if parent is gone, forked process will still run; this is best-effort
    } catch {}
  }, 1000).unref();
} catch (err) {
  // If the runner fails to start, surface the error to the parent
  try {
    console.error('server-runner failed to start:', err && err.stack ? err.stack : String(err));
  } catch {}
  process.exit(1);
}
