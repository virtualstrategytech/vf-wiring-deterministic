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

  // Best-effort: ask any test server helper to close sockets before killing
  try {
    const serverHelper = require('./helpers/server-helper');
    if (serverHelper && typeof serverHelper._forceCloseAllSockets === 'function') {
      try {
        serverHelper._forceCloseAllSockets();
        appendLog('globalTeardown: invoked serverHelper._forceCloseAllSockets');
      } catch (e) {
        appendLog(`globalTeardown: serverHelper._forceCloseAllSockets error: ${e && e.message}`);
      }
    }
  } catch {
    // ignore; helper may not be present in all runs
  }

  // Try to kill the spawned webhook process (if any)
  try {
    if (!fs.existsSync(pidFile)) {
      appendLog('globalTeardown: pid file not found; nothing to kill');
      return;
    }

    let pid;
    try {
      pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    } catch (e) {
      appendLog(`globalTeardown: failed reading pid file: ${e.message}`);
    }

    if (!pid || Number.isNaN(pid)) {
      appendLog('globalTeardown: invalid pid; removing pid file if present');
      try {
        fs.unlinkSync(pidFile);
        appendLog('globalTeardown: pid file removed');
      } catch {}
      return;
    }

    appendLog(`globalTeardown: attempting graceful kill for pid ${pid}`);

    // Try a graceful kill first
    try {
      process.kill(pid, 'SIGTERM');
      appendLog(`globalTeardown: sent SIGTERM to ${pid}`);
    } catch (e) {
      appendLog(`globalTeardown: process.kill(SIGTERM) failed: ${e.message}`);
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
          } catch (e) {
            appendLog(`globalTeardown: SIGKILL failed: ${e.message}; attempting pkill -P`);
            spawnSync('pkill', ['-TERM', '-P', String(pid)]);
            appendLog('globalTeardown: pkill invoked for child processes');
          }
        }
      } catch (e) {
        appendLog(`globalTeardown: force kill attempt failed: ${e.message}`);
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
    } catch (e) {
      appendLog(`globalTeardown: failed to remove pid file: ${e.message}`);
    }
  } catch (e) {
    appendLog(`globalTeardown: unexpected error: ${e && e.message}`);
  }

  // Append final marker
  appendLog('globalTeardown: finished');
  // Best-effort: destroy global http/https agents to avoid Jest open-handle warnings
  try {
    try {
      const http = require('http');
      if (http && http.globalAgent && typeof http.globalAgent.destroy === 'function') {
        http.globalAgent.destroy();
        appendLog('globalTeardown: destroyed http.globalAgent');
      }
    } catch (e) {
      appendLog(`globalTeardown: http agent destroy error: ${e && e.message}`);
    }

    try {
      const https = require('https');
      if (https && https.globalAgent && typeof https.globalAgent.destroy === 'function') {
        https.globalAgent.destroy();
        appendLog('globalTeardown: destroyed https.globalAgent');
      }
    } catch (e) {
      appendLog(`globalTeardown: https agent destroy error: ${e && e.message}`);
    }
  } catch {}
};
