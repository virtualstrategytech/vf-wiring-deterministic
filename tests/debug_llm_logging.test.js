// Ensure env is set before requiring the server so module-level flags are evaluated correctly
process.env.WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY || 'test123';
process.env.NODE_ENV = 'development';
process.env.DEBUG_WEBHOOK = 'true';
process.env.PROMPT_URL = process.env.PROMPT_URL || 'http://example.local/prompt';

// Mock global fetch so the server's fetchWithTimeout receives a predictable payload
globalThis.fetch = async (url, opts) => {
  // Simulate a Response-like object used by fetchWithTimeout
  const payload = {
    summary: 'Test summary',
    needs_clarify: false,
    followup_question: '',
    debug_meta: 'sensitive-llm-output',
  };
  return {
    ok: true,
    status: 200,
    clone: () => ({ text: async () => JSON.stringify(payload) }),
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  };
};

const http = require('http');
const app = require('../novain-platform/webhook/server');

async function captureConsoleAsync(action) {
  const logs = { out: [], err: [] };
  const origLog = console.log;
  const origInfo = console.info;
  const origError = console.error;
  console.log = (...args) => logs.out.push(args.join(' '));
  console.info = (...args) => logs.out.push(args.join(' '));
  console.error = (...args) => logs.err.push(args.join(' '));
  try {
    await action();
    return logs;
  } finally {
    console.log = origLog;
    console.info = origInfo;
    console.error = origError;
  }
}

describe('llm payload logging when DEBUG_WEBHOOK=true', () => {
  jest.setTimeout(20000);
  let server;
  let port;

  beforeAll(async () => {
    server = app.listen(0);
    try {
      server.keepAliveTimeout = 0;
      server.on('connection', (sock) => {
        try {
          sock.unref();
        } catch {}
      });
    } catch {}
    if (server.unref) server.unref();
    await new Promise((resolve) => server.once('listening', resolve));
    port = server.address().port;
  });

  afterAll(async () => {
    if (server && server.close) {
      await new Promise((resolve) => {
        try {
          server.close(() => resolve());
        } catch {
          resolve();
        }
      });
      if (server.removeAllListeners) server.removeAllListeners();
      try {
        server = null;
      } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
  });

  it('logs llm payload snippet when enabled', async () => {
    const logs = await captureConsoleAsync(async () => {
      const resp = await postJson(
        `http://localhost:${port}/webhook`,
        { action: 'llm_elicit', question: 'Q', tenantId: 't' },
        { 'x-api-key': process.env.WEBHOOK_API_KEY }
      );
      expect(resp.status).toBeGreaterThanOrEqual(200);
      expect(resp.status).toBeLessThan(300);
    });

    const combined = logs.out.join('\n') + '\n' + logs.err.join('\n');
    expect(combined.includes('llm payload snippet:')).toBe(true);
  });
});

function postJson(url, body, headers = {}, timeout = 5000) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const data = JSON.stringify(body);
      const options = {
        method: 'POST',
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        agent: false,
        headers: Object.assign(
          {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
            Connection: 'close',
          },
          headers
        ),
      };

      const req = http.request(options, (res) => {
        clearTimeout(timer);
        let chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const text = Buffer.concat(chunks).toString();
            let json;
            try {
              json = text.length ? JSON.parse(text) : undefined;
            } catch {
              json = text;
            }
            resolve({ status: res.statusCode, data: json });
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('error', (err) => {
        clearTimeout(timer);
        try {
          req.destroy();
        } catch {}
        reject(err);
      });

      const timer = setTimeout(() => {
        try {
          req.destroy();
        } catch {}
        reject(new Error('timeout'));
      }, timeout);

      req.write(data);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}
