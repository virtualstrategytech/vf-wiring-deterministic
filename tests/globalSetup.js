const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

const secretFilePath = path.resolve(__dirname, 'webhook.secret');
const pidFilePath = path.resolve(__dirname, 'webhook.pid');
const logFilePath = path.resolve(__dirname, 'globalSetup.log');
const portFilePath = path.resolve(__dirname, 'webhook.port');
const childStdoutPath = path.resolve(__dirname, 'webhook.child.stdout.log');
const childStderrPath = path.resolve(__dirname, 'webhook.child.stderr.log');
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
// Wait for the webhook readiness endpoint (/ready) to return 200.
function waitForReady(port, timeout = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function tryReq() {
      const opts = {
        hostname: '127.0.0.1',
        port: port,
        path: '/ready',
        method: 'GET',
        timeout: 1000,
      };
      const req = http.request(opts, (res) => {
        if (res.statusCode === 200) {
          res.destroy();
          return resolve();
        }
        // consume and retry
        res.on('data', () => {});
        res.on('end', () => {
          if (Date.now() - start > timeout) return reject(new Error('timeout'));
          setTimeout(tryReq, 200);
        });
      });
      req.on('error', () => {
        if (Date.now() - start > timeout) return reject(new Error('timeout'));
        setTimeout(tryReq, 200);
      });
      req.on('timeout', () => {
        req.destroy();
        if (Date.now() - start > timeout) return reject(new Error('timeout'));
        setTimeout(tryReq, 200);
      });
      req.end();
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

  // If running inside GitHub Actions and the job is NOT explicitly asking
  // to spawn a child-process server, assume the workflow's Start webhook
  // step started the server. Wait briefly for the port to be ready and
  // then return without spawning a local child to avoid duplicate servers.
  // When `USE_CHILD_PROCESS_SERVER=1` is set (used by some CI jobs), do
  // not take this early-return path so the job can spawn its own server.
  if (process.env.GITHUB_ACTIONS === 'true' && process.env.USE_CHILD_PROCESS_SERVER !== '1') {
    const actionPort = Number(process.env.PORT || 3000);
    try {
      await waitForReady(actionPort, 20000);
      logLine('globalSetup: running on GitHub Actions; server ready on port', actionPort);
    } catch (e) {
      // fallback to raw port check if readiness endpoint isn't present or reachable
      try {
        await waitForPort(actionPort, 20000);
        logLine('globalSetup: running on GitHub Actions; port open on', actionPort);
      } catch (e2) {
        logLine(
          'globalSetup: running on GitHub Actions but no server detected on port',
          actionPort
        );
      }
    }
    try {
      logStream.end();
    } catch {}
    return;
  }
  // When running on GitHub Actions with USE_CHILD_PROCESS_SERVER=1 we want
  // the test job to spawn the webhook locally. Log that decision so CI
  // artifacts show why we proceeded to spawn a child.
  if (process.env.GITHUB_ACTIONS === 'true' && process.env.USE_CHILD_PROCESS_SERVER === '1') {
    logLine(
      'globalSetup: GITHUB_ACTIONS=true and USE_CHILD_PROCESS_SERVER=1; will spawn local child server'
    );
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
    await waitForReady(port, 5000);
    logLine('globalSetup: remote server already ready on port', port);
    try {
      logStream.end();
    } catch {}
    return;
  } catch (e) {
    // fallback to raw TCP port check
    try {
      await waitForPort(port, 5000);
      logLine('globalSetup: remote server accepting TCP on port', port);
      try {
        logStream.end();
      } catch {}
      return;
    } catch (e2) {
      logLine('globalSetup: no server on port', port, '- will spawn local child');
    }
  }

  // Proceed to spawn server locally (without interactive secret sync)
  const nodeCmd = process.execPath || (process.platform === 'win32' ? 'node.exe' : 'node');
  const serverFile = path.join(webhookDir, 'server.js');

  let child;
  try {
    logLine('globalSetup: spawning webhook via', nodeCmd, serverFile);
    // Default: capture stdout/stderr so local devs can inspect server logs.
    // On GitHub Actions we avoid creating persistent pipe WriteStreams
    // that can show up as lingering handles; use `ignore` for CI runners.
    const spawnOptions = {
      cwd: webhookDir,
      env: {
        ...process.env,
        WEBHOOK_API_KEY: secretPlain,
        PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    };
    try {
      if (process.env.GITHUB_ACTIONS === 'true') {
        logLine(
          'globalSetup: GITHUB_ACTIONS=true; spawning child with stdio ignored to avoid lingering pipes'
        );
        spawnOptions.stdio = ['ignore', 'ignore', 'ignore'];
      }
    } catch {
      // ignore
    }

    child = spawn(nodeCmd, [serverFile], spawnOptions);
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

      // write port so tests (or teardown) can discover which port we're using
      try {
        fs.writeFileSync(portFilePath, String(port), 'utf8');
        logLine('globalSetup: wrote port file to', portFilePath, 'port=', port);
      } catch (e) {
        logLine('globalSetup: failed to write port file:', e && e.message);
      }

      // pipe child's stdout/stderr to repo-level and per-run files for CI artifact collection
      try {
        const repoServerLog = path.resolve(repoRoot, 'server.log');
        const serverLogStream = fs.createWriteStream(repoServerLog, { flags: 'a' });
        const stdoutStream = fs.createWriteStream(childStdoutPath, { flags: 'a' });
        const stderrStream = fs.createWriteStream(childStderrPath, { flags: 'a' });
        if (child.stdout) {
          child.stdout.pipe(serverLogStream);
          child.stdout.pipe(stdoutStream);
        }
        if (child.stderr) {
          child.stderr.pipe(serverLogStream);
          child.stderr.pipe(stderrStream);
        }
        child.on('exit', (code, signal) => {
          logLine('globalSetup: child exited code=', code, 'signal=', signal);
          try {
            stdoutStream.end();
            stderrStream.end();
          } catch {}
        });
      } catch (e) {
        logLine('globalSetup: failed to pipe child stdout/stderr:', e && e.message);
      }

      // allow the child to continue running independently
      try {
        if (typeof child.unref === 'function') child.unref();
      } catch {}

      // Wait longer and with retries for CI flakiness
      try {
        await waitForReady(port, 30000);
        logLine('globalSetup: spawned child server is ready on', port);
      } catch (e) {
        // fallback to raw TCP port detection with extended timeout
        try {
          await waitForPort(port, 30000);
          logLine('globalSetup: spawned child server is accepting connections on', port);
        } catch (e2) {
          logLine('globalSetup: spawned child did not open port within timeout');
          throw e2;
        }
      }
    } catch (err) {
      logLine('globalSetup: spawned child did not open port in time:', err && err.message);
      // if server didn't start, attempt to kill child and fail
      try {
        if (typeof child.kill === 'function') child.kill('SIGTERM');
      } catch {}
      throw err;
    }
  }

  // Spawn a lightweight prompt mock child so tests have a deterministic
  // prompt service available at a known URL (avoids ECONNREFUSED in CI).
  try {
    const promptPidFile = path.resolve(__dirname, 'prompt-mock.pid');
    const promptInfoFile = path.resolve(__dirname, 'prompt-mock.json');
    const promptPort = Number(process.env.PROMPT_MOCK_PORT || 3001);
    // Prefer the fixed prompt mock child if present (helps avoid accidental
    // markdown-wrapped files). Fall back to the original file for backwards
    // compatibility.
    let promptScript = path.join(__dirname, 'prompt-mock-child-fixed.js');
    if (!fs.existsSync(promptScript)) {
      promptScript = path.join(__dirname, 'prompt-mock-child.js');
    }
    // Spawn prompt-mock unless PROMPT_URL was explicitly provided and not
    // equal to the default local prompt host. This covers cases where the
    // environment already set PROMPT_URL (deployed smoke tests) and avoids
    // overriding it.
    if (!process.env.PROMPT_URL || process.env.PROMPT_URL === 'http://127.0.0.1:3000') {
      try {
        logLine('globalSetup: spawning prompt-mock child on port', promptPort);
        // Capture stdout/stderr to small files so spawn errors are visible
        // in CI artifacts. Use pipes locally but keep CI-friendly defaults.
        const promptStdout = path.resolve(__dirname, 'prompt-mock.child.stdout.log');
        const promptStderr = path.resolve(__dirname, 'prompt-mock.child.stderr.log');
        const spawnOpts = {
          cwd: process.cwd(),
          env: { ...process.env, PORT: String(promptPort), PROMPT_MOCK_PORT: String(promptPort) },
          stdio: ['ignore', 'pipe', 'pipe'],
        };
        const p = spawn(nodeCmd, [promptScript], spawnOpts);
        // If we have child stdout/stderr streams, pipe them to files for artifact collection
        try {
          if (p && p.stdout) {
            const outStream = fs.createWriteStream(promptStdout, { flags: 'a' });
            p.stdout.pipe(outStream);
          }
          if (p && p.stderr) {
            const errStream = fs.createWriteStream(promptStderr, { flags: 'a' });
            p.stderr.pipe(errStream);
          }
        } catch (e) {
          logLine('globalSetup: failed to pipe prompt-mock child stdio:', e && e.message);
        }
        if (p && p.pid) {
          try {
            fs.writeFileSync(promptPidFile, String(p.pid), 'utf8');
          } catch {}
          try {
            if (typeof p.unref === 'function') p.unref();
          } catch {}
          logLine('globalSetup: prompt-mock spawned pid=', p.pid);

          // Wait for the prompt mock to open its port and write info file
          try {
            await waitForPort(promptPort, 5000);
            const url = `http://127.0.0.1:${promptPort}`;
            // Write prompt info atomically: write to temp then rename
            try {
              const tmp = `${promptInfoFile}.tmp`;
              fs.writeFileSync(tmp, JSON.stringify({ url }), 'utf8');
              try {
                fs.renameSync(tmp, promptInfoFile);
              } catch (e) {
                // fallback to direct write
                fs.writeFileSync(promptInfoFile, JSON.stringify({ url }), 'utf8');
              }
            } catch (e) {
              logLine('globalSetup: failed to write prompt info file:', e && e.message);
            }
            try {
              process.env.PROMPT_URL = url;
            } catch {}
            logLine('globalSetup: prompt-mock ready at', url);
          } catch (e) {
            logLine('globalSetup: prompt-mock did not open port in time:', e && e.message);
          }
        }
      } catch (e) {
        logLine('globalSetup: failed to spawn prompt-mock child:', e && e.message);
      }
    } else {
      // If a PROMPT_URL was provided externally, persist it for jest.setup to
      // consume so tests can rely on a consistent source.
      try {
        const info = { url: process.env.PROMPT_URL };
        try {
          fs.writeFileSync(
            path.resolve(__dirname, 'prompt-mock.json'),
            JSON.stringify(info),
            'utf8'
          );
        } catch {}
      } catch {}
    }
  } catch (e) {
    logLine('globalSetup: prompt-mock setup failed:', e && e.message);
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
