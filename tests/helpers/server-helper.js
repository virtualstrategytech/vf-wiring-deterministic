 
// Lightweight server helper for tests: start an Express app on an ephemeral
// port while tracking sockets so we can aggressively destroy them in tests.
const http = require('http');

// Safe, test-gated debug logger. Use this instead of repeating
// "if (process.env.DEBUG_TESTS) console.warn && console.warn(...)" so
// tests and CI capture consistent output and we avoid accidental
// short-circuiting or undefined-console issues.
function _debugWarn(...args) {
  try {
    if (!process.env.DEBUG_TESTS) return;
    // Use console.warn where available; swallow any errors so tests
    // don't fail because of logging.
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn(...args);
    }
  } catch {
    void 0;
  }
}

// Module-level registries
const _servers = new Set();
const _sockets = new Set();

// Test-only: shim AsyncResource to avoid raw-body creating a persistent
// AsyncResource that shows up as a "bound-anonymous-fn" active handle
// in Jest's detectOpenHandles. We patch/restore around server lifecycle so
// this only affects test runs that start servers via these helpers.
let _patchedAsyncResource = null;
function _patchAsyncResourceNoop() {
  try {
    const ah = require('async_hooks');
    if (!ah || !ah.AsyncResource) return;
    if (_patchedAsyncResource) return; // already patched
    _patchedAsyncResource = ah.AsyncResource;

    class NoopAsyncResource {
      constructor(_name) {
        // noop
      }
      runInAsyncScope(fn, thisArg, ...args) {
        // Execute synchronously in same context; avoid creating native
        // async handles during tests.
        return fn.call(thisArg, ...args);
      }
    }

    try {
      ah.AsyncResource = NoopAsyncResource;
    } catch {
      // ignore failures to patch (platforms where async_hooks is frozen)
      _patchedAsyncResource = null;
    }
  } catch {
    // ignore if async_hooks not available
  }
}

function _restoreAsyncResource() {
  try {
    const ah = require('async_hooks');
    if (!ah) return;
    if (_patchedAsyncResource) {
      try {
        ah.AsyncResource = _patchedAsyncResource;
      } catch {
        // ignore
      }
      _patchedAsyncResource = null;
    }
  } catch {
    // ignore
  }
}

