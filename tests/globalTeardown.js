const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

module.exports = async () => {
  const pidFile = path.resolve(__dirname, 'webhook.pid');
  const logFile = path.resolve(__dirname, 'globalSetup.log');

  function appendLog(line) {
    try {
      fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${line}\n`);
    } catch {}
  }

  appendLog('globalTeardown: starting');

  // Helper: force-destroy stray sockets (diagnostic only)
  function forceDestroyRemainingSockets() {
    // Attempts to close common network handle types that may keep Node alive.
    // Run unconditionally in teardown to stabilize CI/test runs; avoid
    // touching stdio streams (process.stdout/stderr) to prevent surprises.
    if (process.env.SKIP_FORCE_HANDLE_CLEANUP === 'true') return;
    try {
      const handles = process._getActiveHandles ? process._getActiveHandles() : [];
      handles.forEach((h, i) => {
        try {
          // Skip obvious non-network handles
          if (h === process.stdout || h === process.stderr || h === process.stdin) return;

          const name = h && h.constructor && h.constructor.name;
          // TLSSocket / Socket: attempt graceful end -> destroy -> underlying close
          if (name === 'TLSSocket' || name === 'Socket') {
            try {
              const meta = {};
              if (h.remoteAddress) meta.remoteAddress = h.remoteAddress;
              if (h.remotePort) meta.remotePort = h.remotePort;
              console.warn(`force-destroy: closing socket[${i}] (${name})`, meta);
            } catch {}
            try {
              if (typeof h.end === 'function') h.end();
            } catch {}
            try {
              if (typeof h.destroy === 'function') h.destroy();
            } catch {}
            try {
              if (h && h._handle && typeof h._handle.close === 'function') h._handle.close();
            } catch {}
            return;
          }

          // http2 ClientHttp2Session
          if (
            name === 'ClientHttp2Session' ||
            (h && typeof h.close === 'function' && String(name).includes('Http2'))
          ) {
            try {
              console.warn(`force-destroy: closing http2 session[${i}] (${name})`);
              if (typeof h.close === 'function') h.close();
            } catch {}
            return;
          }

          // Generic fallback for handles with destroy/close
          try {
            if (h && typeof h.destroy === 'function') {
              try {
                h.destroy();
              } catch (e) {
                /* ignore */
              }
              return;
            }
            if (h && typeof h.close === 'function') {
              try {
                h.close();
              } catch (e) {
                /* ignore */
              }
              return;
            }
            if (h && h._handle && typeof h._handle.close === 'function') {
              try {
                h._handle.close();
              } catch (e) {
                /* ignore */
              }
              return;
            }
          } catch (_) {}
        } catch (err) {
          void err;
        }
      });
    } catch (err) {
      void err;
    }
  }

  // Best-effort: ask any test server helper to close sockets before killing
  try {
    const serverHelper = require('./helpers/server-helper');
    if (serverHelper && typeof serverHelper._forceCloseAllSockets === 'function') {
      try {
        serverHelper._forceCloseAllSockets();
        appendLog('globalTeardown: invoked serverHelper._forceCloseAllSockets');
      } catch (_e) {
        appendLog(`globalTeardown: serverHelper._forceCloseAllSockets error: ${_e && _e.message}`);
      }
    }
  } catch {
    // ignore; helper may not be present in all runs
  }

  // Try to kill the spawned webhook process (if any)
  try {
    if (!fs.existsSync(pidFile)) {
      appendLog('globalTeardown: pid file not found; nothing to kill');
      // continue to do final sweeps
    } else {
      let pid;
      try {
        pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
      } catch (_e) {
        appendLog(`globalTeardown: failed reading pid file: ${_e.message}`);
      }

      if (!pid || Number.isNaN(pid)) {
        appendLog('globalTeardown: invalid pid; removing pid file if present');
        try {
          fs.unlinkSync(pidFile);
          appendLog('globalTeardown: pid file removed');
        } catch (rmErr) {
          appendLog(`globalTeardown: failed removing pid file: ${rmErr && rmErr.message}`);
        }
      } else {
        appendLog(`globalTeardown: attempting graceful kill for pid ${pid}`);

        // Try a graceful kill first
        try {
          process.kill(pid, 'SIGTERM');
          appendLog(`globalTeardown: sent SIGTERM to ${pid}`);
        } catch (_e) {
          appendLog(`globalTeardown: process.kill(SIGTERM) failed: ${_e && _e.message}`);
        }

        // Wait up to N ms for process to exit
        const waitMs = 5000;
        const start = Date.now();
        let alive = true;
        while (Date.now() - start < waitMs) {
          try {
            process.kill(pid, 0); // throws if not running
            // still alive
            await new Promise((r) => setTimeout(r, 200));
          } catch {
            alive = false;
            break;
          }
        }

        if (alive) {
          appendLog(`globalTeardown: process ${pid} still alive after ${waitMs}ms; forcing kill`);
          try {
            if (process.platform === 'win32') {
              spawnSync('taskkill', ['/PID', String(pid), '/T', '/F']);
              appendLog(`globalTeardown: taskkill invoked for ${pid}`);
            } else {
              try {
                process.kill(pid, 'SIGKILL');
                appendLog(`globalTeardown: sent SIGKILL to ${pid}`);
              } catch (_e) {
                appendLog(
                  `globalTeardown: SIGKILL failed: ${_e && _e.message}; attempting pkill -P`
                );
                spawnSync('pkill', ['-TERM', '-P', String(pid)]);
                appendLog('globalTeardown: pkill invoked for child processes');
              }
            }
          } catch (_e) {
            appendLog(`globalTeardown: force kill attempt failed: ${_e && _e.message}`);
          }

          // Final short wait
          await new Promise((r) => setTimeout(r, 300));
          try {
            process.kill(pid, 0);
            appendLog(`globalTeardown: process ${pid} still exists after forced kill`);
          } catch {
            appendLog(`globalTeardown: process ${pid} no longer exists`);
          }
        } else {
          appendLog(`globalTeardown: process ${pid} exited gracefully`);
        }

        // Cleanup pid file
        try {
          if (fs.existsSync(pidFile)) {
            fs.unlinkSync(pidFile);
            appendLog('globalTeardown: pid file removed');
          }
        } catch (_e) {
          appendLog(`globalTeardown: failed to remove pid file: ${_e && _e.message}`);
        }
      }
    }
  } catch (_e) {
    appendLog(`globalTeardown: unexpected error: ${_e && _e.message}`);
  }

  // Best-effort: destroy global http/https agents to avoid Jest open-handle warnings
  try {
    try {
      const http = require('http');
      if (http && http.globalAgent && typeof http.globalAgent.destroy === 'function') {
        http.globalAgent.destroy();
        appendLog('globalTeardown: destroyed http.globalAgent');
      }
    } catch (_e) {
      appendLog(`globalTeardown: http agent destroy error: ${_e && _e.message}`);
    }

    try {
      const https = require('https');
      if (https && https.globalAgent && typeof https.globalAgent.destroy === 'function') {
        https.globalAgent.destroy();
        appendLog('globalTeardown: destroyed https.globalAgent');
      }
    } catch (_e) {
      appendLog(`globalTeardown: https agent destroy error: ${_e && _e.message}`);
    }
  } catch {}

  // Give Node a short moment to release native handles after aggressive cleanup.
  try {
    await new Promise((r) => setTimeout(r, 100));
    // Run one more proactive sweep of any test-server sockets/servers.
    try {
      const serverHelper = require('./helpers/server-helper');
      if (serverHelper && typeof serverHelper._forceCloseAllSockets === 'function') {
        serverHelper._forceCloseAllSockets();
        appendLog('globalTeardown: post-delay invoked serverHelper._forceCloseAllSockets');
      }
    } catch (_e) {
      appendLog(`globalTeardown: post-delay serverHelper sweep error: ${_e && _e.message}`);
    }
  } catch {}

  // If requested, produce a diagnostic dump of Node active handles/requests.
  try {
    const shouldDump =
      process.env.DEBUG_TESTS === 'true' || process.env.DUMP_ACTIVE_HANDLES === 'true';
    if (shouldDump) {
      appendLog('globalTeardown: dumping active handles for diagnostics');
      try {
        const handles = (process._getActiveHandles && process._getActiveHandles()) || [];
        appendLog(`globalTeardown: activeHandles.count=${handles.length}`);
        for (let i = 0; i < handles.length; i++) {
          const h = handles[i];
          const info = { index: i, type: typeof h };
          try {
            info.constructor = h && h.constructor && h.constructor.name;
          } catch {}
          try {
            if (h && typeof h.address === 'function') {
              try {
                info.address = h.address && h.address();
              } catch {}
            }
          } catch {}
          try {
            // socket-specific metadata
            if (h && h.remoteAddress) {
              info.remoteAddress = h.remoteAddress;
            }
            if (h && h.remotePort) info.remotePort = h.remotePort;
            if (h && h.localPort) info.localPort = h.localPort;
            if (h && h._createdStack)
              info.createdStack = String(h._createdStack).split('\n').slice(0, 6).join('\n');
            // listeners on EventEmitter-like objects
            if (h && typeof h.eventNames === 'function') {
              try {
                const ev = (typeof h.eventNames === 'function' && h.eventNames()) || [];
                info.eventNames = ev;
                // include count of listeners for 'listening' and 'connection'
                try {
                  info.listeningListeners =
                    (typeof h.listeners === 'function' &&
                      h.listeners('listening') &&
                      h.listeners('listening').length) ||
                    0;
                } catch {}
              } catch {}
            }
          } catch {}

          // Serialize succinctly and append
          try {
            appendLog(`activeHandle[${i}]: ${JSON.stringify(info)}`);
          } catch (e) {
            appendLog(`activeHandle[${i}]: toStringError ${e && e.message}`);
          }
        }
      } catch (e) {
        appendLog(`globalTeardown: activeHandles dump failed: ${e && e.message}`);
      }

      try {
        const reqs = (process._getActiveRequests && process._getActiveRequests()) || [];
        appendLog(`globalTeardown: activeRequests.count=${reqs.length}`);
      } catch (e) {
        appendLog(`globalTeardown: activeRequests dump error: ${e && e.message}`);
      }
    }
  } catch (e) {
    appendLog(`globalTeardown: diagnostic dump error: ${e && e.message}`);
  }

  // Final aggressive sweep (diagnostic only)
  try {
    forceDestroyRemainingSockets();
    appendLog('globalTeardown: forceDestroyRemainingSockets invoked');
  } catch (e) {
    appendLog(`globalTeardown: final force destroy error: ${e && e.message}`);
  }

  appendLog('globalTeardown: finished');
};
