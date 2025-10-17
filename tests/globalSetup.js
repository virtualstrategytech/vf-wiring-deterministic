const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

function waitForPort(port, timeout = 10000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function tryConnect() {
      const sock = new net.Socket();
      sock.setTimeout(500);
      sock.on('connect', () => {
        sock.destroy();
        resolve();
      });
      sock.on('error', () => {
        sock.destroy();
        if (Date.now() - start > timeout) return reject(new Error('timeout'));
        setTimeout(tryConnect, 200);
      });
      sock.on('timeout', () => {
        sock.destroy();
        if (Date.now() - start > timeout) return reject(new Error('timeout'));
        setTimeout(tryConnect, 200);
      });
      sock.connect(port, '127.0.0.1');
    })();
  });
}

module.exports = async () => {
  const repoRoot = path.resolve(__dirname, '..');
  const webhookDir = path.join(repoRoot, 'novain-platform', 'webhook');

  // Read secret from local SecretManagement (Windows PowerShell)
  let secretPlain = '';
  if (process.platform === 'win32') {
    const psCmd = [
      'Import-Module Microsoft.PowerShell.SecretManagement -ErrorAction Stop;',
      '$sec = Get-Secret -Name WEBHOOK_API_KEY -Vault MyLocalVault;',
      '[Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))',
    ].join(' ');
    const execSync = require('child_process').execSync;
    try {
      secretPlain = String(
        execSync(`powershell -NoProfile -NonInteractive -Command "${psCmd.replace(/"/g, '\\"')}"`, {
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      ).trim();
    } catch (err) {
      throw new Error('Could not read WEBHOOK_API_KEY from MyLocalVault: ' + err.message);
    }
  }

  // sanitize: remove non-printable/control chars
  secretPlain = (secretPlain || '').replace(/[^\u0020-\u007E]/g, '').trim();

  if (!secretPlain) {
    throw new Error(
      'WEBHOOK_API_KEY is empty after sanitization. Store the secret in MyLocalVault.'
    );
  }

  // spawn webhook (npm start) with the secret in its env
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const child = spawn(npmCmd, ['start'], {
    cwd: webhookDir,
    env: Object.assign({}, process.env, {
      WEBHOOK_API_KEY: secretPlain,
      PORT: process.env.PORT || '3000',
    }),
    detached: true,
    stdio: 'ignore',
  });

  // save PID for teardown
  fs.writeFileSync(path.resolve(__dirname, 'webhook.pid'), String(child.pid), 'utf8');
  child.unref();

  // wait for port
  await waitForPort(Number(process.env.PORT || 3000), 10000);
};
