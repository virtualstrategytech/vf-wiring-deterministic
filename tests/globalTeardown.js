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
                void e;
              }
              return;
            }
            if (h && typeof h.close === 'function') {
              try {
                h.close();
              } catch (e) {
                void e;
              }
              return;
            }
            if (h && h._handle && typeof h._handle.close === 'function') {
              try {
                h._handle.close();
              } catch (e) {
                void e;
              }
              return;
            }
          } catch (_) {
            void _;
          }
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

  // Best-effort: inspect active handles for any ChildProcess-like objects
  // that weren't tracked by helpers and try to terminate them. This is
  // defensive and should not throw; it's intended to reduce CI flaky
  // failures caused by orphaned subprocesses keeping the runner alive.
  try {
    try {
      const handles = (process._getActiveHandles && process._getActiveHandles()) || [];
      for (let i = 0; i < handles.length; i++) {
        try {
          const h = handles[i];
          const name = h && h.constructor && h.constructor.name;
          // Look for ChildProcess or objects that look like a child (has pid)
          if (String(name) === 'ChildProcess' || (h && typeof h.pid === 'number')) {
            try {
              const pid = h.pid;
              if (!pid) continue;
              appendLog(
                `globalTeardown: found orphan child handle idx=${i} pid=${pid} name=${String(name)}`
              );

              // Try to destroy stdio streams attached to the handle which can keep
              // file descriptors open.
              try {
                if (h.stdin && typeof h.stdin.destroy === 'function') h.stdin.destroy();
              } catch (_e) {}
              try {
                if (h.stdout && typeof h.stdout.destroy === 'function') h.stdout.destroy();
              } catch (_e) {}
              try {
                if (h.stderr && typeof h.stderr.destroy === 'function') h.stderr.destroy();
              } catch (_e) {}

              // Graceful then forceful kill
              try {
                process.kill(pid, 'SIGTERM');
                appendLog(`globalTeardown: sent SIGTERM to ${pid}`);
              } catch (_e) {
                appendLog(`globalTeardown: SIGTERM failed for ${pid}: ${_e && _e.message}`);
              }

              const start = Date.now();
              let alive = true;
              const waitMs = 500;
              while (Date.now() - start < waitMs) {
                try {
                  process.kill(pid, 0);
                  // still alive
                  // short sleep
                  await new Promise((r) => setTimeout(r, 30));
                } catch {
                  alive = false;
                  break;
                }
              }

              if (alive) {
                try {
                  process.kill(pid, 'SIGKILL');
                  appendLog(`globalTeardown: sent SIGKILL to ${pid}`);
                } catch (_e) {
                  appendLog(`globalTeardown: SIGKILL failed for ${pid}: ${_e && _e.message}`);
                }
              }
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
  } catch (_e) {
    appendLog(`globalTeardown: orphan-child-sweep error: ${_e && _e.message}`);
  }

  // Extra conservative step: attempt platform-specific forced kills for
  // common orphan test servers that may not have been tracked or that
  // ignored earlier kill attempts. This helps CI where a reparented or
  // stubborn child process can keep the job alive despite prior cleanup.
  try {
    appendLog(
      'globalTeardown: attempting platform-specific pkill/taskkill for common orphan servers'
    );
    if (process.platform !== 'win32') {
      try {
        // try to terminate any child process started via server-runner
        spawnSync('pkill', ['-TERM', '-f', 'server-runner'], { stdio: 'ignore' });
        appendLog('globalTeardown: pkill server-runner invoked');
      } catch (_) {}
      try {
        // try to terminate any node process running the webhook server file
        spawnSync('pkill', ['-TERM', '-f', 'novain-platform/webhook/server.js'], {
          stdio: 'ignore',
        });
        appendLog('globalTeardown: pkill webhook server.js invoked');
      } catch (_) {}
      try {
        // catch variants named server-runner.js or similar
        spawnSync('pkill', ['-TERM', '-f', 'server-runner.js'], { stdio: 'ignore' });
      } catch (_) {}
    } else {
      try {
        // On Windows: avoid killing all node.exe processes (too aggressive).
        // Instead use PowerShell to find node processes whose command line
        // mentions our test-server runner or the webhook server file and
        // then taskkill those PIDs specifically.
        try {
          spawnSync(
            'powershell',
            [
              '-NoProfile',
              '-Command',
              "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and ($_.CommandLine -like '*server-runner*' -or $_.CommandLine -like '*novain-platform\\webhook\\server.js*') } | Select-Object -ExpandProperty ProcessId | ForEach-Object { taskkill /PID $_ /T /F }",
            ],
            { stdio: 'ignore' }
          );
          appendLog('globalTeardown: targeted taskkill via PowerShell invoked');
        } catch (_) {}
      } catch (_) {}
    }

    // Give the OS a short moment to clean up reparented processes
    try {
      await new Promise((r) => setTimeout(r, 200));
    } catch (_) {}

    // Re-scan active handles/requests and perform a second best-effort
    // ChildProcess kill sweep to catch any remaining orphaned children.
    try {
      const handles = (process._getActiveHandles && process._getActiveHandles()) || [];
      for (let i = 0; i < handles.length; i++) {
        try {
          const h = handles[i];
          const name = h && h.constructor && h.constructor.name;
          if (String(name) === 'ChildProcess' || (h && typeof h.pid === 'number')) {
            try {
              const pid = h.pid;
              if (!pid) continue;
              appendLog(
                `globalTeardown: re-check found child handle idx=${i} pid=${pid} name=${String(name)}`
              );
              try {
                process.kill(pid, 'SIGTERM');
                appendLog(`globalTeardown: re-sent SIGTERM to ${pid}`);
              } catch (_) {}

              const start = Date.now();
              let alive = true;
              const waitMs = 300;
              while (Date.now() - start < waitMs) {
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
                  appendLog(`globalTeardown: re-sent SIGKILL to ${pid}`);
                } catch (_) {
                  try {
                    if (process.platform === 'win32')
                      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
                  } catch (_) {}
                }
              }
            } catch (_) {}
          }
        } catch (_) {}
      }
    } catch (e) {
      appendLog(`globalTeardown: platform-specific kill attempts error: ${e && e.message}`);
    }
  } catch (e) {
    appendLog(`globalTeardown: platform kill outer error: ${e && e.message}`);
  }

  // Final aggressive sweep (diagnostic only)
  try {
    forceDestroyRemainingSockets();
    appendLog('globalTeardown: forceDestroyRemainingSockets invoked');
  } catch (e) {
    appendLog(`globalTeardown: final force destroy error: ${e && e.message}`);
  }

  // Extra: synchronously drain http/https globalAgents to ensure any
  // agent-created sockets are destroyed before process exit. Doing this
  // synchronously (not in nextTick) increases the chance native handles
  // are freed prior to Jest detectOpenHandles checks.
  try {
    const drainAgentSync = (agent) => {
      if (!agent) return;
      try {
        const iter = (obj) => {
          if (!obj) return;
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
        };
        iter(agent.sockets);
        iter(agent.freeSockets);
        if (typeof agent.destroy === 'function') {
          try {
            agent.destroy();
            appendLog('globalTeardown: agent.destroy() invoked');
          } catch (_e) {
            appendLog(`globalTeardown: agent.destroy() error: ${_e && _e.message}`);
          }
        }
      } catch {}
    };

    try {
      const http = require('http');
      drainAgentSync(http && http.globalAgent);
    } catch (_e) {
      appendLog(`globalTeardown: http agent drain error: ${_e && _e.message}`);
    }
    try {
      const https = require('https');
      drainAgentSync(https && https.globalAgent);
    } catch (_e) {
      appendLog(`globalTeardown: https agent drain error: ${_e && _e.message}`);
    }
  } catch (_e) {
    appendLog(`globalTeardown: agent drain outer error: ${_e && _e.message}`);
  }

  // Enhanced diagnostic: enumerate active handles and capture extra
  // metadata for ChildProcess-like objects (pid, /proc cmdline on Linux)
  try {
    try {
      const handles = (process._getActiveHandles && process._getActiveHandles()) || [];
      appendLog(`globalTeardown: pre-finish activeHandles.count=${handles.length}`);
      for (let i = 0; i < handles.length; i++) {
        try {
          const h = handles[i];
          const name = h && h.constructor && h.constructor.name;
          if (String(name) === 'ChildProcess' || (h && typeof h.pid === 'number')) {
            try {
              const pid = h.pid;
              appendLog(
                `globalTeardown: diag child-handle idx=${i} pid=${pid} name=${String(name)}`
              );
              // Try to read /proc/<pid>/cmdline on Linux to capture the exact
              // command line that created the process (useful in CI).
              try {
                if (pid && process.platform !== 'win32') {
                  const procPath = `/proc/${pid}/cmdline`;
                  const fs = require('fs');
                  if (fs.existsSync(procPath)) {
                    try {
                      const cmd = fs.readFileSync(procPath, 'utf8').replace(/\0/g, ' ').trim();
                      appendLog(`globalTeardown: diag child-cmdline pid=${pid} cmd="${cmd}"`);
                    } catch (_e) {
                      appendLog(
                        `globalTeardown: diag proc read error pid=${pid} err=${_e && _e.message}`
                      );
                    }
                  }
                }
              } catch (_e) {
                appendLog(`globalTeardown: diag proc read outer error: ${_e && _e.message}`);
              }
            } catch (_e) {
              appendLog(
                `globalTeardown: diag child-handle read error idx=${i} err=${_e && _e.message}`
              );
            }
          } else {
            // Log socket-created stacks where available to help trace origin
            try {
              if (h && typeof h._createdStack === 'string') {
                const preview = String(h._createdStack).split('\n').slice(0, 6).join(' | ');
                appendLog(
                  `globalTeardown: diag handle idx=${i} name=${String(name)} createdStack=${preview}`
                );
              }
            } catch {}
          }
        } catch {}
      }
    } catch (e) {
      appendLog(`globalTeardown: diag enumeration error: ${e && e.message}`);
    }
  } catch (e) {
    appendLog(`globalTeardown: enhanced diag outer error: ${e && e.message}`);
  }

  appendLog('globalTeardown: finished');
};
