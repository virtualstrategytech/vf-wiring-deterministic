const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

module.exports = async () => {
  const pidFile = path.resolve(__dirname, 'webhook.pid');
  if (!fs.existsSync(pidFile)) return;
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  if (!pid) {
    try {
      fs.unlinkSync(pidFile);
    } catch {}
    return;
  }

  try {
    process.kill(pid);
  } catch {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F']);
    }
  }

  try {
    fs.unlinkSync(pidFile);
  } catch {}
};
