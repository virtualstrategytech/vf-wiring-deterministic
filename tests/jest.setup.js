// Global Jest setup/teardown helpers to reduce open-handle warnings.
// Called after each test file via setupFilesAfterEnv.
const http = require('http');
const https = require('https');

// Attempt to destroy global agents and give Node a chance to clear handles.
afterAll(async () => {
  try {
    if (http && http.globalAgent && typeof http.globalAgent.destroy === 'function') {
      try {
        http.globalAgent.destroy();
      } catch {}
    }
    if (https && https.globalAgent && typeof https.globalAgent.destroy === 'function') {
      try {
        https.globalAgent.destroy();
      } catch {}
    }

    // If there are any modules that track sockets (like tests/helpers/server-helper.js),
    // attempt to call their cleanup method if exposed.
    try {
      const serverHelper = require('./helpers/server-helper');
      if (serverHelper && typeof serverHelper._forceCloseAllSockets === 'function') {
        try {
          serverHelper._forceCloseAllSockets();
        } catch {}
      }
    } catch {
      // ignore, helper may not expose force-close API
    }

    // If we started a per-worker in-process server, attempt to close it.
    try {
      const workerServer = require('./helpers/worker-server');
      if (workerServer && typeof workerServer.close === 'function') {
        try {
          await workerServer.close();
        } catch {}
      } else if (workerServer && typeof workerServer.get === 'function') {
        // defensive: attempt to close underlying server if exposed on get()
        try {
          const s = workerServer.get();
          if (s && s.server && typeof s.server.close === 'function') {
            try {
              s.server.close();
            } catch {}
          }
        } catch {}
      }
    } catch {}

    // yield to the event loop to allow handles to close
    await new Promise((r) => setImmediate(r));

    // tiny additional delay to allow native handles to fully close on CI/Windows
    await new Promise((r) => setTimeout(r, 20));

    // CI diagnostic: if Jest still sees open handles, try to list them and aggressively close
    try {
      if (typeof process._getActiveHandles === 'function') {
        const handles = process._getActiveHandles();
        if (handles && handles.length) {
          // Filter out benign handles (stdout/stderr WriteStreams and some
          // bound anonymous functions) to reduce diagnostic noise in CI.
          // Keep other handles for actionable logs.
          const meaningful = (handles || []).filter((h) => {
            try {
              const name = h && h.constructor && h.constructor.name;
              // drop WriteStream (console/stdout/stderr)
              if (String(name) === 'WriteStream') return false;
              // drop plain Function handles that look like bound anonymous
              // functions (their string representation often contains "bound").
              if (String(name) === 'Function') {
                try {
                  const s = String(h);
                  if (s && s.includes('bound')) return false;
                } catch {}
              }
              return true;
            } catch {
              return true;
            }
          });
          if (!meaningful.length) {
            // nothing actionable to show
            return;
          }
          console.warn(
            'CI diagnostic: active handles after test cleanup (non-WriteStream):',
            meaningful.length
          );
          try {
            meaningful.forEach((h, i) => {
              try {
                const name = h && h.constructor && h.constructor.name;
                console.warn(`  handle[${i}] type=${String(name)}`);
                try {
                  if (h && typeof h._createdStack === 'string') {
                    const lines = h._createdStack
                      .split('\n')
                      .slice(0, 6)
                      .map((l) => l.trim());
                    console.warn(`    created at:`);
                    lines.forEach((ln) => console.warn(`      ${ln}`));
                  }
                } catch {}
                try {
                  if (name === 'Socket' || name === 'TLSSocket') {
                    const info = {
                      localAddress: h.localAddress,
                      localPort: h.localPort,
                      remoteAddress: h.remoteAddress,
                      remotePort: h.remotePort,
                      destroyed: h.destroyed,
                      pending: h.pending,
                    };
                    console.warn(`    socket-info: ${JSON.stringify(info)}`);
                  }
                } catch {}
              } catch {}
            });
          } catch {}

          // Attempt to close/destroy known handle types (sockets, servers)
          for (const h of meaningful) {
            try {
              if (!h) continue;
              if (typeof h.destroy === 'function') {
                try {
                  h.destroy();
                } catch {}
              }
              if (typeof h.close === 'function') {
                try {
                  h.close(() => {});
                } catch {}
              }
            } catch {}
          }

          // Additionally, aggressively clear any sockets held in http/https global agent pools
          try {
            const drainAgent = (agent) => {
              if (!agent) return;
              try {
                // agent.sockets and agent.freeSockets are objects mapping name->array
                const mapIter = (obj) => {
                  if (!obj) return;
                  try {
                    Object.values(obj).forEach((arr) => {
                      if (Array.isArray(arr)) {
                        arr.forEach((s) => {
                          try {
                            if (s && typeof s.destroy === 'function') s.destroy();
                          } catch {}
                        });
                      }
                    });
                  } catch {}
                };
                mapIter(agent.sockets);
                mapIter(agent.freeSockets);
                // If agent has a destroy method, call it again
                if (typeof agent.destroy === 'function') {
                  try {
                    agent.destroy();
                  } catch {}
                }
              } catch {}
            };
            drainAgent(http && http.globalAgent);
            drainAgent(https && https.globalAgent);
          } catch {}

          // give the runtime a short moment to settle after forced cleanup
          await new Promise((r) => setTimeout(r, 20));
        }
      }
    } catch (err) {
      // swallow any diagnostic errors - diagnostics must not fail tests
      try {
        console.warn('handle-dump error', err && err.stack ? err.stack : String(err));
      } catch {}
    }
  } catch {
    // swallow errors to avoid masking test failures
  }
});
