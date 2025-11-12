// Global Jest setup/teardown helpers to reduce open-handle warnings.
// Called after each test file via setupFilesAfterEnv.
/* eslint-disable @typescript-eslint/no-unused-vars */
const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');

// Increase EventEmitter listener limit in tests to avoid noisy
// MaxListenersExceededWarning from benign repeated short-lived
// 'connect' listener attachments during test orchestration. This
// is a pragmatic, low-risk diagnostic easing change; we still
// want to investigate and remove any real leaks.
try {
  require('events').EventEmitter.defaultMaxListeners = 20;
} catch {}

// Defensive shim: make console.warn safe during aggressive debug sweeps.
// Some test cleanup paths attempt to write to stdio pipes that may have
// been closed (child-process teardown). Wrapping console.warn here keeps
// the rest of the diagnostic code simple while preventing "write after end"
// exceptions from bubbling up and failing tests.
try {
  const util = require('util');
  const _origConsoleWarn = console.warn;
  console.warn = function safeConsoleWarn(...args) {
    try {
      // If stderr is closed/unwritable, avoid writing diagnostics.
      if (
        process &&
        process.stderr &&
        (process.stderr.destroyed || process.stderr.writable === false)
      )
        return;
    } catch {}

    try {
      // Allow controlled verbosity via DEBUG_TESTS_LEVEL (0 = minimal)
      const lvl = Number(process.env.DEBUG_TESTS_LEVEL || '0');
      if (lvl <= 0) {
        // Shallow-inspect objects to avoid huge dumps and avoid passing
        // unstable resources (sockets/streams) to the real console which
        // may throw when attempting to serialize them.
        const safe = args.map((a) => {
          try {
            if (a && typeof a === 'object') {
              return util.inspect(a, { depth: 1, maxArrayLength: 5, breakLength: 120 });
            }
            return String(a);
          } catch {
            return '[unserializable]';
          }
        });
        try {
          return _origConsoleWarn.apply(console, safe);
        } catch {
          return undefined;
        }
      }

      // Higher verbosity: pass arguments through but still guard against
      // stderr being closed or write errors.
      try {
        return _origConsoleWarn.apply(console, args);
      } catch {
        return undefined;
      }
    } catch {
      // swallow any unexpected errors from diagnostics to avoid failing tests
      return undefined;
    }
  };
} catch {}

