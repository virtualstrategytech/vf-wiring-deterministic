/*
 * In-process tests for the webhook Express app.
 * These tests import the exported `app` from novain-platform/webhook/server.js
 * and exercise a couple of endpoints without binding a network port.
 */

const { Readable } = require('stream');

// lightweight in-process dispatcher that calls the Express app function
// directly without creating a real HTTP server. This avoids any listen/
// native handles and keeps tests fully in-process.
const dispatch = (app, { method = 'GET', path = '/', headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    try {
      const req = new Readable({ read() {} });
      req.method = method;
      req.url = path;
      req.headers = Object.assign({}, headers);
      // simple body push for JSON payloads
      if (body !== undefined && body !== null) {
        const s = typeof body === 'string' ? body : JSON.stringify(body);
        // inform body length for express.json body-parser
        try {
          req.headers['content-length'] = Buffer.byteLength(s).toString();
        } catch {}
        req.push(s);
      }
      req.push(null);

      // If the test-runner disabled the body parser, supply req.body directly
      // so handlers still receive the expected parsed payload.
      if (process.env.SKIP_BODY_PARSER === '1' || process.env.SKIP_BODY_PARSER === 'true') {
        try {
          req.body = typeof body === 'string' ? JSON.parse(body) : body;
        } catch {
          req.body = body;
        }
      }
      const headersOut = {};
      let statusCode = 200;
      const chunks = [];
      const res = {
        setHeader(name, value) {
          headersOut[String(name).toLowerCase()] = value;
        },
        getHeader(name) {
          return headersOut[String(name).toLowerCase()];
        },
        write(chunk) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        },
        end(chunk) {
          if (chunk) this.write(chunk);
          const bodyBuf = Buffer.concat(chunks);
          const text = bodyBuf.toString('utf8');
          const ct = headersOut['content-type'] || '';
          let parsed = null;
          if (ct.includes('application/json')) {
            try {
              parsed = JSON.parse(text);
            } catch {}
          }
          resolve({ status: statusCode, headers: headersOut, text, body: parsed || text });
        },
        writeHead(code) {
          statusCode = code;
        },
        status(code) {
          statusCode = code;
          return this;
        },
        json(obj) {
          const s = JSON.stringify(obj);
          this.setHeader('content-type', 'application/json');
          this.end(s);
        },
        send(v) {
          if (typeof v === 'object') return this.json(v);
          this.end(String(v));
        },
      };

      // express may call res.writeHead before handlers return; ensure methods present
      try {
        app(req, res);
      } catch (err) {
        try {
          // if app is an http.Server, use its handle
          if (app && typeof app.handle === 'function') {
            app.handle(req, res);
          } else {
            reject(err);
          }
        } catch (err2) {
          reject(err2 || err);
        }
      }
    } catch (e) {
      reject(e);
    }
  });

// Do not monkey-patch supertest internals here; tests will use supertest
// directly against the Express `app` which avoids creating real listening
// servers and related native handles.
// Instrument http.Server.listen to capture any callback functions passed in by libraries
// Note: removed http.Server.listen instrumentation — it can bias open-handle
// reporting by making the test-runner point at our wrapper. We now rely on
// async_hooks and socket-level instrumentation in `tests/jest.setup.js`.

