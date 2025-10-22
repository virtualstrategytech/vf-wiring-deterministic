// Ensure env is set before requiring the server so module-level flags are evaluated correctly
process.env.WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY || 'test123';
process.env.NODE_ENV = 'development';
process.env.DEBUG_WEBHOOK = 'true';
process.env.PROMPT_URL = process.env.PROMPT_URL || 'http://example.local/prompt';

// Mock global fetch so the server's fetchWithTimeout receives a predictable payload
globalThis.fetch = async () => {
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
  // use supertest to avoid creating a real server (prevents Jest open handles)

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
      // give Node one tick to let any async cleanup settle (helps Jest detect closed handles)
      await new Promise((resolve) => setImmediate(resolve));
    } catch {}
  });

  it('logs llm payload snippet when enabled', async () => {
    const logs = await captureConsoleAsync(async () => {
      const http = require('http');
      // Create an explicit server so we can control lifecycle and avoid
      // supertest/superagent internal listeners keeping the process alive.
      const server = http.createServer(app);
      const sockets = new Set();
      server.on('connection', (sock) => {
        sockets.add(sock);
        sock.on('close', () => sockets.delete(sock));
      });
      await new Promise((resolve) => server.listen(0, resolve));
      if (typeof server.unref === 'function') server.unref();
      const port = server.address().port;
      const postUrl = `http://127.0.0.1:${port}/webhook`;

      function postJson(url, data, opts = {}) {
        return new Promise((resolve, reject) => {
          try {
            const parsed = new URL(url);
            const body = JSON.stringify(data || {});
            const requestOptions = {
              protocol: parsed.protocol,
              hostname: parsed.hostname,
              port: parsed.port,
              path: parsed.pathname + (parsed.search || ''),
              method: 'POST',
              headers: Object.assign(
                {
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(body),
                },
                opts.headers || {}
              ),
            };

            const req = http.request(requestOptions, (res) => {
              const chunks = [];
              res.on('data', (c) => chunks.push(c));
              res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                let parsedBody = null;
                try {
                  parsedBody = JSON.parse(text);
                } catch {
                  parsedBody = text;
                }
                resolve({ status: res.statusCode, body: parsedBody });
              });
            });
            req.on('error', reject);
            if (opts.timeout) req.setTimeout(opts.timeout, () => req.destroy(new Error('timeout')));
            req.end(body);
          } catch (e) {
            reject(e);
          }
        });
      }

      try {
        const resp = await postJson(
          postUrl,
          { action: 'llm_elicit', question: 'Q', tenantId: 't' },
          {
            headers: { 'x-api-key': process.env.WEBHOOK_API_KEY, Connection: 'close' },
            timeout: 5000,
          }
        );
        expect(resp.status).toBeGreaterThanOrEqual(200);
        expect(resp.status).toBeLessThan(300);
      } finally {
        try {
          await new Promise((resolve) => server.close(resolve));
        } catch {}
        // Destroy any remaining sockets that may keep the event loop alive.
        try {
          for (const s of sockets) {
            try {
              s.destroy();
            } catch {}
          }
        } catch {}
        try {
          const http = require('http');
          const https = require('https');
          if (http && http.globalAgent && typeof http.globalAgent.destroy === 'function') {
            http.globalAgent.destroy();
          }
          if (https && https.globalAgent && typeof https.globalAgent.destroy === 'function') {
            https.globalAgent.destroy();
          }
        } catch {}
        // Give Node a tick to let any sockets/timers settle
        await new Promise((resolve) => setImmediate(resolve));
      }
    });

    const combined = logs.out.join('\n') + '\n' + logs.err.join('\n');
    expect(combined.includes('llm payload snippet:')).toBe(true);
  });
});
