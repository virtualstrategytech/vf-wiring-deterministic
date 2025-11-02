// Global Jest setup/teardown helpers to reduce open-handle warnings.
// Called after each test file via setupFilesAfterEnv.
/* eslint-disable @typescript-eslint/no-unused-vars */
const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');

// In CI prefer isolating ephemeral servers in a child process to avoid
// native-handle flakes on GitHub Actions/Ubuntu runners. Force-enable here
// so test helpers that start servers pick up child-mode early.
try {
  if (process.env.GITHUB_ACTIONS === 'true' || process.env.CI === 'true') {
    process.env.USE_CHILD_PROCESS_SERVER = process.env.USE_CHILD_PROCESS_SERVER || '1';
  }
} catch {}

// Test-only: best-effort patch to make AsyncResource a no-op wrapper so
// modules that create AsyncResources during parsing (raw-body) don't leave
// persistent native handles that show up as "bound-anonymous-fn" in
// Jest's detectOpenHandles. We patch only when TEST_PATCH_RAW_BODY=1 or
// DEBUG_TESTS is set so normal runtime isn't modified unexpectedly.
let __origAsyncResource = null;
function __patchAsyncResourceNoop() {
  try {
    const ah = require('async_hooks');
    if (!ah || !ah.AsyncResource) return;
    if (__origAsyncResource) return;
    __origAsyncResource = ah.AsyncResource;
    class NoopAsyncResource {
      constructor(_name) {}
      runInAsyncScope(fn, thisArg, ...args) {
        return fn.call(thisArg, ...args);
      }
    }
    try {
      ah.AsyncResource = NoopAsyncResource;
    } catch {
      __origAsyncResource = null;
    }
  } catch {
    // ignore
  }
}

function __restoreAsyncResource() {
  try {
    const ah = require('async_hooks');
    if (!ah) return;
    if (__origAsyncResource) {
      try {
        ah.AsyncResource = __origAsyncResource;
      } catch {}
      __origAsyncResource = null;
    }
  } catch {}
}

try {
  const shouldPatch = process.env.TEST_PATCH_RAW_BODY === '1' || process.env.DEBUG_TESTS;
  if (shouldPatch) __patchAsyncResourceNoop();
} catch {}

// When running on CI, increase diagnostic verbosity so we capture creation
// stacks for active handles (helps map lingering sockets back to their
// creators). This is temporary and useful for triage; we'll remove or
// gate it when the root causes are fixed.
try {
  if (process.env.GITHUB_ACTIONS === 'true' || process.env.CI === 'true') {
    process.env.DEBUG_TESTS_LEVEL = process.env.DEBUG_TESTS_LEVEL || '3';
  }
} catch {}

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