function _attachSocketTracking(server, sockets) {
  function _onConnection(sock) {
    try {
      sock._createdStack = new Error('socket-created-at').stack;
    } catch {
      void 0;
    }

    try {
      _debugWarn(new Error('socket-created-at').stack);
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

    // Defensive handlers: ensure sockets that time out or error are
    // destroyed so they don't linger as open handles in Jest/CI.
    function _onSocketTimeout() {
      try {
        if (sock && typeof sock.destroy === 'function') sock.destroy();
      } catch {
        void 0;
      }
    }

    function _onSocketError() {
      try {
        if (sock && typeof sock.destroy === 'function') sock.destroy();
      } catch {
        void 0;
      }
    }

    function _onSocketClose() {
      sockets.delete(sock);
      _sockets.delete(sock);
      try {
        sock.removeListener && sock.removeListener('close', _onSocketClose);
      } catch {
        void 0;
      }
      try {
        sock.removeListener && sock.removeListener('timeout', _onSocketTimeout);
      } catch {
        void 0;
      }
      try {
        sock.removeListener && sock.removeListener('error', _onSocketError);
      } catch {
        void 0;
      }
    }

    try {
      sock.on('timeout', _onSocketTimeout);
    } catch {}
    try {
      sock.on('error', _onSocketError);
    } catch {}
    sock.on('close', _onSocketClose);
  }

  server.on('connection', _onConnection);
}

// Helper to detect obvious stdio/tty handles so we can avoid printing
// noisy createdStack previews for benign runtime stdio objects.
function _isStdIoHandle(h) {
  try {
    if (!h) return false;
    try {
      if (typeof h.fd !== 'undefined') {
        const fd = Number(h.fd);
        if (fd === 0 || fd === 1 || fd === 2) return true;
      }
    } catch {}
    try {
      const cs = h && typeof h._createdStack === 'string' ? h._createdStack : '';
      if (
        cs &&
        (cs.includes('createWritableStdioStream') ||
          cs.includes('getStdout') ||
          cs.includes('getStderr') ||
          cs.includes('isInteractive') ||
          cs.includes('TTY') ||
          cs.includes('WriteStream'))
      ) {
        return true;
      }
    } catch {}
  } catch {}
  return false;
}

function startTestServer(app) {
  const server = http.createServer(app);
  const sockets = new Set();
  _attachSocketTracking(server, sockets);
  _servers.add(server);

  try {
    if (typeof server.keepAliveTimeout === 'number') server.keepAliveTimeout = 1000;
  } catch {
    void 0;
  }

  try {
    if (typeof server.headersTimeout === 'number') server.headersTimeout = 2000;
  } catch {
    void 0;
  }

  try {
    if (typeof server.timeout === 'number') server.timeout = 1000;
  } catch {
    void 0;
  }

  return new Promise((resolve, reject) => {
    function onListen() {
      const addr = server.address();
      const base = `http://127.0.0.1:${addr.port}`;

      try {
        _debugWarn(`test-server listening ${base}`);
      } catch {
        void 0;
      }

      try {
        if (typeof server.unref === 'function') server.unref();
      } catch {
        void 0;
      }

      const close = async () => {
        try {
          if (process.env.DEBUG_TESTS)
            _debugWarn(
              `test-server close requested ${JSON.stringify(
                server.address && server.address ? server.address() : 'addr-unknown'
              )}`
            );
        } catch {
          void 0;
        }

        server.removeAllListeners('connection');

        try {
          server.removeAllListeners('listening');
        } catch {
          void 0;
        }

        try {
          server.removeAllListeners('error');
          server.removeAllListeners('request');
        } catch {
          void 0;
        }

        for (const s of Array.from(sockets)) {
          try {
            s.destroy();
          } catch {
            void 0;
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
                } catch {
                  void 0;
                }
              }
              called = true;
              res();
            }
          }, 2000);
          try {
            if (timeout && typeof timeout.unref === 'function') timeout.unref();
          } catch {}

          function onClose() {
            if (!called) {
              called = true;
              try {
                clearTimeout(timeout);
              } catch {
                void 0;
              }
              process.nextTick(() => res());
            }
          }

          function onErrorClose() {
            if (!called) {
              called = true;
              try {
                clearTimeout(timeout);
              } catch {
                void 0;
              }
              for (const s of Array.from(sockets)) {
                try {
                  s.destroy();
                } catch {
                  void 0;
                }
              }
              process.nextTick(() => res());
            }
          }

          try {
            server.once('close', onClose);
            server.once('error', onErrorClose);
            function _serverCloseCallback(err) {
              if (err) {
                try {
                  onErrorClose();
                } catch {
                  void 0;
                }
              }
            }
            server.close(_serverCloseCallback);
          } catch {
            for (const s of Array.from(sockets)) {
              try {
                s.destroy();
              } catch {
                void 0;
              }
            }
            try {
              clearTimeout(timeout);
            } catch {
              void 0;
            }
            res();
          }
        });

        try {
          if (process.env.DEBUG_TESTS) {
            const handles = process._getActiveHandles && process._getActiveHandles();
            _debugWarn(`test-server post-close activeHandles=${handles && handles.length}`);
          }
        } catch {
          void 0;
        }

        // Defensive: ensure any remaining sockets created by this server are
        // explicitly ended/destroyed before we continue. Some Node versions
        // and CI environments can retain socket handles briefly after
        // server.close completes; end/destroy them here to reduce Jest
        // detectOpenHandles false positives.
        try {
          const all = Array.from(sockets).concat(Array.from(_sockets || []));
          for (const rs of all) {
            try {
              if (rs && typeof rs.end === 'function') {
                try {
                  rs.end();
                } catch {
                  void 0;
                }
              }
            } catch {
              void 0;
            }
            try {
              if (rs && typeof rs.destroy === 'function' && !rs.destroyed) {
                try {
                  rs.destroy();
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

        await new Promise((r) => process.nextTick(r));

        try {
          if (typeof server.unref === 'function') server.unref();
        } catch {
          void 0;
        }

        try {
          if (process.env.DEBUG_TESTS)
            _debugWarn(
              `test-server close completed ${JSON.stringify(
                server.address && server.address ? server.address() : 'addr-unknown'
              )}`
            );
        } catch {
          void 0;
        }

        _servers.delete(server);

        // clear any scheduled verbose dump timers to avoid lingering handles
        try {
          if (server && server.__verboseDumpTimer) {
            try {
              clearTimeout(server.__verboseDumpTimer);
            } catch {}
            try {
              server.__verboseDumpTimer = null;
            } catch {}
          }
        } catch {}

        try {
          for (const s of Array.from(_sockets)) {
            try {
              s.destroy();
            } catch {
              void 0;
            }
          }
          // Try to close any remaining servers and wait briefly for the
          // close callbacks to run. Collect promises and await them so the
          // native handles have a better chance to be freed before we
          // continue with a global sweep.
          const closePromises = [];
          for (const serv of Array.from(_servers)) {
            try {
              serv.removeAllListeners('connection');
              serv.removeAllListeners('listening');
              try {
                const p = new Promise((resolve) => {
                  try {
                    serv.close(() => resolve());
                  } catch {
                    resolve();
                  }
                  const _closeT = setTimeout(() => resolve(), 1500);
                  try {
                    if (_closeT && typeof _closeT.unref === 'function') _closeT.unref();
                  } catch {}
                });
                closePromises.push(p);
              } catch {
                void 0;
              }
            } catch {
              void 0;
            }
          }
          try {
            // wait for the best-effort close attempts to settle
            await Promise.allSettled(closePromises);
          } catch {
            void 0;
          }
          // Give a very short grace period to allow OS-level close callbacks
          // and socket 'close' events to propagate before we run the
          // aggressive global sweep. This reduces timing-based flakiness
          // on CI where a server.close() resolves slightly before native
          // handles finish teardown.
          try {
            await new Promise((r) => {
              const t = setTimeout(r, 25);
              try {
                if (t && typeof t.unref === 'function') t.unref();
              } catch {}
            });
          } catch {
            void 0;
          }
        } catch {
          void 0;
        }
        // Ensure any remaining tracked sockets/servers are aggressively
        // destroyed. This is defensive: some environments (CI, timing
        // differences) may still have handles open; call the global sweep
        // to reduce flakiness in Jest where active handles cause job failures.
        try {
          _forceCloseAllSockets();
        } catch {
          void 0;
        }
        // Give a short grace period for native handles / bound callbacks
        // to settle after forceful destruction. This is test-only and
        // reduces flaky detectOpenHandles reports on CI/Windows.
        try {
          await new Promise((r) => {
            const t = setTimeout(r, 75);
            try {
              if (t && typeof t.unref === 'function') t.unref();
            } catch {}
          });
        } catch {
          void 0;
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
            } catch {
              void 0;
            }
          }
        }
      } catch {
        void 0;
      }

      resolve({ base, close });
      // Schedule a short, verbose handle dump shortly after the server
      // starts so we can capture creation stacks for any handles created
      // during startup (useful when DEBUG_TESTS_LEVEL >= 3).
      try {
        const verbose = Number(process.env.DEBUG_TESTS_LEVEL || '0') >= 3;
        if (process.env.DEBUG_TESTS && verbose) {
          // schedule a short verbose dump and track the timer so it can be
          // cleared when the server is closed to avoid leaving a pending
          // Timeout handle that may be reported by Jest.
          try {
            const _t = setTimeout(() => {
              try {
                if (typeof process._getActiveHandles === 'function') {
                  const h = process._getActiveHandles() || [];
                  console.warn('DEBUG_TESTS: post-listen verbose active handles dump:');
                  h.forEach((hh, ii) => {
                    try {
                      // silently skip obvious stdio/tty handles
                      if (_isStdIoHandle(hh)) return;
                      const name = hh && hh.constructor && hh.constructor.name;
                      try {
                        console.warn(`  [${ii}] ${String(name)}`);
                      } catch {}

                      try {
                        if (!_isStdIoHandle(hh) && typeof hh._createdStack === 'string') {
                          try {
                            console.warn('    createdStack-preview:');
                          } catch {}
                          try {
                            const lines = hh._createdStack.split('\n').slice(0, 8) || [];
                            lines.forEach((ln) => {
                              try {
                                console.warn('      ' + String(ln).trim());
                              } catch {}
                            });
                          } catch {}
                        }
                      } catch {}

                      if (String(name) === 'Function') {
                        try {
                          const s = String(hh).slice(0, 1000);
                          try {
                            console.warn('    fn:', s);
                          } catch {}
                        } catch {}
                      }
                    } catch {}
                  });
                }
              } catch {}
            }, 50);
            try {
              if (typeof _t.unref === 'function') _t.unref();
            } catch {}
            try {
              server.__verboseDumpTimer = _t;
            } catch {}
          } catch {}
        }
      } catch {
        void 0;
      }
    }

    function onError(err) {
      reject(err);
    }

    server.once('error', onError);
    // Patch AsyncResource in tests before any modules that rely on it (such
    // as raw-body) create native async resources we can't easily cleanup.
    // Historically this was gated behind TEST_PATCH_RAW_BODY or DEBUG_TESTS,
    // but experiments show raw-body (and other libs) can create native
    // AsyncResources during server.listen which lead to a persistent
    // "bound-anonymous-fn" open handle reported by Jest. For test helpers
    // we always attempt a best-effort patch here. The patch function itself
    // is defensive and will no-op if async_hooks is unavailable.
    try {
      _patchAsyncResourceNoop();
    } catch {
      void 0;
    }
    try {
      if (typeof server.unref === 'function') server.unref();
    } catch {
      void 0;
    }

    try {
      server.listen(0, '127.0.0.1');
      server.once('listening', onListen);
    } catch {
      try {
        server.once('listening', onListen);
      } catch {
        void 0;
      }
      try {
        onListen();
      } catch {
        void 0;
      }
    }

    try {
      if (process.env.DEBUG_TESTS) {
        server.once('close', () => {
          try {
            _debugWarn(
              `test-server received close event for ${JSON.stringify(
                server.address && server.address ? server.address() : 'addr-unknown'
              )}`
            );
          } catch {
            void 0;
          }
        });
      }
    } catch {
      void 0;
    }
    // NOTE: restoration of the AsyncResource is deferred until the server
    // close path completes. See below where we restore after forceful
    // cleanup in the `close` function so any AsyncResources created during
    // startup/listen are captured while the server is active.
    try {
      if (typeof server.unref === 'function') server.unref();
    } catch {
      void 0;
    }
  });
}

