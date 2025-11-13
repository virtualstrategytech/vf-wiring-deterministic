// Early instrumentation for socket/TLS creation stacks.
// This file runs in Jest `setupFiles` to ensure instrumentation happens
// before any modules that may open sockets during require-time.
// Guard: only enable this heavy instrumentation when DEBUG_TESTS is set
// to avoid changing runtime behavior for normal test runs.
try {
  // Only enable this heavy instrumentation when explicitly requested via
  // DEBUG_TESTS and when running under Jest (JEST_WORKER_ID is set) OR when
  // forced via FORCE_DEBUG_INSTRUMENTATION. This prevents the instrumentation
  // from running for unrelated Node processes (npm, npx, etc.) which can
  // break CLI tools that create stdio streams early during startup.
  const debugEnabled = process.env.DEBUG_TESTS === '1' || process.env.DEBUG_TESTS === 'true';
  const runningUnderJest = typeof process.env.JEST_WORKER_ID !== 'undefined';
  const forced =
    process.env.FORCE_DEBUG_INSTRUMENTATION === '1' ||
    process.env.FORCE_DEBUG_INSTRUMENTATION === 'true';
  const enabled = Boolean(debugEnabled && (runningUnderJest || forced));

  // Helper to check that stdio handles are present and implement setBlocking.
  const stdioReady = () => {
    try {
      const outHandle = process && process.stdout && process.stdout._handle;
      const errHandle = process && process.stderr && process.stderr._handle;
      const outHas = !!(outHandle && typeof outHandle.setBlocking === 'function');
      const errHas = !!(errHandle && typeof errHandle.setBlocking === 'function');
      // conservatively require both stdout and stderr to be ready; if one is
      // missing, WriteStream behavior can still be unstable on some platforms
      // (notably WSL/CI). If either is not ready, consider stdio not ready.
      return outHas && errHas;
    } catch {
      return false;
    }
  };

  try {
    if (enabled) {
      // If stdio isn't fully ready (missing setBlocking on stdout/stderr),
      // skip the heavy instrumentation to avoid WriteStream/setBlocking
      // TypeErrors that have been observed in some environments (WSL,
      // early CLI processes, etc.). A marker and reason are set so the
      // rest of the file can early-exit cleanly.
      if (!stdioReady()) {
        process.env.__JEST_INSTRUMENTATION_SKIPPED = '1';
        process.env.__JEST_INSTRUMENTATION_SKIPPED_REASON =
          'stdio_not_ready_or_missing_setBlocking';
      } else {
        // instrumentation will run; write a marker file so CI artifacts can
        // indicate it was enabled. Do not fail on any error here.
        try {
          const fs = require('fs');
          try {
            fs.writeFileSync('/tmp/jest_instrumentation_enabled', '1');
          } catch {
            try {
              fs.writeFileSync('./artifacts/jest_instrumentation_enabled', '1');
            } catch {}
          }
        } catch {}
      }
    }
  } catch {}

  if (!enabled) {
    // Exit early: do not perform instrumentation when DEBUG_TESTS is not enabled
    // for Jest specifically. Set a flag so we can skip the heavy
    // instrumentation below without using a top-level `return` (which is a
    // syntax error in CommonJS modules).
    process.env.__JEST_INSTRUMENTATION_SKIPPED = '1';
  }
} catch {}

// Test-only: best-effort patch to make AsyncResource a no-op wrapper early
// so modules that create AsyncResources during parsing (raw-body) don't
// leave persistent native handles that show up as "bound-anonymous-fn"
// in Jest's detectOpenHandles. We apply this patch very early in the
// instrumentation file so it runs before modules are required during Jest
// worker startup. It is gated by TEST_PATCH_RAW_BODY or DEBUG_TESTS.
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
  } catch {}
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

