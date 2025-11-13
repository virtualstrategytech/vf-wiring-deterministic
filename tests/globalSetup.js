const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');

const secretFilePath = path.resolve(__dirname, 'webhook.secret');
const pidFilePath = path.resolve(__dirname, 'webhook.pid');
const logFilePath = path.resolve(__dirname, 'globalSetup.log');
// Utility: wait for a TCP port to be accepting connections.
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
    try {
      logStream.write(line);
    } catch {
      // ignore write failures in constrained environments
    }
  }

  logLine('globalSetup: starting; webhookDir=', webhookDir);

  // If running inside GitHub Actions, assume the workflow's Start webhook
  // step started the server. Wait briefly for the port to be ready and
  // then return without spawning a local child to avoid duplicate servers.
  if (process.env.GITHUB_ACTIONS === 'true') {
    const actionPort = Number(process.env.PORT || 3000);
    try {
      await waitForPort(actionPort, 20000);
      logLine('globalSetup: running on GitHub Actions; server detected on port', actionPort);
    } catch (e) {
      logLine('globalSetup: running on GitHub Actions but no server detected on port', actionPort);
    }
    try {
      logStream.end();
    } catch {}
    return;
  }

  // Resolve API key: prefer explicit env -> secret file (if present) -> generated fallback
  // Note: when running in CI/with SKIP_SYNC_SECRET we avoid interactive sync
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
    // Non-sensitive local fallback when no secret provided
    secretPlain = 'test123';
    logLine('globalSetup: using default test API key');
  }

  // Wait for server to accept connections — if a server is already running
  // (e.g. CI workflow started it), we don't spawn another. If no server is
  // listening, spawn one as a child process so tests can run locally with
  // CI-like settings (SKIP_SYNC_SECRET=true).
  const port = Number(process.env.PORT || 3000);
  try {
    await waitForPort(port, 5000);
    logLine('globalSetup: remote server already listening on port', port);
    try {
      logStream.end();
    } catch {}
    return;
  } catch (e) {
    logLine('globalSetup: no server on port', port, '- will spawn local child');
  }

  // Proceed to spawn server locally (without interactive secret sync)
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
        PORT: String(port),
      },
      // capture stdout/stderr so CI and local devs can inspect server logs
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    logLine('globalSetup: failed to spawn node directly:', e.message);
  }

  // If we spawned a child, wait for the server to accept connections
  if (child && child.pid) {
    try {
      // write pid so globalTeardown can find and kill the process
      try {
        fs.writeFileSync(pidFilePath, String(child.pid), 'utf8');
        logLine('globalSetup: wrote pid to', pidFilePath, 'pid=', child.pid);
      } catch (e) {
        logLine('globalSetup: failed to write pid file:', e && e.message);
      }

      // pipe child's stdout/stderr to a repo-level server.log for CI artifact collection
      try {
        const repoServerLog = path.resolve(repoRoot, 'server.log');
        const serverLogStream = fs.createWriteStream(repoServerLog, { flags: 'a' });
        if (child.stdout) child.stdout.pipe(serverLogStream);
        if (child.stderr) child.stderr.pipe(serverLogStream);
      } catch (e) {
        logLine('globalSetup: failed to pipe child stdout/stderr:', e && e.message);
      }

      // allow the child to continue running independently
      try {
        if (typeof child.unref === 'function') child.unref();
      } catch {}
      await waitForPort(port, 20000);
      logLine('globalSetup: spawned child server is accepting connections on', port);
    } catch (err) {
      logLine('globalSetup: spawned child did not open port in time:', err && err.message);
      // if server didn't start, attempt to kill child and fail
      try {
        if (typeof child.kill === 'function') child.kill('SIGTERM');
      } catch {}
      throw err;
    }
  }

  // Close the log stream now to avoid leaving an open file handle that
  // keeps the Node process alive. globalTeardown will append via
  // synchronous fs operations when it runs.
  try {
    logStream.end();
  } catch {
    // ignore
  }
};
