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
    } catch (e) {
      void e;
    }

    try {
      if (process.env.DEBUG_TESTS) {
        try {
          console.warn(new Error('socket-created-at').stack);
        } catch (e) {
          void e;
        }
      }
    } catch (e) {
      void e;
    }

    sockets.add(sock);
    _sockets.add(sock);

    try {
      if (typeof sock.setKeepAlive === 'function') sock.setKeepAlive(false);
      if (typeof sock.setTimeout === 'function') sock.setTimeout(1000);
      if (typeof sock.unref === 'function') sock.unref();
    } catch (e) {
      void e;
    }

    function _onSocketClose() {
      sockets.delete(sock);
      _sockets.delete(sock);
      try {
        sock.removeListener && sock.removeListener('close', _onSocketClose);
      } catch (e) {
        void e;
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
  } catch (e) {
    void e;
  }

  try {
    if (typeof server.headersTimeout === 'number') server.headersTimeout = 2000;
  } catch (e) {
    void e;
  }

  try {
    if (typeof server.timeout === 'number') server.timeout = 1000;
  } catch (e) {
    void e;
  }

  return new Promise((resolve, reject) => {
    function onListen() {
      const addr = server.address();
      const base = `http://127.0.0.1:${addr.port}`;

      try {
        if (process.env.DEBUG_TESTS) console.warn && console.warn(`test-server listening ${base}`);
      } catch (e) {
        void e;
      }

      try {
        if (typeof server.unref === 'function') server.unref();
      } catch (e) {
        void e;
      }

      const close = async () => {
        try {
          if (process.env.DEBUG_TESTS)
            console.warn &&
              console.warn(
                `test-server close requested ${JSON.stringify(server.address && server.address ? server.address() : 'addr-unknown')}`
              );
        } catch (e) {
          void e;
        }

        server.removeAllListeners('connection');

        try {
          server.removeAllListeners('listening');
        } catch (e) {
          void e;
        }

        try {
          server.removeAllListeners('error');
          server.removeAllListeners('request');
        } catch (e) {
          void e;
        }

        for (const s of Array.from(sockets)) {
          try {
            s.destroy();
          } catch (e) {
            void e;
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
                } catch (e) {
                  void e;
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
              } catch (e) {
                void e;
              }
              setImmediate(() => res());
            }
          }

          function onErrorClose() {
            if (!called) {
              called = true;
              try {
                clearTimeout(timeout);
              } catch (e) {
                void e;
              }
              for (const s of Array.from(sockets)) {
                try {
                  s.destroy();
                } catch (e) {
                  void e;
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
                } catch (e) {
                  void e;
                }
              }
            }
            server.close(_serverCloseCallback);
          } catch {
            for (const s of Array.from(sockets)) {
              try {
                s.destroy();
              } catch (e) {
                void e;
              }
            }
            try {
              clearTimeout(timeout);
            } catch (e) {
              void e;
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
            } catch (e) {
              void e;
            }
          }
        } catch (e) {
          void e;
        }

        await new Promise((r) => setImmediate(r));

        try {
          if (typeof server.unref === 'function') server.unref();
        } catch (e) {
          void e;
        }

        try {
          if (process.env.DEBUG_TESTS)
            console.warn &&
              console.warn(
                `test-server close completed ${JSON.stringify(server.address && server.address ? server.address() : 'addr-unknown')}`
              );
        } catch (e) {
          void e;
        }

        _servers.delete(server);

        try {
          for (const s of Array.from(_sockets)) {
            try {
              s.destroy();
            } catch (e) {
              void e;
            }
          }
          for (const serv of Array.from(_servers)) {
            try {
              serv.removeAllListeners('connection');
              serv.removeAllListeners('listening');
              try {
                serv.close();
              } catch (e) {
                void e;
              }
            } catch (e) {
              void e;
            }
          }
        } catch (e) {
          void e;
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
            } catch (e) {
              void e;
            }
          }
        }
      } catch (e) {
        void e;
      }

      resolve({ base, close });
    }

    function onError(err) {
      reject(err);
    }

    server.once('error', onError);
    try {
      if (typeof server.unref === 'function') server.unref();
    } catch (e) {
      void e;
    }

    try {
      server.listen(0, '127.0.0.1');
      server.once('listening', onListen);
    } catch {
      try {
        server.once('listening', onListen);
      } catch (e) {
        void e;
      }
      try {
        onListen();
      } catch (e) {
        void e;
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
          } catch (e) {
            void e;
          }
        });
      }
    } catch (e) {
      void e;
    }

    try {
      if (typeof server.unref === 'function') server.unref();
    } catch (e) {
      void e;
    }
  });
}

function _forceCloseAllSockets() {
  for (const s of Array.from(_sockets)) {
    try {
      s.destroy();
    } catch (e) {
      void e;
    }
  }
  for (const serv of Array.from(_servers)) {
    try {
      serv.removeAllListeners('connection');
      try {
        serv.close(function _forceCloseCallback() {});
      } catch (e) {
        void e;
      }
    } catch (e) {
      void e;
    }
  }
  _sockets.clear();
  _servers.clear();
}

module.exports = { startTestServer, _forceCloseAllSockets };
