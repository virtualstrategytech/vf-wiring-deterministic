/* eslint-disable @typescript-eslint/no-unused-vars */
// Lightweight server helper for tests: start an Express app on an ephemeral
// port while tracking sockets so we can aggressively destroy them in tests.
const http = require('http');

// Module-level registries
const _servers = new Set();
const _sockets = new Set();

function _attachSocketTracking(server, sockets) {
  function _onConnection(sock) {
    try {
      sock._createdStack = new Error('socket-created-at').stack;
    } catch {
      void 0;
    }

    try {
      if (process.env.DEBUG_TESTS) {
        try {
          console.warn(new Error('socket-created-at').stack);
        } catch {
          void 0;
        }
      }
    } catch {
      void 0;
    }

    sockets.add(sock);
    _sockets.add(sock);

    try {
      if (typeof sock.setKeepAlive === 'function') sock.setKeepAlive(false);
      if (typeof sock.setTimeout === 'function') sock.setTimeout(1000);
      if (typeof sock.unref === 'function') sock.unref();
    } catch {
      void 0;
    }

    function _onSocketClose() {
      sockets.delete(sock);
      _sockets.delete(sock);
      try {
        sock.removeListener && sock.removeListener('close', _onSocketClose);
      } catch (_e) {
        void _e;
      }
    }

    sock.on('close', _onSocketClose);
  }

  server.on('connection', _onConnection);
}

function startTestServer(app) {
  const server = http.createServer(app);
  const sockets = new Set();
  _attachSocketTracking(server, sockets);
  _servers.add(server);

  try {
    if (typeof server.keepAliveTimeout === 'number') server.keepAliveTimeout = 1000;
  } catch (_e) {
    void _e;
  }

  try {
    if (typeof server.headersTimeout === 'number') server.headersTimeout = 2000;
  } catch (_e) {
    void _e;
  }

  try {
    if (typeof server.timeout === 'number') server.timeout = 1000;
  } catch (_e) {
    void _e;
  }

  return new Promise((resolve, reject) => {
    function onListen() {
      const addr = server.address();
      const base = `http://127.0.0.1:${addr.port}`;

      try {
        if (process.env.DEBUG_TESTS) console.warn && console.warn(`test-server listening ${base}`);
      } catch (_e) {
        void _e;
      }

      try {
        if (typeof server.unref === 'function') server.unref();
      } catch (_e) {
        void _e;
      }

      const close = async () => {
        try {
          if (process.env.DEBUG_TESTS)
            console.warn &&
              console.warn(
                `test-server close requested ${JSON.stringify(server.address && server.address ? server.address() : 'addr-unknown')}`
              );
        } catch (_e) {
          void _e;
        }

        server.removeAllListeners('connection');

        try {
          server.removeAllListeners('listening');
        } catch (_e) {
          void _e;
        }

        try {
          server.removeAllListeners('error');
          server.removeAllListeners('request');
        } catch (_e) {
          void _e;
        }

        for (const s of Array.from(sockets)) {
          try {
            s.destroy();
          } catch (_e) {
            void _e;
          }
          sockets.delete(s);
          _sockets.delete(s);
        }

        await new Promise((res) => {
          let called = false;
          const timeout = setTimeout(() => {
            if (!called) {
              for (const s of Array.from(sockets)) {
                try {
                  s.destroy();
                } catch (_e) {
                  void _e;
                }
              }
              called = true;
              res();
            }
          }, 2000);

          function onClose() {
            if (!called) {
              called = true;
              try {
                clearTimeout(timeout);
              } catch (_e) {
                void _e;
              }
              setImmediate(() => res());
            }
          }

          function onErrorClose() {
            if (!called) {
              called = true;
              try {
                clearTimeout(timeout);
              } catch (_e) {
                void _e;
              }
              for (const s of Array.from(sockets)) {
                try {
                  s.destroy();
                } catch (_e) {
                  void _e;
                }
              }
              setImmediate(() => res());
            }
          }

          try {
            server.once('close', onClose);
            server.once('error', onErrorClose);
            function _serverCloseCallback(err) {
              if (err) {
                try {
                  onErrorClose();
                } catch (_e) {
                  void _e;
                }
              }
            }
            server.close(_serverCloseCallback);
          } catch (_e) {
            for (const s of Array.from(sockets)) {
              try {
                s.destroy();
              } catch (_e) {
                void _e;
              }
            }
            try {
              clearTimeout(timeout);
            } catch (_e) {
              void _e;
            }
            res();
          }
        });

        try {
          if (process.env.DEBUG_TESTS) {
            const handles = process._getActiveHandles && process._getActiveHandles();
            try {
              console.warn &&
                console.warn(`test-server post-close activeHandles=${handles && handles.length}`);
            } catch (_e) {
              void _e;
            }
          }
        } catch (_e) {
          void _e;
        }

        await new Promise((r) => setImmediate(r));

        try {
          if (typeof server.unref === 'function') server.unref();
        } catch (_e) {
          void _e;
        }

        try {
          if (process.env.DEBUG_TESTS)
            console.warn &&
              console.warn(
                `test-server close completed ${JSON.stringify(server.address && server.address ? server.address() : 'addr-unknown')}`
              );
        } catch (_e) {
          void _e;
        }

        _servers.delete(server);

        try {
          for (const s of Array.from(_sockets)) {
            try {
              s.destroy();
            } catch (_e) {
              void _e;
            }
          }
          for (const serv of Array.from(_servers)) {
            try {
              serv.removeAllListeners('connection');
              serv.removeAllListeners('listening');
              try {
                serv.close();
              } catch (_e) {
                void _e;
              }
            } catch (_e) {
              void _e;
            }
          }
        } catch (_e) {
          void _e;
        }
      };

      server.removeListener('error', onError);

      try {
        const ls =
          server.listeners && typeof server.listeners === 'function'
            ? server.listeners('listening')
            : [];
        for (const l of ls) {
          if (l !== onListen) {
            try {
              server.removeListener('listening', l);
            } catch (_e) {
              void _e;
            }
          }
        }
      } catch (_e) {
        void _e;
      }

      resolve({ base, close });
    }

    function onError(err) {
      reject(err);
    }

    server.once('error', onError);
    try {
      if (typeof server.unref === 'function') server.unref();
    } catch {
      void 0;
    }

    try {
      server.listen(0, '127.0.0.1');
      server.once('listening', onListen);
    } catch (_e) {
      try {
        server.once('listening', onListen);
      } catch (_e) {
        void _e;
      }
      try {
        onListen();
      } catch (_e) {
        void _e;
      }
    }

    try {
      if (process.env.DEBUG_TESTS) {
        server.once('close', () => {
          try {
            console.warn &&
              console.warn(
                `test-server received close event for ${JSON.stringify(server.address && server.address ? server.address() : 'addr-unknown')}`
              );
          } catch (_e) {
            void _e;
          }
        });
      }
    } catch (_e) {
      void _e;
    }

    try {
      if (typeof server.unref === 'function') server.unref();
    } catch (_e) {
      void _e;
    }
  });
}

