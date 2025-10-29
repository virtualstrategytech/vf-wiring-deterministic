const http = require('http');

// This runner boots the exported Express `app` from novain-platform/webhook/server
// and sends the chosen ephemeral port back to the parent using IPC (process.send).
// Used only by tests when USE_CHILD_PROCESS_SERVER=1 to isolate server internals.

try {
  // If tests ask the child server to stub external prompt calls, set that up
  // here. Parent tests can set TEST_PROMPT_STUB=1 and TEST_PROMPT_PAYLOAD_JSON
  // in the environment before forking so the child process will install a
  // nock interceptor for PROMPT_URL and return the provided payload. This
  // makes child-process server mode compatible with tests that expect
  // network stubs.
  try {
    if (process.env.TEST_PROMPT_STUB === '1' && process.env.PROMPT_URL) {
      try {
        const nock = require('nock');
        const p = new URL(process.env.PROMPT_URL);
        const origin = `${p.protocol}//${p.host}`;
        let payload = {};
        try {
          payload = JSON.parse(process.env.TEST_PROMPT_PAYLOAD_JSON || '{}');
        } catch {}
        nock(origin).post(/.*/).reply(200, payload).persist();
        // allow localhost connections for any other calls
        try {
          nock.enableNetConnect(/127\.0\.0\.1|::1|localhost/);
        } catch {}
        // force a node-fetch implementation for the child so nock can hook
        // into the http(s) stack reliably (undici/global fetch may not be
        // interceptable by nock in some Node versions).
        try {
          // prefer node-fetch@2
          // eslint-disable-next-line global-require
          globalThis.fetch = require('node-fetch');
          console.info('server-runner: installed node-fetch for child process nock compatibility');
        } catch (e) {}
      } catch (e) {}
    }
  } catch (e) {}

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
