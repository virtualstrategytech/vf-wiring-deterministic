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

  if (!fs.existsSync(pidFile)) {
    appendLog('globalTeardown: pid file not found; nothing to kill');
    return;
  }
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  if (!pid) {
    appendLog('globalTeardown: invalid pid; cleaning pid file');
    try {
      fs.unlinkSync(pidFile);
    } catch {}
    return;
  }

  appendLog(`globalTeardown: killing pid ${pid}`);
  try {
    process.kill(pid);
    appendLog(`globalTeardown: process.kill(${pid}) succeeded`);
  } catch (e) {
    appendLog(`globalTeardown: process.kill failed: ${e.message}; trying taskkill`);
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F']);
      appendLog('globalTeardown: taskkill invoked');
    }
  }

  try {
    fs.unlinkSync(pidFile);
    appendLog('globalTeardown: pid file removed');
  } catch (e) {
    appendLog(`globalTeardown: failed to remove pid file: ${e.message}`);
  }
  appendLog('globalTeardown: finished');
};