// Instrument EventEmitter.on/once to attach a creation stack to listeners so
// persistent anonymous listeners can be traced back to their origin during tests.
try {
  const events = require('events');
  const origOn = events.EventEmitter.prototype.on;
  const origOnce = events.EventEmitter.prototype.once;
  if (!events.EventEmitter.prototype.__listenerStackPatched) {
    events.EventEmitter.prototype.on = function (event, listener) {
      try {
        if (typeof listener === 'function' && !listener._creationStack) {
          try {
            listener._creationStack = new Error('listener-created').stack;
          } catch {}
        }
      } catch {}
      return origOn.call(this, event, listener);
    };
    events.EventEmitter.prototype.once = function (event, listener) {
      try {
        if (typeof listener === 'function' && !listener._creationStack) {
          try {
            listener._creationStack = new Error('listener-created').stack;
          } catch {}
        }
      } catch {}
      return origOnce.call(this, event, listener);
    };
    events.EventEmitter.prototype.__listenerStackPatched = true;
  }
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

// Async-hooks tracer: capture creation stacks for native handles (best-effort)
try {
  const async_hooks = require('async_hooks');
  const handleMap = new Map();
  global.__async_handle_map = handleMap;
  const hook = async_hooks.createHook({
    init(id, type, _triggerId, _resource) {
      try {
        // If DEBUG_TESTS is enabled capture all handle types (best-effort)
        // to help root-cause the lingering handle. Otherwise, capture a
        // conservative set to reduce noise.
        const verbose = !!process.env.DEBUG_TESTS;
        if (type && (verbose || type)) {
          try {
            // Optionally filter very noisy types when not debugging
            if (!verbose) {
              const t = String(type).toLowerCase();
              if (
                !(
                  t.includes('tcp') ||
                  t.includes('tcpwrap') ||
                  t === 'timeout' ||
                  t.includes('pipe') ||
                  t.includes('timer')
                )
              ) {
                return;
              }
            }
            handleMap.set(id, { type, stack: new Error('handle-init').stack });
          } catch {}
        }
      } catch {}
    },
    destroy(id) {
      try {
        handleMap.delete(id);
      } catch {}
    },
  });
  hook.enable();
} catch {}

// Test-only: monkeypatch fs.createReadStream (and ReadStream constructor) to
// attach a creation stack to any file streams created during tests. This is
// a diagnostic helper only enabled when DEBUG_TESTS is set so we can map
// ReadStream instances in heap/handle dumps back to their creation site.
try {
  if (process.env.DEBUG_TESTS) {
    try {
      const fs = require('fs');
      if (fs) {
        try {
          const orig = fs.createReadStream;
          if (typeof orig === 'function' && !fs.__createReadStreamPatched) {
            fs.createReadStream = function createReadStreamWithStack(...args) {
              const rs = orig.apply(this, args);
              try {
                if (rs && typeof rs === 'object' && !rs._createdStack) {
                  rs._createdStack = new Error('fs.createReadStream-created').stack;
                }
              } catch {
                void 0;
              }
              return rs;
            };
            fs.__createReadStreamPatched = true;
          }
        } catch {
          void 0;
        }

        // Also try to wrap the ReadStream constructor for modules that call
        // `new fs.ReadStream(...)` directly. Keep this best-effort and
        // non-invasive: preserve prototype and most behavior.
        try {
          const OrigReadStream = fs.ReadStream;
          if (OrigReadStream && !fs.__ReadStreamCtorPatched) {
            function ReadStreamWithStack(path, options) {
              // Use Reflect.construct to call the original constructor
              const inst = Reflect.construct(OrigReadStream, [path, options], ReadStreamWithStack);
              try {
                if (inst && typeof inst === 'object' && !inst._createdStack) {
                  inst._createdStack = new Error('fs.ReadStream-created').stack;
                }
              } catch {
                void 0;
              }
              return inst;
            }
            // preserve prototype chain
            ReadStreamWithStack.prototype = OrigReadStream.prototype;
            try {
              fs.ReadStream = ReadStreamWithStack;
              fs.__ReadStreamCtorPatched = true;
            } catch {
              void 0;
            }
          }
        } catch {
          void 0;
        }
      }
    } catch {
      void 0;
    }
  }
} catch {
  // ignore any failures in the diagnostic monkeypatch
}

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

    // Slightly longer delay to allow native handles and pending callbacks to
    // fully settle on CI/Windows. Increasing this reduces false-positive
    // detectOpenHandles reports for short-lived bound callbacks.
    await new Promise((r) => setTimeout(r, 200));

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

              // Test-only: wrap require('raw-body') to tag the incoming stream with a
              // creation stack when DEBUG_TESTS is set. body-parser/raw-body sometimes
              // create or operate on streams that end up as native handles; tagging the
              // stream helps map heap objects back to code paths.
              try {
                if (process.env.DEBUG_TESTS) {
                  try {
                    const Module = require('module');
                    const origLoad = Module._load;
                    if (typeof origLoad === 'function' && !Module.__rawBodyPatched) {
                      Module._load = function (request, parent, isMain) {
                        // intercept 'raw-body' module load
                        if (request === 'raw-body') {
                          const exported = origLoad.apply(this, arguments);
                          try {
                            // raw-body exports a function (stream, opts, cb) or (stream, opts)
                            if (typeof exported === 'function') {
                              const wrapped = function (stream, opts, cb) {
                                try {
                                  if (
                                    stream &&
                                    typeof stream === 'object' &&
                                    !stream._createdStack
                                  ) {
                                    stream._createdStack = new Error(
                                      'raw-body-stream-invoked'
                                    ).stack;
                                  }
                                } catch {}
                                return exported.apply(this, arguments);
                              };
                              // copy properties
                              Object.keys(exported).forEach((k) => (wrapped[k] = exported[k]));
                              return wrapped;
                            }
                          } catch {}
                          return exported;
                        }
                        return origLoad.apply(this, arguments);
                      };
                      Module.__rawBodyPatched = true;
                    }
                  } catch {}
                }
              } catch {}
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
        // If async_hooks traced native handles, print a compact summary to help map
        // lingering handles back to creation stacks. This is best-effort and gated
        // behind DEBUG_TESTS to avoid noisy logs during normal runs.
        try {
          if (
            process.env.DEBUG_TESTS &&
            global.__async_handle_map &&
            global.__async_handle_map.size
          ) {
            try {
              console.warn('DEBUG_TESTS: async_handle_map entries:');
              for (const [id, info] of global.__async_handle_map.entries()) {
                try {
                  const type = info && info.type ? info.type : '<unknown>';
                  console.warn(`  asyncId=${id} type=${type}`);
                  if (info && info.stack) {
                    (String(info.stack).split('\n').slice(0, 6) || []).forEach((ln) =>
                      console.warn(`    ${String(ln).trim()}`)
                    );
                  }
                } catch {}
              }
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
          await new Promise((r) => setTimeout(r, 200));

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
          await new Promise((r) => setTimeout(r, 200));
        }
      }
    } catch {}
    // If verbose debugging is enabled, also persist the async handle map to
    // a file for offline analysis (helps triage on CI where logs are noisy).
    try {
      if (process.env.DEBUG_TESTS && Number(process.env.DEBUG_TESTS_LEVEL || '0') >= 3) {
        try {
          const fs = require('fs');
          const out = [];
          for (const [id, info] of global.__async_handle_map.entries()) {
            try {
              out.push({
                id,
                type: info && info.type,
                stack: String(info && info.stack).slice(0, 1000),
              });
            } catch {
              void 0;
            }
          }
          try {
            const path = require('path').join(
              process.cwd(),
              'artifacts',
              `async_handles_${Date.now()}.json`
            );
            try {
              fs.mkdirSync(require('path').dirname(path), { recursive: true });
            } catch {}
            fs.writeFileSync(path, JSON.stringify(out, null, 2));
            console.warn('DEBUG_TESTS: wrote async handle map to', path);
          } catch {
            void 0;
          }
        } catch {
          void 0;
        }
      }
    } catch {}
  } catch {
    // swallow errors to avoid masking test failures
  }
});
