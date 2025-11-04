// Early instrumentation for socket/TLS creation stacks.
// This file runs in Jest `setupFiles` to ensure instrumentation happens
// before any modules that may open sockets during require-time.
// Guard: only enable this heavy instrumentation when DEBUG_TESTS is set
// to avoid changing runtime behavior for normal test runs.
try {
  const enabled = process.env.DEBUG_TESTS === '1' || process.env.DEBUG_TESTS === 'true';
  if (!enabled) {
    // Exit early: do not perform instrumentation when DEBUG_TESTS is not enabled.
    // Set a flag so we can skip the heavy instrumentation below without using
    // a top-level `return` (which is a syntax error in CommonJS modules).
    process.env.__JEST_INSTRUMENTATION_SKIPPED = '1';
  }
} catch {}

// If instrumentation was skipped above, short-circuit the rest of the file
// by wrapping it in a guard. This avoids top-level `return` usage which
// causes Jest parse errors.
if (process.env.__JEST_INSTRUMENTATION_SKIPPED === '1') {
  // instrumentation disabled; noop
} else {
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
            out.push({
              id,
              type: String(info && info.type),
              stack: String(info && info.stack)
                .split('\n')
                .slice(0, 8)
                .join('\n'),
            });
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
          const out = handles.map((h, i) => {
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