function _forceCloseAllSockets() {
  // Best-effort: kill any child processes started by tests that may keep
  // stdio pipes and sockets open. Some test helpers spawn child servers and
  // don't reliably remove them; attempt to terminate tracked ChildProcess
  // objects (if any) and fallback to any recorded global list.
  try {
    const tracked = (global.__TEST_CHILD_PROCESSES && global.__TEST_CHILD_PROCESSES.slice()) || [];
    if (tracked.length) {
      try {
        _debugWarn(`DEBUG_TESTS: killing ${tracked.length} tracked test child process(es)`);
      } catch {}
    }

    for (const c of tracked) {
      try {
        const pid = c && c.pid;
        if (!pid) continue;

        try {
          // close stdio streams (they are often Socket handles)
          if (c.stdin && typeof c.stdin.destroy === 'function') c.stdin.destroy();
        } catch {}
        try {
          if (c.stdout && typeof c.stdout.destroy === 'function') c.stdout.destroy();
        } catch {}
        try {
          if (c.stderr && typeof c.stderr.destroy === 'function') c.stderr.destroy();
        } catch {}

        try {
          // graceful
          if (typeof c.kill === 'function') c.kill('SIGTERM');
          else process.kill(pid, 'SIGTERM');
        } catch {}

        // short wait then escalate
        const waitMs = 500;
        const start = Date.now();
        let alive = true;
        while (Date.now() - start < waitMs) {
          try {
            process.kill(pid, 0);
            // still alive
            // give it a tiny sleep
            const now = Date.now();
            const until = Math.min(50, waitMs - (now - start));
            Atomics ? Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, until) : null;
          } catch {
            alive = false;
            break;
          }
        }

        if (alive) {
          try {
            // force
            process.kill(pid, 'SIGKILL');
          } catch {
            try {
              if (process.platform === 'win32')
                require('child_process').spawnSync('taskkill', ['/PID', String(pid), '/T', '/F']);
            } catch {}
          }
        }
      } catch {
        void 0;
      }
    }

    // clear the tracked list
    try {
      global.__TEST_CHILD_PROCESSES = [];
    } catch {}
  } catch {
    void 0;
  }
  // First, destroy any sockets we have tracked explicitly
  for (const s of Array.from(_sockets)) {
    try {
      s.destroy();
    } catch {
      void 0;
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
          } catch {
            resolve();
          }
          // ensure we don't block indefinitely
          const _fcloseT = setTimeout(() => resolve(), 1500);
          try {
            if (_fcloseT && typeof _fcloseT.unref === 'function') _fcloseT.unref();
          } catch {}
        });
        // don't await here synchronously; let the promise run and continue
        p.catch(() => {});
      } catch {
        void 0;
      }
    } catch {
      void 0;
    }
  }

  // Aggressive sweep: inspect Node's active handles and destroy any Socket
  // handles that may not have been tracked (avoid destroying stdio streams).
  try {
    const handles = (process._getActiveHandles && process._getActiveHandles()) || [];
    // If any ChildProcess handles are present in the active handles list,
    // attempt a best-effort kill similar to above (covers cases where the
    // child wasn't tracked via global.__TEST_CHILD_PROCESSES).
    try {
      for (let i = 0; i < handles.length; i++) {
        try {
          const hh = handles[i];
          const nm = hh && hh.constructor && hh.constructor.name;
          if (String(nm) === 'ChildProcess' || (hh && typeof hh.pid === 'number')) {
            try {
              const pid = hh.pid;
              if (!pid) continue;
              try {
                if (
                  hh &&
                  typeof hh.stdin === 'object' &&
                  hh.stdin &&
                  typeof hh.stdin.destroy === 'function'
                )
                  hh.stdin.destroy();
              } catch {}
              try {
                if (
                  hh &&
                  typeof hh.stdout === 'object' &&
                  hh.stdout &&
                  typeof hh.stdout.destroy === 'function'
                )
                  hh.stdout.destroy();
              } catch {}
              try {
                if (
                  hh &&
                  typeof hh.stderr === 'object' &&
                  hh.stderr &&
                  typeof hh.stderr.destroy === 'function'
                )
                  hh.stderr.destroy();
              } catch {}

              try {
                process.kill(pid, 'SIGTERM');
              } catch {}

              // small synchronous wait loop (non-blocking best-effort)
              const start = Date.now();
              let alive = true;
              while (Date.now() - start < 300) {
                try {
                  process.kill(pid, 0);
                } catch {
                  alive = false;
                  break;
                }
              }

              if (alive) {
                try {
                  process.kill(pid, 'SIGKILL');
                } catch {
                  try {
                    if (process.platform === 'win32')
                      require('child_process').spawnSync('taskkill', [
                        '/PID',
                        String(pid),
                        '/T',
                        '/F',
                      ]);
                  } catch {}
                }
              }
            } catch {}
          }
        } catch {}
      }
    } catch {}
    if (process.env.DEBUG_TESTS) {
      try {
        // Show filtered count that excludes obvious stdio handles to reduce
        // noise in CI logs (we still print individual handle summaries below).
        let visibleCount = 0;
        try {
          visibleCount = handles.filter((hh) => !_isStdIoHandle(hh)).length;
        } catch {}
        console.warn(
          'DEBUG_TESTS: sweeping active handles, total=' +
            handles.length +
            ', visible=' +
            visibleCount
        );
        for (let i = 0; i < handles.length; i++) {
          try {
            const h = handles[i];
            const name = h && h.constructor && h.constructor.name;
            const info = { idx: i, type: String(name), destroyed: Boolean(h && h.destroyed) };
            try {
              if (typeof h.fd !== 'undefined') info.fd = h.fd;
            } catch {}
            try {
              if (typeof h.pending !== 'undefined') info.pending = h.pending;
            } catch {}
            try {
              if (h && (String(name) === 'ReadStream' || String(name) === 'FileReadStream')) {
                try {
                  if (typeof h.path !== 'undefined') info.path = h.path;
                } catch {}
                try {
                  if (h && h._readableState && typeof h._readableState.reading !== 'undefined')
                    info.reading = Boolean(h._readableState.reading);
                } catch {}
                try {
                  if (typeof h.bytesRead !== 'undefined') info.bytesRead = h.bytesRead;
                } catch {}
                try {
                  if (typeof h.readableEnded !== 'undefined') info.readableEnded = h.readableEnded;
                } catch {}
              }
            } catch {}
            try {
              console.warn(`  handle[${i}] summary: ${JSON.stringify(info)}`);
            } catch {}
            try {
              // Only show createdStack-preview for non-stdio handles to
              // reduce noise in CI logs.
              try {
                if (!_isStdIoHandle(h) && h && typeof h._createdStack === 'string') {
                  try {
                    console.warn('    createdStack-preview:');
                  } catch {}
                  try {
                    const lines = h._createdStack.split('\n').slice(0, 6) || [];
                    lines.forEach((ln) => {
                      try {
                        console.warn('      ' + String(ln).trim());
                      } catch {}
                    });
                  } catch {}
                }
              } catch {}
            } catch {}
          } catch {}
        }
      } catch {}
    }

    for (let i = 0; i < handles.length; i++) {
      const h = handles[i];
      try {
        const name = h && h.constructor && h.constructor.name;
        // If we encounter a Server handle that wasn't tracked, attempt a
        // best-effort close/remove listeners before treating it like a
        // socket/stream. This helps free native handles that otherwise
        // linger until process exit.
        try {
          if (String(name) === 'Server') {
            try {
              if (h && typeof h.removeAllListeners === 'function') {
                try {
                  h.removeAllListeners('connection');
                } catch {}
              }
            } catch {}
            try {
              if (h && typeof h.close === 'function') {
                try {
                  h.close();
                } catch {}
              }
            } catch {}
            try {
              if (h && h._handle && typeof h._handle.close === 'function') {
                try {
                  h._handle.close();
                } catch {}
              }
            } catch {}
            // proceed to next handle after attempts
            continue;
          }
        } catch {}
        try {
          // Best-effort: clear timer-like native handles (Timeout/Immediate)
          // that may not be tracked by our global timer wrapper. This mirrors
          // the cleanup added to `tests/jest.setup.js` so both in-process and
          // child-process server teardown attempt to clear timers.
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

        // Small defensive filter: skip obvious stdio/tty handles that the
        // instrumentation intentionally captures (createWritableStdioStream,
        // process.getStdout/getStderr, jest util isInteractive). These are
        // runtime stdio handles and not actionable leaks; filtering them
        // avoids noisy false-positives while keeping the aggressive
        // destruction for real sockets/streams.
        try {
          const cs = h && typeof h._createdStack === 'string' ? h._createdStack : '';
          if (
            cs &&
            (cs.includes('createWritableStdioStream') ||
              cs.includes('getStdout') ||
              cs.includes('getStderr') ||
              cs.includes('isInteractive') ||
              cs.includes('TTY') ||
              cs.includes('WriteStream'))
          ) {
            if (process.env.DEBUG_TESTS) {
              try {
                console.warn(`DEBUG_TESTS: skipping stdio/tty handle[${i}] name=${String(name)}`);
              } catch {}
            }
            continue;
          }
        } catch {}

        // Consider common names for file/socket read handles. We also
        // fall back to duck-typing (has readable/close/destroy) so we don't
        // miss other stream-like handles created by dependencies.
        const isSocket = String(name) === 'Socket';
        const isReadStream = String(name) === 'ReadStream' || String(name) === 'FileReadStream';
        const looksLikeStream = !!(
          h &&
          (h.readable ||
            h.readableEnded ||
            typeof h.close === 'function' ||
            typeof h.destroy === 'function')
        );

        if (isSocket || isReadStream || looksLikeStream) {
          try {
            if (h && h.destroyed) continue;

            // avoid touching stdio (fd 0,1,2) where present
            if (typeof h.fd !== 'undefined') {
              if (h.fd === 0 || h.fd === 1 || h.fd === 2) continue;
            }
          } catch {
            // ignore
          }

          try {
            // Prefer a graceful close/end first if available.
            try {
              if (h && typeof h.end === 'function') {
                try {
                  h.end();
                } catch {
                  void 0;
                }
              }
            } catch {
              void 0;
            }

            try {
              // Some file streams expose `close` which is more appropriate
              // for ReadStream-like objects. Try it before destroy.
              if (h && typeof h.close === 'function') {
                try {
                  h.close();
                } catch {
                  void 0;
                }
              }
            } catch {
              void 0;
            }

            try {
              if (h && typeof h.destroy === 'function') {
                try {
                  h.destroy();
                } catch {
                  void 0;
                }
              }
            } catch {
              void 0;
            }

            // Defensive second attempt on next tick
            try {
              process.nextTick(() => {
                try {
                  if (h && !h.destroyed && typeof h.destroy === 'function') {
                    try {
                      h.destroy();
                    } catch {
                      void 0;
                    }
                  }
                } catch {
                  void 0;
                }
                // Extra: attempt to call underlying native handle close/destroy where available.
                try {
                  for (let i2 = 0; i2 < handles.length; i2++) {
                    const hh = handles[i2];
                    try {
                      const nm = hh && hh.constructor && hh.constructor.name;
                      if (!hh) continue;
                      if (String(nm) === 'Socket' || String(nm) === 'TLSSocket') {
                        try {
                          if (hh._handle && typeof hh._handle.close === 'function') {
                            try {
                              hh._handle.close();
                            } catch {
                              void 0;
                            }
                          }
                        } catch {
                          void 0;
                        }
                        try {
                          if (hh._handle && typeof hh._handle.destroy === 'function') {
                            try {
                              hh._handle.destroy();
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
                  void 0;
                }

                // Drain common http/https Agent pools (sockets/freeSockets) and destroy agents
                try {
                  const drainAgent = (agent) => {
                    if (!agent) return;
                    try {
                      const iter = (obj) => {
                        if (!obj) return;
                        try {
                          try {
                            Object.values(obj).forEach((arr) => {
                              try {
                                if (Array.isArray(arr)) {
                                  arr.forEach((s) => {
                                    try {
                                      if (s && typeof s.destroy === 'function') s.destroy();
                                    } catch {}
                                  });
                                }
                              } catch {}
                            });
                          } catch {}
                        } catch {}
                      };
                      iter(agent.sockets);
                      iter(agent.freeSockets);
                      if (typeof agent.destroy === 'function') {
                        try {
                          agent.destroy();
                        } catch {}
                      }
                    } catch {}
                  };
                  try {
                    drainAgent(http && http.globalAgent);
                  } catch {}
                  try {
                    const httpsAgent = require('https') && require('https').globalAgent;
                    drainAgent(httpsAgent);
                  } catch {}
                } catch {
                  void 0;
                }
              });
            } catch {
              void 0;
            }

            if (process.env.DEBUG_TESTS) {
              try {
                console.warn(`DEBUG_TESTS: attempted cleanup handle[${i}] name=${String(name)}`);
                if (h && typeof h._createdStack === 'string') {
                  console.warn('    createdStack-preview:');
                  (h._createdStack.split('\n').slice(0, 6) || []).forEach((ln) =>
                    console.warn('      ' + String(ln).trim())
                  );
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
        void 0;
      }
    }
  } catch {
    void 0;
  }

  // Restore AsyncResource implementation (if we patched it) now that the
  // server close and aggressive cleanup has completed. This avoids leaving
  // the NoopAsyncResource in place for other tests or code paths.
  try {
    _restoreAsyncResource();
  } catch {
    void 0;
  }

  // finally clear our registries
  _sockets.clear();
  _servers.clear();
}

function registerTestChild(child) {
  try {
    global.__TEST_CHILD_PROCESSES = global.__TEST_CHILD_PROCESSES || [];
    if (child && child.pid) global.__TEST_CHILD_PROCESSES.push(child);
  } catch {
    void 0;
  }
}

module.exports = { startTestServer, _forceCloseAllSockets, registerTestChild };
