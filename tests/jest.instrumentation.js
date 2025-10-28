// Early instrumentation for socket/TLS creation stacks.
// This file runs in Jest `setupFiles` to ensure instrumentation happens
// before any modules that may open sockets during require-time.
const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');

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
