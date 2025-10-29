const serverHelper = require('./server-helper');
const fetch = require('node-fetch');
const http = require('http');
const https = require('https');

async function requestApp(
  app,
  { method = 'post', path = '/', body, headers = {}, timeout = 5000 } = {}
) {
  // If app is a string base URL, use node-fetch directly.
  if (typeof app === 'string') {
    // Defensive: normalize base by stripping any trailing slashes so callers
    // that accidentally include a trailing '/' (or environment values) don't
    // produce URLs with '//' which can lead to 404s like `//health`.
    const base = (app || '').replace(/\/+$/, '');
    const url = `${base}${path}`;
    // provide a clearer error when an invalid/empty base is supplied
    // parse the URL once and reuse the parsed object below (was previously
    // calling `new URL(url)` without storing it, then referencing `u` which
    // caused a ReferenceError).
    let u;
    try {
      u = new URL(url);
    } catch {
      throw new Error(`requestApp: invalid URL constructed from base: ${String(app)}`);
    }
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), timeout || 5000);
    // use a per-request agent (no keepAlive) so node-fetch does not reuse sockets
    const agent =
      u.protocol === 'https:'
        ? new https.Agent({ keepAlive: false })
        : new http.Agent({ keepAlive: false });
    // Tag sockets created by this per-request agent with a creation stack so
    // diagnostics can map them back to the call site.
    let _origCreate;
    try {
      if (agent && typeof agent.createConnection === 'function') {
        _origCreate = agent.createConnection.bind(agent);
        agent.createConnection = function createPerRequestAgentConnection(options, callback) {
          const sock = _origCreate(options, callback);
          try {
            sock._createdStack = new Error('per-request-agent-created').stack;
          } catch {}
          try {
            // Per-request agent socket creation can be noisy. Print only when
            // DEBUG_TESTS is enabled and the verbosity level is >=2.
            const verbose = Number(process.env.DEBUG_TESTS_LEVEL || '0') >= 2;
            if (process.env.DEBUG_TESTS && verbose) {
              try {
                const preview =
                  (sock && sock._createdStack && sock._createdStack.split('\n').slice(0, 6)) || [];
                console.warn('DEBUG_TESTS: per-request agent socket created at:');
                preview.forEach((ln) => console.warn(`  ${String(ln).trim()}`));
              } catch {}
            }
          } catch {}
          try {
            const verbose = Number(process.env.DEBUG_TESTS_LEVEL || '0') >= 2;
            if (process.env.DEBUG_TESTS && verbose) {
              try {
                // Print the creation stack immediately for reliable CI capture
                console.warn(new Error('per-request-agent-created').stack);
              } catch {}
            }
          } catch {}
          return sock;
        };
      }
    } catch {}
    try {
      const resp = await fetch(url, {
        method: method.toUpperCase(),
        // explicitly close connections to avoid keep-alive sockets lingering in CI
        headers: Object.assign(
          { 'Content-Type': 'application/json', Connection: 'close' },
          headers || {}
        ),
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        agent,
      });
      const text = await resp.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
      // ensure any response body streams are destroyed to avoid lingering sockets
      try {
        if (resp && resp.body && typeof resp.body.destroy === 'function') {
          try {
            resp.body.destroy();
          } catch {}
        }
      } catch {}
      return { status: resp.status, headers: resp.headers.raw && resp.headers.raw(), body: parsed };
    } finally {
      clearTimeout(to);
      try {
        // ensure controller is aborted to free any associated request resources
        controller.abort && typeof controller.abort === 'function' && controller.abort();
      } catch {}
      try {
        // restore original createConnection implementation if we monkeypatched it
        try {
          if (
            typeof _origCreate !== 'undefined' &&
            agent &&
            typeof agent.createConnection === 'function'
          ) {
            agent.createConnection = _origCreate;
          }
        } catch {}
      } catch {}
      try {
        if (agent && typeof agent.destroy === 'function') agent.destroy();
      } catch {}
      try {
        // yield to the event loop to allow agent/socket destruction to propagate
        await new Promise((r) => setImmediate(r));
      } catch {}
    }
  }

  // If app looks like an Express app (function with listen), start a
  // controlled ephemeral server and perform a normal HTTP request. This
  // avoids letting supertest create internal servers which can leave
  // bound anonymous handles detected by Jest.
  if (app && typeof app.listen === 'function') {
    // Optional isolated child-process mode: when USE_CHILD_PROCESS_SERVER=1
    // we fork a separate Node process that loads the same `app` and listens
    // there. This isolates any Node-internals (like bound anonymous fns)
    // into the child process so Jest in the parent process doesn't flag
    // them as open handles.
    if (process.env.USE_CHILD_PROCESS_SERVER === '1') {
      const { fork } = require('child_process');
      // Resolve path to our runner module (tests/server-runner.js)
      const runner = require.resolve('../server-runner');
      const child = fork(runner, [], {
        cwd: __dirname + '/../',
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        // make sure the child gets the same environment (including any
        // WEBHOOK_API_KEY or test-specific variables set by the test file)
        env: Object.assign({}, process.env),
      });

      // Forward child stdout/stderr to the parent process console so tests
      // that capture console output (captureConsoleAsync) also see logs
      // emitted by the child server (e.g., llm payload diagnostics).
      try {
        if (child.stdout && typeof child.stdout.on === 'function') {
          child.stdout.on('data', (b) => {
            try {
              console.log(String(b || '').trim());
            } catch {}
          });
        }
        if (child.stderr && typeof child.stderr.on === 'function') {
          child.stderr.on('data', (b) => {
            try {
              console.error(String(b || '').trim());
            } catch {}
          });
        }
      } catch {}

      const portPromise = new Promise((resolve, reject) => {
        let timeoutId;
        const clearGuard = () => {
          try {
            if (timeoutId) clearTimeout(timeoutId);
          } catch {}
        };
        const onMsg = (m) => {
          try {
            if (m && typeof m === 'object' && m.port) {
              clearGuard();
              resolve(m.port);
            }
          } catch {
            // ignore
          }
        };
        child.once('message', onMsg);
        // fallback: if child prints to stdout instead of IPC
        if (child.stdout) {
          const onStdout = (b) => {
            try {
              const s = String(b || '').trim();
              const m = /TEST_SERVER_PORT:(\d+)/.exec(s);
              if (m) {
                clearGuard();
                resolve(Number(m[1]));
              }
            } catch {}
          };
          child.stdout.on('data', onStdout);
        }
        child.once('error', (err) => {
          clearGuard();
          reject(err);
        });
        // guard timeout
        timeoutId = setTimeout(() => {
          try {
            reject(new Error('child server start timeout'));
          } catch {}
        }, 5000);
      });

      const port = await portPromise;
      const base = `http://127.0.0.1:${port}`;
      const close = async () => {
        try {
          // Ask child to shutdown via IPC
          try {
            child.send && child.send('shutdown');
          } catch {}
        } catch {}
        try {
          // Give it a moment and then force kill if still around
          await new Promise((r) => setTimeout(r, 200));
        } catch {}
        try {
          child.kill('SIGTERM');
        } catch {}
      };

      // proceed to make request against child-hosted server
      const controller = new AbortController();
      const to = setTimeout(() => controller.abort(), timeout || 5000);
      const agent = base.startsWith('https://')
        ? new https.Agent({ keepAlive: false })
        : new http.Agent({ keepAlive: false });
      try {
        const resp = await fetch(`${base}${path}`, {
          method: method.toUpperCase(),
          headers: Object.assign(
            { 'Content-Type': 'application/json', Connection: 'close' },
            headers || {}
          ),
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
          agent,
        });
        const text = await resp.text();
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
        try {
          if (resp && resp.body && typeof resp.body.destroy === 'function') resp.body.destroy();
        } catch {}
        return {
          status: resp.status,
          headers: resp.headers.raw && resp.headers.raw(),
          body: parsed,
        };
      } finally {
        clearTimeout(to);
        try {
          controller.abort && typeof controller.abort === 'function' && controller.abort();
        } catch {}
        try {
          if (agent && typeof agent.destroy === 'function') agent.destroy();
        } catch {}
        try {
          // yield to the event loop to allow agent/socket destruction to propagate
          await new Promise((r) => setImmediate(r));
        } catch {}
        try {
          await close();
        } catch {}
      }
    }
    const started = await serverHelper.startTestServer(app);
    // Normalize any trailing slash on the ephemeral server base as well.
    const base = (started.base || '').replace(/\/+$/, '');
    const close = started.close;
    const url = `${base}${path}`;
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), timeout || 5000);
    // per-request agent for ephemeral server requests as well
    const agent = base.startsWith('https://')
      ? new https.Agent({ keepAlive: false })
      : new http.Agent({ keepAlive: false });
    let _origCreate2;
    try {
      if (agent && typeof agent.createConnection === 'function') {
        _origCreate2 = agent.createConnection.bind(agent);
        agent.createConnection = function createPerRequestAgentConnection2(options, callback) {
          const sock = _origCreate2(options, callback);
          try {
            sock._createdStack = new Error('per-request-agent-created').stack;
          } catch {}
          try {
            if (process.env.DEBUG_TESTS) {
              try {
                const preview =
                  (sock && sock._createdStack && sock._createdStack.split('\n').slice(0, 6)) || [];
                console.warn('DEBUG_TESTS: per-request agent socket created at:');
                preview.forEach((ln) => console.warn(`  ${String(ln).trim()}`));
              } catch {}
            }
          } catch {}
          try {
            if (process.env.DEBUG_TESTS) {
              try {
                // Print the creation stack immediately for reliable CI capture
                console.warn(new Error('per-request-agent-created').stack);
              } catch {}
            }
          } catch {}
          return sock;
        };
      }
    } catch {}
    try {
      const resp = await fetch(url, {
        method: method.toUpperCase(),
        // explicitly close connections to avoid keep-alive sockets lingering in CI
        headers: Object.assign(
          { 'Content-Type': 'application/json', Connection: 'close' },
          headers || {}
        ),
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        agent,
      });
      const text = await resp.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
      // ensure any response body streams are destroyed to avoid lingering sockets
      try {
        if (resp && resp.body && typeof resp.body.destroy === 'function') {
          try {
            resp.body.destroy();
          } catch {}
        }
      } catch {}
      return { status: resp.status, headers: resp.headers.raw && resp.headers.raw(), body: parsed };
    } finally {
      clearTimeout(to);
      try {
        // restore original createConnection implementation if we monkeypatched it
        try {
          if (
            typeof _origCreate2 !== 'undefined' &&
            agent &&
            typeof agent.createConnection === 'function'
          ) {
            agent.createConnection = _origCreate2;
          }
        } catch {}
      } catch {}
      try {
        // destroy per-request agent first to prevent connection reuse/pooling
        // from keeping sockets alive while we close the server.
        try {
          if (agent && typeof agent.destroy === 'function') agent.destroy();
        } catch {}
        try {
          // yield to the event loop to allow agent/socket destruction to propagate
          await new Promise((r) => setImmediate(r));
        } catch {}
      } catch {}
      try {
        await close();
      } catch {}
      try {
        // ensure the fetch controller is aborted to free any associated request resources
        controller.abort && typeof controller.abort === 'function' && controller.abort();
      } catch {}
      try {
        if (serverHelper && typeof serverHelper._forceCloseAllSockets === 'function') {
          // allow a tick for server.close to finish, then aggressively sweep
          await new Promise((r) => setImmediate(r));
          serverHelper._forceCloseAllSockets();
        }
      } catch {}
    }
  }

  // For other inputs, fallback to throwing to surface incorrect usage.
  throw new Error('requestApp expects an Express app or a base URL string');
}

module.exports = { requestApp };
