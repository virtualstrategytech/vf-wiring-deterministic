// Early instrumentation for socket/TLS creation stacks.
// This file runs in Jest `setupFiles` to ensure instrumentation happens
// before any modules that may open sockets during require-time.
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
        const origCtor = CH.prototype.connect || function () {};
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
        } catch (e) {
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
        } catch (e) {
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