// In CI prefer isolating ephemeral servers in a child process to avoid
// native-handle flakes on GitHub Actions/Ubuntu runners. Force-enable here
// so test helpers that start servers pick up child-mode early.
try {
  if (process.env.GITHUB_ACTIONS === 'true' || process.env.CI === 'true') {
    // Force child-process server mode in CI runs: some workflows set
    // USE_CHILD_PROCESS_SERVER=0 which prevents test helpers from using
    // the child-process isolation. Overriding here ensures CI runs use the
    // isolated server mode to avoid native handle flakiness.
    process.env.USE_CHILD_PROCESS_SERVER = '1';
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

// Helper: determine if a captured createdStack indicates stdio/tty
function __isStdIoCreatedStack(cs) {
  try {
    if (!cs || typeof cs !== 'string') return false;
    if (
      cs.includes('createWritableStdioStream') ||
      cs.includes('getStdout') ||
      cs.includes('getStderr') ||
      cs.includes('isInteractive') ||
      cs.includes('TTY') ||
      cs.includes('WriteStream')
    ) {
      return true;
    }
  } catch {}
  return false;
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
            // Unref short-lived client sockets so they don't keep the
            // Node event loop alive during teardown in CI.
            if (sock && typeof sock.unref === 'function') {
              try {
                sock.unref();
              } catch {}
            }
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
              if (sock && typeof sock.unref === 'function') {
                try {
                  sock.unref();
                } catch {}
              }
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
          if (sock && typeof sock.unref === 'function') {
            try {
              sock.unref();
            } catch {}
          }
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
          if (this && typeof this.unref === 'function') {
            try {
              this.unref();
            } catch {}
          }
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
        if (sock && typeof sock === 'object') {
          sock._createdStack = new Error('tls-connect-created').stack;
          if (typeof sock.unref === 'function') {
            try {
              sock.unref();
            } catch {}
          }
        }
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
        // If DEBUG_TESTS is enabled capture more handle types (best-effort)
        // to help root-cause lingering handles. Avoid capturing extremely
        // noisy handle types like PROMISE which flood the map and can be
        // generated by many libraries; they are not actionable for socket
        // leaks and only add noise.
        const verbose = !!process.env.DEBUG_TESTS;
        if (!type) return;
        const t = String(type).toLowerCase();
        // Skip promise handles entirely to avoid excessive noise and
        // re-entrancy caused by creating diagnostic objects inside the hook.
        if (t === 'promise') return;

        // When not in verbose debug mode, only capture a conservative set
        // of handle types that are relevant to networking/IO leaks.
        if (!verbose) {
          if (
            !(
              t.includes('tcp') ||
              t.includes('tcpwrap') ||
              t === 'timeout' ||
              t.includes('pipe') ||
              t.includes('timer') ||
              t.includes('tty') ||
              t.includes('signal')
            )
          ) {
            return;
          }
        }

        // Best-effort: capture a short stack for the handle without doing
        // heavy work that could itself create async resources.
        try {
          const s = new Error('handle-init').stack;
          handleMap.set(id, { type, stack: s });
        } catch {}
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

// Monkeypatch fs.createReadStream (and ReadStream constructor) to attach a
// creation stack to any file streams created during tests. This is a
// best-effort diagnostic helper: it tries to tag ReadStream instances so
// the teardown diagnostics can print a short createdStack-preview and help
// map lingering file handles back to their creator. Keep the implementation
// defensive so it won't throw or change normal runtime behavior if fs or
// constructors are frozen.
try {
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
            try {
              // track created readstreams for best-effort teardown
              if (global && typeof global === 'object') {
                global.__tracked_readstreams = global.__tracked_readstreams || new Set();
                try {
                  global.__tracked_readstreams.add(rs);
                } catch {}
                // remove from set when stream closes
                try {
                  if (rs && typeof rs.on === 'function') {
                    rs.on('close', () => {
                      try {
                        global.__tracked_readstreams.delete(rs);
                      } catch {}
                    });
                  }
                } catch {}
              }
            } catch {}
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
    // ignore if require('fs') fails for some reason
  }
} catch {
  // ignore any failures in the diagnostic monkeypatch
}

// Track timers/immediates/intervals created during tests so we can best-effort
// clear them during afterAll teardown. This is conservative: we only track
// timers created via the global helpers and remove them when cleared.
try {
  if (typeof global === 'object' && !global.__timer_tracker) {
    global.__timer_tracker = {
      timeouts: new Set(),
      intervals: new Set(),
      immediates: new Set(),
      readstreams: global.__tracked_readstreams || new Set(),
    };

    const _st = global.setTimeout;
    const _si = global.setImmediate;
    const _siC = global.clearImmediate;
    const _ct = global.clearTimeout;
    const _ci = global.setInterval;
    const _cii = global.clearInterval;

    try {
      global.setTimeout = function (fn, ms, ...args) {
        const id = _st(fn, ms, ...args);
        try {
          global.__timer_tracker.timeouts.add(id);
        } catch {}
        return id;
      };
    } catch {}

    try {
      global.clearTimeout = function (id) {
        try {
          global.__timer_tracker.timeouts.delete(id);
        } catch {}
        return _ct(id);
      };
    } catch {}

    try {
      global.setInterval = function (fn, ms, ...args) {
        const id = _ci(fn, ms, ...args);
        try {
          global.__timer_tracker.intervals.add(id);
        } catch {}
        return id;
      };
    } catch {}

    try {
      global.clearInterval = function (id) {
        try {
          global.__timer_tracker.intervals.delete(id);
        } catch {}
        return _cii(id);
      };
    } catch {}

    try {
      global.setImmediate = function (fn, ...args) {
        const id = _si(fn, ...args);
        try {
          global.__timer_tracker.immediates.add(id);
        } catch {}
        return id;
      };
    } catch {}

    try {
      global.clearImmediate = function (id) {
        try {
          global.__timer_tracker.immediates.delete(id);
        } catch {}
        return _siC(id);
      };
    } catch {}
  }
} catch {}

// Attempt to destroy global agents and give Node a chance to clear handles.
afterAll(async () => {
  try {
    // Best-effort: clear timers/immediates/intervals and destroy tracked readstreams
    try {
      const tt = global && global.__timer_tracker;
      if (tt) {
        try {
          for (const id of Array.from(tt.timeouts || [])) {
            try {
              clearTimeout(id);
            } catch {}
          }
        } catch {}
        try {
          for (const id of Array.from(tt.intervals || [])) {
            try {
              clearInterval(id);
            } catch {}
          }
        } catch {}
        try {
          for (const id of Array.from(tt.immediates || [])) {
            try {
              clearImmediate(id);
            } catch {}
          }
        } catch {}
        try {
          // destroy any tracked readstreams
          for (const rs of Array.from(tt.readstreams || [])) {
            try {
              if (rs && typeof rs.destroy === 'function' && !rs.destroyed) rs.destroy();
            } catch {}
          }
        } catch {}
      }
    } catch {}
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
    await new Promise((r) => process.nextTick(r));

    // Slightly longer delay to allow native handles and pending callbacks to
    // fully settle on CI/Windows. Increasing this reduces false-positive
    // detectOpenHandles reports for short-lived bound callbacks. Use an
    // unref'd timer so the delay itself won't keep the event loop alive.
    await new Promise((r) => {
      const t = setTimeout(r, 200);
      try {
        if (t && typeof t.unref === 'function') t.unref();
      } catch {}
    });

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
                // Skip handles that instrumentation tagged as stdio/TTY
                // to avoid noisy but benign entries in CI/debug logs.
                try {
                  const cs = h && typeof h._createdStack === 'string' ? h._createdStack : '';
                  if (cs && __isStdIoCreatedStack(cs)) return;
                } catch {}
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
                  // Skip stdio/TTY handles that were tagged by the instrumentation
                  // to reduce noise in the detailed dump.
                  try {
                    const cs = h && typeof h._createdStack === 'string' ? h._createdStack : '';
                    if (cs && __isStdIoCreatedStack(cs)) return;
                  } catch {}
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
                    try {
                      const lines = String(info.stack).split('\n').slice(0, 6) || [];
                      lines.forEach((ln) => {
                        try {
                          console.warn('    ' + String(ln).trim());
                        } catch {}
                      });
                    } catch {}
                  }
                } catch {}
              }

              // Extra diagnostic: when a deeper debug level is requested, persist a
              // focused dump of any handles that look like anonymous functions or
              // AsyncResource-like constructs (these are the typical 'bound-anonymous-fn'
              // reports from Jest). This file is intended for short-lived triage only
              // and is gated behind DEBUG_TESTS_LEVEL>=4.
              try {
                const deep = Number(process.env.DEBUG_TESTS_LEVEL || '0') >= 4;
                if (process.env.DEBUG_TESTS && deep) {
                  try {
                    const handles =
                      (process._getActiveHandles && process._getActiveHandles()) || [];
                    const suspicious = [];
                    for (let i = 0; i < handles.length; i++) {
                      try {
                        const h = handles[i];
                        const ctor = h && h.constructor && h.constructor.name;
                        const created =
                          h && typeof h._createdStack === 'string' ? h._createdStack : '';
                        const stringified = (() => {
                          try {
                            return String(h).slice(0, 800);
                          } catch {
                            return '';
                          }
                        })();

                        // Heuristic: Function objects, anonymous-looking stacks, or
                        // objects whose toString seems to include bound/anonymous text.
                        if (
                          String(ctor) === 'Function' ||
                          /anonymous|bound|<anonymous>/i.test(created) ||
                          /bound anonymous|bound-anonymous/i.test(stringified)
                        ) {
                          suspicious.push({
                            idx: i,
                            type: String(ctor),
                            created: created.slice(0, 1000),
                            repr: stringified,
                          });
                        }
                      } catch {}
                    }

                    if (suspicious.length) {
                      try {
                        const fs = require('fs');
                        const path = require('path');
                        const repoPath = path.join(process.cwd(), 'artifacts');
                        fs.mkdirSync(repoPath, { recursive: true });
                        const diagFile = path.join(
                          repoPath,
                          `async_handle_diagnostic_${Date.now()}.json`
                        );
                        fs.writeFileSync(diagFile, JSON.stringify(suspicious, null, 2));
                        try {
                          console.warn(
                            'DEBUG_TESTS: wrote suspicious-handle diagnostic to',
                            diagFile
                          );
                        } catch {}
                      } catch {}
                    } else {
                      try {
                        console.warn(
                          'DEBUG_TESTS: no suspicious anonymous/function handles detected'
                        );
                      } catch {}
                    }
                  } catch {}
                }
              } catch {}
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
              // drop sockets that are actually stdio fds (fd 0/1/2) which
              // sometimes appear as Socket wrappers but are benign.
              try {
                if (
                  (String(name) === 'Socket' || String(name) === 'TLSSocket') &&
                  h &&
                  h._handle &&
                  typeof h._handle.fd === 'number' &&
                  [0, 1, 2].includes(h._handle.fd)
                ) {
                  return false;
                }
              } catch {}
              // drop ReadStream for stdin (fd 0) which commonly appears on
              // interactive shells and is benign for CI/local diagnostic runs
              try {
                if (String(name) === 'ReadStream' && h && typeof h.fd === 'number' && h.fd === 0) {
                  return false;
                }
              } catch {}
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
                      remoteFamily: h.remoteFamily,
                      localFamily: h.localFamily,
                      connecting: h.connecting,
                      destroyed: h.destroyed,
                      pending: h.pending,
                    };
                    try {
                      // internal handle info (fd) may help map sockets to servers
                      if (h._handle && typeof h._handle === 'object') {
                        info._handle = { fd: h._handle.fd };
                      }
                    } catch {}
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
          await new Promise((r) => {
            const t = setTimeout(r, 200);
            try {
              if (t && typeof t.unref === 'function') t.unref();
            } catch {}
          });

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
            try {
              // Also attempt to clear timer-like handles that may keep the
              // event loop alive (Timeout, Immediate). process._getActiveHandles
              // returns Timeout/Immediate objects in Node and clearTimeout/clearImmediate
              // accept those objects as ids, so call them here as a best-effort
              // cleanup for timers created by libraries that don't use the
              // instrumented global wrappers.
              try {
                if (String(name) === 'Timeout') {
                  try {
                    clearTimeout(h);
                  } catch {}
                }
              } catch {}
              try {
                if (String(name) === 'Immediate') {
                  try {
                    clearImmediate(h);
                  } catch {}
                }
              } catch {}
            } catch {}
          }
          // allow native resources a moment to be released
          await new Promise((r) => {
            const t = setTimeout(r, 200);
            try {
              if (t && typeof t.unref === 'function') t.unref();
            } catch {}
          });
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
            const repoPath = require('path').join(process.cwd(), 'artifacts');
            const path = require('path').join(repoPath, `async_handles_${Date.now()}.json`);
            try {
              fs.mkdirSync(require('path').dirname(path), { recursive: true });
            } catch {}
            fs.writeFileSync(path, JSON.stringify(out, null, 2));
            console.warn('DEBUG_TESTS: wrote async handle map to', path);
            // Also write a copy into /tmp so the workflow's tmp-based upload
            // step will reliably pick it up regardless of where the test
            // process executes or which user the runner uses.
            try {
              const tmpPath = '/tmp/async_handle_map.json';
              fs.writeFileSync(tmpPath, JSON.stringify(out, null, 2));
              console.warn('DEBUG_TESTS: also wrote async handle map to', tmpPath);
            } catch {
              // best-effort: ignore failures on non-Unix runners
            }
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

  // Best-effort: close undici global dispatcher if present. Some Node fetch
  // implementations in Node 18+ use undici; closing the global dispatcher
  // will close pooled HTTP/2 and keep-alive connections that could otherwise
  // remain live across tests.
  try {
    try {
      const undici = require('undici');
      if (undici) {
        try {
          const gd =
            typeof undici.getGlobalDispatcher === 'function' && undici.getGlobalDispatcher();
          if (gd && typeof gd.close === 'function') {
            try {
              gd.close();
            } catch {}
          }
        } catch {}
      }
    } catch {}
  } catch {}
});
