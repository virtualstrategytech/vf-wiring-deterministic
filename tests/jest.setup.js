// Global Jest setup/teardown helpers to reduce open-handle warnings.
// Called after each test file via setupFilesAfterEnv.
const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');

// Defensive: ensure global agents don't keep sockets alive across tests.
// Some Node versions may still reuse sockets in the global agent; disabling
// keepAlive reduces the chance of lingering TLSSocket handles that Jest
// reports as open handles in CI.
try {
  if (http && http.globalAgent) {
    try {
      http.globalAgent.keepAlive = false;
    } catch {}
  }
  if (https && https.globalAgent) {
    try {
      https.globalAgent.keepAlive = false;
    } catch {}
  }
} catch {}

// Instrument agent socket creation to capture a creation stack on sockets
// so CI diagnostics can map lingering sockets back to source code.
try {
  const instrument = (agent) => {
    if (!agent) return;
    try {
      const orig = agent.createConnection;
      if (typeof orig === 'function') {
        agent.createConnection = function createConnectionWithStack(options, callback) {
          const sock = orig.call(this, options, callback);
          try {
            sock._createdStack = new Error('agent-socket-created').stack;
          } catch {}
          return sock;
        };
      }
    } catch {}
  };
  try {
    instrument(http && http.globalAgent);
  } catch {}
  try {
    instrument(https && https.globalAgent);
  } catch {}

  // Also instrument Agent.prototype so per-request agents (new http.Agent(...))
  // are also tagged with creation stacks. This ensures our per-request agents
  // used in tests/helpers/request-helper.js get their sockets annotated.
  try {
    const wrapAgentProto = (Agent) => {
      if (!Agent || !Agent.prototype) return;
      try {
        const orig = Agent.prototype.createConnection;
        if (typeof orig === 'function') {
          Agent.prototype.createConnection = function createConnectionProtoWithStack(...args) {
            const sock = orig.apply(this, args);
            try {
              sock._createdStack = new Error('agent-proto-socket-created').stack;
            } catch {}
            return sock;
          };
        }
      } catch {}
    };
    try {
      wrapAgentProto(http && http.Agent);
    } catch {}
    try {
      wrapAgentProto(https && https.Agent);
    } catch {}
  } catch {}

  // Also instrument net.createConnection as a last-resort catch-all for sockets
  try {
    const origNetCreate = net.createConnection;
    if (typeof origNetCreate === 'function') {
      net.createConnection = function createConnectionWithStack(...args) {
        const sock = origNetCreate.apply(net, args);
        try {
          sock._createdStack = new Error('net-createConnection-created').stack;
        } catch {}
        return sock;
      };
    }
  } catch {}
} catch {}

// Instrument net.Socket.prototype.connect so sockets created via lower-level
// calls (or by libraries that call socket.connect directly) get a creation
// stack attached.
try {
  if (net && net.Socket && net.Socket.prototype) {
    const origProtoConnect = net.Socket.prototype.connect;
    if (typeof origProtoConnect === 'function') {
      net.Socket.prototype.connect = function connectProtoWithStack(...args) {
        try {
          this._createdStack = new Error('net-socket-proto-connect').stack;
        } catch {}
        return origProtoConnect.apply(this, args);
      };
    }
  }
} catch {}

// Instrument tls.connect to tag TLSSocket instances created by libraries
// (eg: undici, native tls usage) so we can map them back to source.
try {
  if (tls && typeof tls.connect === 'function') {
    const origTlsConnect = tls.connect;
    tls.connect = function tlsConnectWithStack(...args) {
      const sock = origTlsConnect.apply(tls, args);
      try {
        if (sock && typeof sock === 'object')
          sock._createdStack = new Error('tls-connect-created').stack;
      } catch {}
      return sock;
    };
  }
} catch {}

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

    // yield to the event loop to allow handles to close
    await new Promise((r) => setImmediate(r));

    // tiny additional delay to allow native handles to fully close on CI/Windows
    await new Promise((r) => setTimeout(r, 20));

    // CI diagnostic: if Jest still sees open handles, try to list them and aggressively close
    try {
      if (typeof process._getActiveHandles === 'function') {
        const handles = process._getActiveHandles();
        // Basic debug summary when DEBUG_TESTS is enabled. For noisy details
        // (per-socket creation stacks), require DEBUG_TESTS_LEVEL >= 2 so
        // routine debug runs aren't overwhelmed.
        try {
          if (process.env.DEBUG_TESTS) {
            console.warn('DEBUG_TESTS: raw active handles dump (summary):');
            handles.forEach((h, i) => {
              try {
                const name = h && h.constructor && h.constructor.name;
                console.warn(`  [${i}] type=${String(name)}`);
              } catch {}
            });
          }
        } catch {}
        try {
          const verbose = Number(process.env.DEBUG_TESTS_LEVEL || '0') >= 2;
          if (process.env.DEBUG_TESTS && verbose) {
            try {
              console.warn('DEBUG_TESTS: raw active handles dump (detailed):');
              handles.forEach((h, i) => {
                try {
                  const name = h && h.constructor && h.constructor.name;
                  console.warn(`  [${i}] type=${String(name)}`);
                  if (h && typeof h._createdStack === 'string') {
                    console.warn('    created at:');
                    (h._createdStack.split('\n').slice(0, 6) || []).forEach((ln) =>
                      console.warn(`      ${String(ln).trim()}`)
                    );
                  } else if (String(name) === 'Function') {
                    try {
                      console.warn(`    fn: ${String(h).slice(0, 400)}`);
                    } catch {}
                  }
                } catch {}
              });
            } catch {}
          }
        } catch {}
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

          // Extra safety: explicitly destroy any remaining global agent sockets again
          try {
            if (http && http.globalAgent && typeof http.globalAgent.destroy === 'function') {
              try {
                http.globalAgent.destroy();
              } catch {}
            }
          } catch {}
          try {
            if (https && https.globalAgent && typeof https.globalAgent.destroy === 'function') {
              try {
                https.globalAgent.destroy();
              } catch {}
            }
          } catch {}
        }
      }
    } catch (err) {
      // swallow any diagnostic errors - diagnostics must not fail tests
      try {
        console.warn('handle-dump error', err && err.stack ? err.stack : String(err));
      } catch {}
    }

    // Final aggressive sweep: re-check active handles and forcibly close/destroy sockets if any remain.
    try {
      if (typeof process._getActiveHandles === 'function') {
        const remaining = process._getActiveHandles() || [];
        if (remaining.length) {
          for (const h of remaining) {
            try {
              const name = h && h.constructor && h.constructor.name;
              if (String(name) === 'Socket' || String(name) === 'TLSSocket') {
                try {
                  if (typeof h.end === 'function') {
                    try {
                      h.end();
                    } catch {}
                  }
                  if (typeof h.destroy === 'function') {
                    try {
                      h.destroy();
                    } catch {}
                  }
                  if (h && h._handle && typeof h._handle.close === 'function') {
                    try {
                      h._handle.close();
                    } catch {}
                  }
                } catch {}
              }
            } catch {}
          }
          // allow native resources a moment to be released
          await new Promise((r) => setTimeout(r, 20));
        }
      }
    } catch {}
  } catch {
    // swallow errors to avoid masking test failures
  }
});