describe('Webhook (in-process)', () => {
  // Ensure environment is set before requiring the app so the module picks up the API key.
  beforeAll(() => {
    process.env.WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY || 'test123';
    process.env.DEBUG_TESTS = 'true';
    // Avoid mounting body-parser/raw-body during these in-process tests which
    // can create retained closures flagged by Jest detectOpenHandles.
    process.env.SKIP_BODY_PARSER = '1';
    // Clear module cache so requiring the server picks up the env vars above
    jest.resetModules();
    // Defensive: destroy any existing global agents early so modules that create keep-alive sockets
    // later won't keep the process alive during tests. Doing this in beforeAll reduces race conditions.
    try {
      const http = require('http');
      const https = require('https');
      if (http && http.globalAgent && typeof http.globalAgent.destroy === 'function') {
        try {
          http.globalAgent.destroy();
        } catch {}
      }
      if (https && https.globalAgent && typeof https.globalAgent.destroy === 'function') {
        try {
          https.globalAgent.destroy();
        } catch {}
      }
    } catch {}
  });

  afterAll(() => {
    delete process.env.WEBHOOK_API_KEY;
    delete process.env.DEBUG_TESTS;
    delete process.env.SKIP_BODY_PARSER;
    jest.resetModules();
  });

  // Defensive cleanup: destroy global HTTP/HTTPS agents to avoid Jest open-handle warnings
  afterAll(async () => {
    try {
      const http = require('http');
      const https = require('https');
      if (http && http.globalAgent && typeof http.globalAgent.destroy === 'function') {
        http.globalAgent.destroy();
      }
      if (https && https.globalAgent && typeof https.globalAgent.destroy === 'function') {
        https.globalAgent.destroy();
      }
      // give the runtime a moment to let any pending socket closures complete
      await new Promise((r) => setTimeout(r, 50));
    } catch {}
  });

  // Use supertest directly against the Express app to avoid binding/listening
  // a real network port. This avoids creating internal listen-related handles
  // that some Node versions report as bound anonymous functions to Jest.
  const getApp = () => {
    jest.resetModules();
    // require the server module which should export the Express `app` or a
    // createServer helper; prefer the app when possible so supertest can
    // exercise handlers directly without starting a real listener.
    const mod = require('../novain-platform/webhook/server');
    // If module exports an app directly use it; otherwise if it exports
    // createServer(), return the underlying app function.
    if (mod && typeof mod === 'function') return mod;
    if (mod && typeof mod.createServer === 'function') {
      const s = mod.createServer();
      // extract Express app if available
      return s && s.listeners && typeof s.listen !== 'function' ? s : mod;
    }
    return mod;
  };

  test('GET /health returns ok', async () => {
    const app = getApp();
    const res = await dispatch(app, { method: 'GET', path: '/health' });
    expect(res.status).toBe(200);
    expect(
      String(res.text || '')
        .trim()
        .toLowerCase()
    ).toBe('ok');
  });

  test('POST /webhook ping responds with reply', async () => {
    const app = getApp();
    const body = { action: 'ping', question: 'hello', name: 'Tester', tenantId: 'default' };
    const API_KEY = process.env.WEBHOOK_API_KEY || 'test123';
    const res = await dispatch(app, {
      method: 'POST',
      path: '/webhook',
      headers: { 'x-api-key': API_KEY, 'content-type': 'application/json' },
      body,
    });
    expect(res.status).toBe(200);
    const json = res.body;
    expect(json).toBeDefined();
    expect(json.ok).toBe(true);
    expect(json.reply).toMatch(/Hi Tester/);
  });

  // Temporary debug: dump active handles at the end of this test file to help locate lingering handles
  afterAll(() => {
    try {
      if (typeof process._getActiveHandles === 'function') {
        try {
          const handles = process._getActiveHandles() || [];
          try {
            console.warn('DEBUG: active handles summary:');
          } catch {}
          handles.forEach((h, i) => {
            try {
              const name = h && h.constructor && h.constructor.name;
              const s = String(h || '').slice(0, 400);
              try {
                console.warn(`  [${i}] type=${String(name)} str=${s}`);
              } catch {}
            } catch (e) {
              try {
                console.warn('  [err printing handle]', e && e.stack);
              } catch {}
            }
          });
        } catch (e) {
          try {
            console.warn('DEBUG dump failed', e && e.stack);
          } catch {}
        }
      }
    } catch (e) {
      try {
        console.warn('DEBUG dump failed', e && e.stack);
      } catch {}
    }
    // Also print any Server.listen callbacks we captured during the run
    try {
      const cbs = global.__test_listen_callbacks || [];
      try {
        try {
          console.warn('DEBUG: captured listen callbacks count =', cbs.length);
        } catch {}
        cbs.forEach((cb, idx) => {
          try {
            const stack =
              cb && cb._createdStack
                ? cb._createdStack.split('\n').slice(0, 10).join('\n')
                : String(cb).slice(0, 400);
            try {
              console.warn(`  listen-cb[${idx}]: ${stack}`);
            } catch {}
          } catch (e) {
            try {
              console.warn(`  listen-cb[${idx}]: <err printing>`, e && e.stack);
            } catch {}
          }
        });
      } catch (e) {
        try {
          console.warn('DEBUG listen-callback dump failed', e && e.stack);
        } catch {}
      }
    } catch (e) {
      try {
        console.warn('DEBUG listen-callback dump failed', e && e.stack);
      } catch {}
    }
  });
});
