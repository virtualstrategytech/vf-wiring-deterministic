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
  // Close any cached ephemeral server created by request-helper to avoid
  // leaving a listening handle open across the test run. This is best-effort
  // and will silently continue if the helper isn't present.
  try {
    try {
      const rh = require('./helpers/request-helper');
      if (rh && typeof rh.closeCachedServer === 'function') {
        appendLog('globalTeardown: closing cached request-helper server');
        try {
          await rh.closeCachedServer();
          appendLog('globalTeardown: cached server closed');
        } catch (e) {
          appendLog(`globalTeardown: closeCachedServer error: ${e && e.message}`);
        }
      }
      // If the request-helper exposed a shared-agent restore, call it to
      // destroy any pooled agents we installed during tests.
      if (rh && typeof rh._restoreAndDestroySharedAgents === 'function') {
        appendLog('globalTeardown: restoring/destroying shared test agents');
        try {
          await rh._restoreAndDestroySharedAgents();
          appendLog('globalTeardown: shared test agents destroyed');
        } catch (e) {
          appendLog(`globalTeardown: _restoreAndDestroySharedAgents error: ${e && e.message}`);
        }
      }
      // Force-close any temporary servers tracked by the request-helper
      if (rh && typeof rh._forceCloseTemporaryServers === 'function') {
        appendLog('globalTeardown: force-closing temporary servers from request-helper');
        try {
          await rh._forceCloseTemporaryServers();
          appendLog('globalTeardown: forced temporary servers closed');
        } catch (e) {
          appendLog(`globalTeardown: _forceCloseTemporaryServers error: ${e && e.message}`);
        }
      }
    } catch {}
  } catch (e) {
    appendLog(`globalTeardown: closeCachedServer unexpected error: ${e && e.message}`);
  }
  // Attempt to call app-level cleanup helpers (if the webhook app was loaded
  // in-process during tests). This will destroy shared agents and other
  // resources created by the app that may keep sockets open.
  try {
    try {
      const app = require('../novain-platform/webhook/server');
      if (app && typeof app.closeResources === 'function') {
        appendLog('globalTeardown: calling app.closeResources()');
        try {
          await app.closeResources();
          appendLog('globalTeardown: app.closeResources() completed');
        } catch (e) {
          appendLog(`globalTeardown: app.closeResources error: ${e && e.message}`);
        }
      }
    } catch (e) {
      // best-effort; app may not have been required during tests
      appendLog(`globalTeardown: require app failed: ${e && e.message}`);
    }
  } catch (e) {
    appendLog(`globalTeardown: app cleanup unexpected error: ${e && e.message}`);
  }
  // Ensure Node http/https global agents are destroyed to avoid lingering sockets
  try {
    const http = require('http');
    const https = require('https');
    if (http && http.globalAgent && typeof http.globalAgent.destroy === 'function') {
      try {
        http.globalAgent.destroy();
        appendLog('globalTeardown: http.globalAgent.destroy() called');
      } catch (e) {
        appendLog(`globalTeardown: http.globalAgent.destroy failed: ${e && e.message}`);
      }
    }
    if (https && https.globalAgent && typeof https.globalAgent.destroy === 'function') {
      try {
        https.globalAgent.destroy();
        appendLog('globalTeardown: https.globalAgent.destroy() called');
      } catch (e) {
        appendLog(`globalTeardown: https.globalAgent.destroy failed: ${e && e.message}`);
      }
    }
  } catch (e) {
    appendLog(`globalTeardown: agent destroy error: ${e && e.message}`);
  }

  // Best-effort: if undici is used anywhere in tests or app code, close
  // the global dispatcher to free sockets. This library is commonly used
  // by modern HTTP clients and can keep native handles open if not closed.
  try {
    const undici = require('undici');
    if (undici) {
      try {
        const gd =
          typeof undici.getGlobalDispatcher === 'function' ? undici.getGlobalDispatcher() : null;
        if (gd && typeof gd.close === 'function') {
          try {
            gd.close();
            appendLog('globalTeardown: undici.getGlobalDispatcher().close() called');
          } catch (e) {
            appendLog(`globalTeardown: undici.close failed: ${e && e.message}`);
          }
        }
        if (gd && typeof gd.destroy === 'function') {
          try {
            gd.destroy();
            appendLog('globalTeardown: undici.getGlobalDispatcher().destroy() called');
          } catch (e) {
            appendLog(`globalTeardown: undici.destroy failed: ${e && e.message}`);
          }
        }
      } catch {}
    }
  } catch {}

  // Also attempt to destroy any agent used by 'superagent' / 'supertest' helpers
  try {
    const { Agent } = require('http');
    if (Agent && typeof Agent.prototype.destroy === 'function') {
      try {
        // Best effort: destroy globalAgent again to ensure closures
        if (Agent.globalAgent && typeof Agent.globalAgent.destroy === 'function') {
          Agent.globalAgent.destroy();
          appendLog('globalTeardown: Agent.globalAgent.destroy() called');
        }
      } catch (e) {
        appendLog(`globalTeardown: Agent.globalAgent.destroy failed: ${e && e.message}`);
      }
    }
  } catch (e) {
    // ignore
  }

  // Append final marker
  try {
    // Log active handles count and types for CI debugging
    const handles = (process._getActiveHandles && process._getActiveHandles()) || [];
    const summary = handles.map((h) => h && h.constructor && h.constructor.name).filter(Boolean);
    appendLog(`globalTeardown: activeHandles=${handles.length} types=${summary.join(',')}`);
  } catch (e) {
    appendLog(`globalTeardown: failed listing handles: ${e && e.message}`);
  }

  appendLog('globalTeardown: finished');
};