function _forceCloseAllSockets() {
  // First, destroy any sockets we have tracked explicitly
  for (const s of Array.from(_sockets)) {
    try {
      s.destroy();
    } catch (_e) {
      void _e;
    }
  }

  // Then attempt to close any tracked servers cleanly (with a short timeout)
  for (const serv of Array.from(_servers)) {
    try {
      serv.removeAllListeners('connection');
      // try to close with a callback and wait a short time so underlying
      // native handles are freed before we proceed to the global sweep
      try {
        const p = new Promise((resolve) => {
          try {
            serv.close(() => resolve());
          } catch (_e) {
            resolve();
          }
          // ensure we don't block indefinitely
          setTimeout(() => resolve(), 1500);
        });
        // don't await here synchronously; let the promise run and continue
        p.catch(() => {});
      } catch (_e) {
        void _e;
      }
    } catch (_e) {
      void _e;
    }
  }

  // Aggressive sweep: inspect Node's active handles and destroy any Socket
  // handles that may not have been tracked (avoid destroying stdio streams).
  try {
    const handles = (process._getActiveHandles && process._getActiveHandles()) || [];
    for (let i = 0; i < handles.length; i++) {
      const h = handles[i];
      try {
        const name = h && h.constructor && h.constructor.name;
        if (String(name) === 'Socket') {
          // skip stdio write streams (common fd 1/2) but destroy others
          try {
            if (h.destroyed) continue;
            // best-effort: avoid touching stdio
            if (h.fd === 1 || h.fd === 2) continue;
          } catch (_e) {
            // if fd isn't available, still attempt to destroy but guarded
          }
          try {
            h.destroy();
          } catch (_e) {
            void _e;
          }
        }
      } catch (_e) {
        void _e;
      }
    }
  } catch (_e) {
    void _e;
  }

  // finally clear our registries
  _sockets.clear();
  _servers.clear();
}

module.exports = { startTestServer, _forceCloseAllSockets };