// If instrumentation was skipped above, short-circuit the rest of the file
// by wrapping it in a guard. This avoids top-level `return` usage which
// causes Jest parse errors.
if (process.env.__JEST_INSTRUMENTATION_SKIPPED === '1') {
  // instrumentation disabled; noop
} else {
  // Early async_hooks tracer: populate global.__async_handle_map as soon as
  // the instrumentation file is required. This helps capture handle init
  // events that occur during module load/require-time which may otherwise
  // be missed if async_hooks is installed later in setupFiles.
  try {
    if (process.env.DEBUG_TESTS === '1' || process.env.DEBUG_TESTS === 'true') {
      try {
        const async_hooks = require('async_hooks');
        const handleMap = new Map();
        global.__async_handle_map = handleMap;
        const hook = async_hooks.createHook({
          init(id, type) {
            try {
              const t = String(type).toLowerCase();
              if (t === 'promise') return;
              // conservative filter unless verbose
              const verbose = !!process.env.DEBUG_TESTS;
              if (!verbose) {
                if (
                  !(
                    t.includes('tcp') ||
                    t.includes('tcpwrap') ||
                    t === 'timeout' ||
                    t.includes('pipe') ||
                    t.includes('timer') ||
                    t.includes('tty') ||
                    t.includes('signal') ||
                    t.includes('tls')
                  )
                ) {
                  return;
                }
              }
              const s = new Error('handle-init').stack;
              handleMap.set(id, { type, stack: s });
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
    }
  } catch {}
  const http = require('http');
  const https = require('https');
  const net = require('net');
  const tls = require('tls');
  const http2 = require('http2');

  // Defensive: ensure global agents don't keep sockets alive across tests.
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

  // Instrument http2 APIs so ClientHttp2Session and http2.connect get a
  // creation stack attached. Many libraries use http2 under the hood and
  // sessions can create native handles that show up as lingering sockets.
  try {
    if (http2) {
      try {
        const origConnect = http2.connect;
        if (typeof origConnect === 'function') {
          http2.connect = function connectWithStack(...args) {
            const session = origConnect.apply(this, args);
            try {
              if (session && typeof session === 'object' && !session._createdStack) {
                session._createdStack = new Error('http2-connect-created').stack;
              }
            } catch {}
            return session;
          };
        }
      } catch {}

      try {
        const CH = http2.ClientHttp2Session;
        if (CH && CH.prototype && !CH.prototype.__stackPatched) {
          // const origCtor = CH.prototype.connect || function () {};
          // best-effort: attach stack on instances when possible
          const origEmit = CH.prototype.emit;
          CH.prototype.emit = function (ev, ...args) {
            try {
              if (!this._createdStack) {
                try {
                  this._createdStack = new Error('http2-client-session-instance-created').stack;
                } catch {}
              }
            } catch {}
            return origEmit.call(this, ev, ...args);
          };
          CH.prototype.__stackPatched = true;
        }
      } catch {}
    }
  } catch {}

  // Instrument agent socket creation to capture a creation stack on sockets
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

    // Also instrument Agent.prototype
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

    // net.createConnection catch-all
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

  // Instrument net.Socket.prototype.connect
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

  // As an additional catch-all, patch the Socket and TLSSocket constructors
  // themselves so sockets created via `new net.Socket()` or `new tls.TLSSocket()`
  // also receive a creation stack. This helps capture sockets created very
  // early by libraries that bypass Agent APIs.
  try {
    try {
      if (net && typeof net.Socket === 'function' && !net.__SocketCtorPatched) {
        const OrigSocket = net.Socket;
        function SocketWithStack(...args) {
          // construct instance without losing prototype
          // use Reflect.construct when available to preserve built-ins behavior
          let inst;
          try {
            inst = Reflect.construct(OrigSocket, args, SocketWithStack);
          } catch {
            // fallback for older Node versions
            inst = Object.create(OrigSocket.prototype);
            OrigSocket.apply(inst, args);
          }
          try {
            if (inst && typeof inst === 'object' && !inst._createdStack) {
              inst._createdStack = new Error('net-socket-ctor-created').stack;
            }
          } catch {}
          return inst;
        }
        try {
          SocketWithStack.prototype = OrigSocket.prototype;
          // copy static props
          Object.getOwnPropertyNames(OrigSocket).forEach((k) => {
            try {
              if (!(k in SocketWithStack))
                Object.defineProperty(
                  SocketWithStack,
                  k,
                  Object.getOwnPropertyDescriptor(OrigSocket, k)
                );
            } catch {}
          });
          net.Socket = SocketWithStack;
          net.__SocketCtorPatched = true;
        } catch {}
      }
    } catch {}

    try {
      if (tls && typeof tls.TLSSocket === 'function' && !tls.__TLSSocketCtorPatched) {
        const OrigTLSSocket = tls.TLSSocket;
        function TLSSocketWithStack(...args) {
          let inst;
          try {
            inst = Reflect.construct(OrigTLSSocket, args, TLSSocketWithStack);
          } catch {
            inst = Object.create(OrigTLSSocket.prototype);
            OrigTLSSocket.apply(inst, args);
          }
          try {
            if (inst && typeof inst === 'object' && !inst._createdStack) {
              inst._createdStack = new Error('tls-tlssocket-ctor-created').stack;
            }
          } catch {}
          return inst;
        }
        try {
          TLSSocketWithStack.prototype = OrigTLSSocket.prototype;
          Object.getOwnPropertyNames(OrigTLSSocket).forEach((k) => {
            try {
              if (!(k in TLSSocketWithStack))
                Object.defineProperty(
                  TLSSocketWithStack,
                  k,
                  Object.getOwnPropertyDescriptor(OrigTLSSocket, k)
                );
            } catch {}
          });
          tls.TLSSocket = TLSSocketWithStack;
          tls.__TLSSocketCtorPatched = true;
        } catch {}
      }
    } catch {}
  } catch {}

  // Instrument tls.connect
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

  // Best-effort: ensure common pooled network resources are closed on process
  // exit. This helps catch cases where Jest or the runner kills the process
  // before our normal afterAll teardown runs. We close undici's global
  // dispatcher and destroy http/https global agents where available.
  try {
    const closeResources = () => {
      try {
        // undici global dispatcher
        const undici = require('undici');
        if (
          undici &&
          undici.globalDispatcher &&
          typeof undici.globalDispatcher.close === 'function'
        ) {
          try {
            undici.globalDispatcher.close();
          } catch {}
        }
      } catch {}
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
    };

    // Hook multiple termination events to be robust in CI.
    process.on('exit', closeResources);
    process.on('beforeExit', closeResources);
    process.on('SIGINT', () => {
      closeResources();
      process.exit(130);
    });
    process.on('SIGTERM', () => {
      closeResources();
      process.exit(143);
    });
  } catch {}

  // When DEBUG_TESTS is enabled, ensure the test process writes async-handle
  // diagnostics into /tmp (or ./artifacts as a fallback) on exit so CI uploads
  // will include them even when Jest fails or the process is terminated.
  try {
    const writeDebugDumps = () => {
      try {
        if (!(process.env.DEBUG_TESTS === '1' || process.env.DEBUG_TESTS === 'true')) return;
        const fs = require('fs');
        // Dump async handle map if present
        try {
          const out = [];
          const m = global.__async_handle_map || new Map();
          for (const [id, info] of m.entries()) {
            try {
              const stack = String((info && info.stack) || '');
              // skip stdio/TTY noise recorded by the instrumentation
              if (
                stack &&
                (stack.includes('createWritableStdioStream') ||
                  stack.includes('getStdout') ||
                  stack.includes('getStderr') ||
                  stack.includes('isInteractive') ||
                  stack.includes('TTY') ||
                  stack.includes('WriteStream'))
              ) {
                continue;
              }
              out.push({
                id,
                type: String(info && info.type),
                stack: stack.split('\n').slice(0, 8).join('\n'),
              });
            } catch {}
          }
          try {
            fs.writeFileSync('/tmp/async_handle_map.json', JSON.stringify(out, null, 2));
          } catch {
            try {
              fs.writeFileSync('./artifacts/async_handle_map.json', JSON.stringify(out, null, 2));
            } catch {}
          }
        } catch {}

        // Dump active handles
        try {
          const fs2 = require('fs');
          const handles = (process._getActiveHandles && process._getActiveHandles()) || [];
          const out = handles
            .map((h, i) => {
              try {
                const name = (h && h.constructor && h.constructor.name) || '<unknown>';
                const info = { idx: i, type: name };
                try {
                  if (h && typeof h._createdStack === 'string')
                    info._createdStack = h._createdStack.split('\n').slice(0, 6).join('\n');
                } catch {}
                try {
                  if (h && h.localAddress) info.localAddress = h.localAddress;
                  if (h && h.localPort) info.localPort = h.localPort;
                  if (h && h.remoteAddress) info.remoteAddress = h.remoteAddress;
                  if (h && h.remotePort) info.remotePort = h.remotePort;
                } catch {}
                return info;
              } catch {
                return { idx: i, type: 'error' };
              }
            })
            .filter((info) => {
              try {
                const cs = info && info._createdStack ? String(info._createdStack) : '';
                if (
                  cs &&
                  (cs.includes('createWritableStdioStream') ||
                    cs.includes('getStdout') ||
                    cs.includes('getStderr') ||
                    cs.includes('isInteractive') ||
                    cs.includes('TTY') ||
                    cs.includes('WriteStream'))
                ) {
                  return false;
                }
              } catch {}
              return true;
            });
          try {
            fs2.writeFileSync('/tmp/active_handles.json', JSON.stringify(out, null, 2));
          } catch {
            try {
              fs2.writeFileSync('./artifacts/active_handles.json', JSON.stringify(out, null, 2));
            } catch {}
          }
        } catch {}
      } catch {}
    };

    process.on('exit', writeDebugDumps);
    process.on('beforeExit', writeDebugDumps);
    process.on('SIGINT', () => {
      try {
        writeDebugDumps();
      } catch {}
    });
    process.on('SIGTERM', () => {
      try {
        writeDebugDumps();
      } catch {}
    });
  } catch {}
}
