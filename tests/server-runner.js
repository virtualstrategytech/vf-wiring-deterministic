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
           
          globalThis.fetch = require('node-fetch');
          console.info('server-runner: installed node-fetch for child process nock compatibility');
        } catch {}
      } catch {}
    }
  } catch {}

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
        try {
          clearInterval(_parentWatcher);
        } catch {}

        // When shutting down, first close the server, then write the
        // child-active handle dump (if requested) and exit. Writing the
        // dump after close reduces the chance the dump shows the server
        // still accepting connections. A small timeout ensures we still
        // produce a dump if close hangs.
        const doExit = (code = 0) => {
          try {
            process.exit(code);
          } catch {}
        };

        const writeChildDump = () => {
          if (process.env.DEBUG_CHILD_DUMP === '1') {
            try {
              const fs = require('fs');
              const path = require('path');
              const artefactsDir = path.resolve(__dirname, '..', 'artifacts');
              try {
                fs.mkdirSync(artefactsDir, { recursive: true });
              } catch {}

              function summarizeHandle(h) {
                try {
                  const ctor =
                    h && h.constructor && h.constructor.name ? h.constructor.name : '<unknown>';
                  const fd = h && (h.fd || (h._handle && h._handle.fd) || null);
                  const destroyed = Boolean(h && h.destroyed);
                  const info = { type: ctor, fd: fd, destroyed };
                  try {
                    info.readable = Boolean(h.readable);
                  } catch {}
                  try {
                    info.writable = Boolean(h.writable);
                  } catch {}
                  try {
                    info.pending = Boolean(h.pending);
                  } catch {}
                  return info;
                } catch (e) {
                  return { type: '<error>', error: String(e) };
                }
              }

              let handles = [];
              try {
                const raw = process._getActiveHandles ? process._getActiveHandles() : [];
                handles = raw.map(summarizeHandle);
              } catch {}

              const out = {
                ts: Date.now(),
                pid: process.pid,
                handles,
              };
              const fn = path.join(artefactsDir, `child_active_handles_${Date.now()}.json`);
              try {
                fs.writeFileSync(fn, JSON.stringify(out, null, 2));
                try {
                  console.info(`server-runner: wrote child_active_handles -> ${fn}`);
                } catch {}
              } catch (e) {}
            } catch {}
          }
        };

        let closed = false;
        const closeTimeout = setTimeout(() => {
          try {
            if (!closed) {
              // Fallback: write dump even if close didn't finish to aid debugging
              try {
                writeChildDump();
              } catch {}
              doExit(0);
            }
          } catch {}
        }, 2000);

        try {
          server.close(() => {
            closed = true;
            try {
              clearTimeout(closeTimeout);
            } catch {}
            try {
              writeChildDump();
            } catch {}
            doExit(0);
          });
        } catch (e) {
          try {
            // If server.close throws synchronously, still attempt dump and exit
            try {
              writeChildDump();
            } catch {}
            doExit(0);
          } catch {}
        }
      } catch {
        try {
          process.exit(0);
        } catch {}
      }
    }
  });

  // Ensure we exit if parent dies (best-effort). Keep a reference so tests
  // can clear it on shutdown and we don't leave interval handles open.
  const _parentWatcher = setInterval(() => {
    try {
      // noop - if parent is gone, forked process will still run; this is best-effort
    } catch {}
  }, 1000);
  try {
    if (typeof _parentWatcher.unref === 'function') _parentWatcher.unref();
  } catch {}
} catch (err) {
  // If the runner fails to start, surface the error to the parent
  try {
    console.error('server-runner failed to start:', err && err.stack ? err.stack : String(err));
  } catch {}
  process.exit(1);
}
