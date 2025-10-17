const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');
const secretFilePath = path.resolve(__dirname, 'webhook.secret');

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
  const logFile = path.resolve(__dirname, 'globalSetup.log');
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  function logLine(...parts) {
    const line = `[${new Date().toISOString()}] ${parts.join(' ')}\n`;
    logStream.write(line);
  }

  logLine('globalSetup: starting; webhookDir=', webhookDir);

  let secretPlain = '';
  if (fs.existsSync(secretFilePath)) {
    secretPlain = fs.readFileSync(secretFilePath, 'utf8').trim();
    logLine(
      'globalSetup: using persisted secret file',
      secretFilePath,
      'len=',
      String(secretPlain.length)
    );
  } else {
    // existing vault read logic that sets secretPlain...
  }

  // spawn server
  const child = spawn('npm', ['start'], {
    cwd: webhookDir,
    env: { ...process.env, WEBHOOK_API_KEY: secretPlain },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // pipe stdout/stderr to log (unchanged)
  child.stdout.on('data', (d) =>
    logStream.write(`[SERVER STDOUT ${new Date().toISOString()}] ${d}`)
  );
  child.stderr.on('data', (d) =>
    logStream.write(`[SERVER STDERR ${new Date().toISOString()}] ${d}`)
  );
  child.on('error', (e) => logLine('globalSetup: spawn error:', e.message));
  child.on('exit', (code, sig) =>
    logLine('globalSetup: server exited', `code=${code}`, `sig=${sig}`)
  );
  // save PID for teardown
  const pidFile = path.resolve(__dirname, 'webhook.pid');
  fs.writeFileSync(pidFile, String(child.pid), 'utf8');
  logLine('globalSetup: wrote pid', child.pid);

  // detach and keep log open
  child.unref();

  // wait for server to accept connections
  try {
    await waitForPort(Number(process.env.PORT || 3000), 10000);
    logLine('globalSetup: port is open');
  } catch (err) {
    logLine('globalSetup: port did not open in time:', err.message);
    logStream.end();
    throw err;
  }

  // leave log open for teardown to append
  // do NOT call logStream.end() here; globalTeardown will append and then cleanup.
};
