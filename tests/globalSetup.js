const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');

const secretFilePath = path.resolve(__dirname, 'webhook.secret');
const pidFilePath = path.resolve(__dirname, 'webhook.pid');
const logFilePath = path.resolve(__dirname, 'globalSetup.log');

function waitForPort(port, timeout = 30000) {
  // increased default timeout
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

  const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
  function logLine(...parts) {
    const line = `[${new Date().toISOString()}] ${parts.join(' ')}\n`;
    logStream.write(line);
  }

  logLine('globalSetup: starting; webhookDir=', webhookDir);

  // Resolve API key: prefer explicit env -> secret file -> generate & persist fallback
  let secretPlain = process.env.WEBHOOK_API_KEY || '';
  if (!secretPlain && fs.existsSync(secretFilePath)) {
    try {
      secretPlain = fs.readFileSync(secretFilePath, 'utf8').trim();
      logLine('globalSetup: read secret from', secretFilePath, 'len=', String(secretPlain.length));
    } catch (e) {
      logLine('globalSetup: failed reading secret file:', e.message);
    }
  }

  if (!secretPlain) {
    secretPlain = `test-${crypto.randomBytes(8).toString('hex')}`;
    try {
      fs.writeFileSync(secretFilePath, secretPlain, { encoding: 'utf8', flag: 'w' });
      logLine(
        'globalSetup: wrote generated secret to',
        secretFilePath,
        'len=',
        String(secretPlain.length)
      );
    } catch (e) {
      logLine('globalSetup: failed writing secret file:', e.message);
    }
  }

  // Prefer spawning node directly (more reliable than npm in some environments)
  const nodeCmd = process.execPath || (process.platform === 'win32' ? 'node.exe' : 'node');
  const serverFile = path.join(webhookDir, 'server.js');

  let child;
  try {
    logLine('globalSetup: spawning webhook via', nodeCmd, serverFile);
    child = spawn(nodeCmd, [serverFile], {
      cwd: webhookDir,
      env: {
        ...process.env,
        WEBHOOK_API_KEY: secretPlain,
        PORT: String(process.env.PORT || '3000'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    logLine('globalSetup: failed to spawn node directly:', e.message);
  }

  // fallback to npm start if node spawn didn't create a child with pid
  if (!child || !child.pid) {
    try {
      logLine('globalSetup: falling back to npm start');
      child = spawn('npm', ['start'], {
        cwd: webhookDir,
        env: {
          ...process.env,
          WEBHOOK_API_KEY: secretPlain,
          PORT: String(process.env.PORT || '3000'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      logLine('globalSetup: failed to spawn npm start:', e.message);
    }
  }

  if (child) {
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

    // Persist PID for globalTeardown to kill
    try {
      fs.writeFileSync(pidFilePath, String(child.pid), 'utf8');
      logLine('globalSetup: wrote pid', child.pid);
    } catch (e) {
      logLine('globalSetup: failed to write pid file:', e.message);
    }

    try {
      child.unref();
    } catch {}
  } else {
    logLine('globalSetup: no child process could be spawned');
  }

  // Wait for server to accept connections
  const port = Number(process.env.PORT || 3000);
  try {
    await waitForPort(port, 20000);
    logLine('globalSetup: port is open', port);
  } catch (err) {
    logLine('globalSetup: port did not open in time:', err.message);
    logStream.end();
    throw err;
  }

  // leave logStream open for globalTeardown to append/close
};
