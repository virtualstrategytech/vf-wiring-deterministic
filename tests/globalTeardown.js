/* tests/globalTeardown.js */
const fs = require("fs");
const path = require("path");

module.exports = async () => {
<<<<<<< HEAD
=======
  const pidFile = path.resolve(__dirname, 'webhook.pid');
  const logFile = path.resolve(__dirname, 'globalSetup.log');
  const childStdoutPath = path.resolve(__dirname, 'webhook.child.stdout.log');
  const childStderrPath = path.resolve(__dirname, 'webhook.child.stderr.log');

  function appendLog(line) {
    try {
      fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${line}\n`);
    } catch {}
  }

  appendLog('globalTeardown: starting');

  // Try to kill the spawned webhook process (if any)
>>>>>>> origin/feat/wiring-agent
  try {
    const p = path.join(process.cwd(), "tests", "globalSetup.log");
    if (fs.existsSync(p)) {
      const out = path.join(process.cwd(), "tests", "globalTeardown.log");
      fs.copyFileSync(p, out);
    }
  } catch {
    // non-fatal
  }
<<<<<<< HEAD
=======
  // Try to kill the spawned prompt-mock child (if any)
  try {
    const promptPidFile = path.resolve(__dirname, 'prompt-mock.pid');
    const promptInfoFile = path.resolve(__dirname, 'prompt-mock.json');
    if (fs.existsSync(promptPidFile)) {
      let ppid = null;
      try {
        ppid = Number(fs.readFileSync(promptPidFile, 'utf8').trim());
      } catch {}
      if (ppid && !Number.isNaN(ppid)) {
        appendLog(`globalTeardown: attempting to kill prompt-mock pid ${ppid}`);
        try {
          process.kill(ppid, 'SIGTERM');
          appendLog(`globalTeardown: sent SIGTERM to prompt-mock ${ppid}`);
        } catch (e) {
          appendLog(`globalTeardown: prompt-mock kill SIGTERM failed: ${e && e.message}`);
        }
        try {
          fs.unlinkSync(promptPidFile);
          appendLog('globalTeardown: prompt-mock pid file removed');
        } catch {}
      } else {
        try {
          fs.unlinkSync(promptPidFile);
          appendLog('globalTeardown: removed invalid prompt-mock pid file');
        } catch {}
      }
    }
    try {
      if (fs.existsSync(path.resolve(__dirname, 'prompt-mock.json')))
        fs.unlinkSync(path.resolve(__dirname, 'prompt-mock.json'));
    } catch {}
  } catch (e) {
    appendLog(`globalTeardown: prompt-mock teardown error: ${e && e.message}`);
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
  // Best-effort: close any WriteStream/FileWriteStream handles that were
  // created by `globalSetup` to capture child stdout/stderr. These file
  // streams can remain open across the test run and show up as lingering
  // handles in Jest's detectOpenHandles. Inspect active handles and
  // end/destroy any matching streams.
  try {
    if (typeof process._getActiveHandles === 'function') {
      const handles = process._getActiveHandles() || [];
      for (let i = 0; i < handles.length; i++) {
        try {
          const h = handles[i];
          const name = h && h.constructor && h.constructor.name;
          if (!name) continue;
          if (String(name) === 'WriteStream' || String(name) === 'FileWriteStream') {
            try {
              const p = h && h.path ? String(h.path) : '';
              if (p === childStdoutPath || p === childStderrPath) {
                try {
                  appendLog(`globalTeardown: closing lingering write stream for ${p}`);
                } catch {}
                try {
                  if (typeof h.end === 'function') h.end();
                } catch {}
                try {
                  if (typeof h.destroy === 'function') h.destroy();
                } catch {}
              }
            } catch {}
          }
        } catch {}
      }
    }
  } catch (e) {
    appendLog(`globalTeardown: closing child stdout/stderr streams failed: ${e && e.message}`);
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

  // Short grace period: allow OS to fully close sockets and for any
  // asynchronous cleanup to complete before Jest's final open-handle
  // detection runs. Then attempt one more best-effort cleanup pass.
  try {
    await new Promise((r) => setTimeout(r, 150));
  } catch {}
  try {
    try {
      const rh2 = require('./helpers/request-helper');
      if (rh2 && typeof rh2._forceCloseTemporaryServers === 'function') {
        appendLog('globalTeardown: final force-closing temporary servers');
        try {
          await rh2._forceCloseTemporaryServers();
          appendLog('globalTeardown: final temporary servers closed');
        } catch (e) {
          appendLog(`globalTeardown: final _forceCloseTemporaryServers error: ${e && e.message}`);
        }
      }
    } catch {}
  } catch {}

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
>>>>>>> origin/feat/wiring-agent
};
