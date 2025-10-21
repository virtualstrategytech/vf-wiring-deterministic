const http = require('http');
// Ensure required env vars are set before importing the app so module-level
// initialization uses the correct values (API key and debug flags).
process.env.WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY || 'test123';
process.env.PROMPT_URL = process.env.PROMPT_URL || '';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DEBUG_WEBHOOK = process.env.DEBUG_WEBHOOK || 'false';

const app = require('../novain-platform/webhook/server');

// Helpers to capture stdout/stderr during an async action
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

describe('in-process webhook app', () => {
  jest.setTimeout(20000);
  let server;
  let port;

  beforeAll(async () => {
    // Let the OS pick an available port
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    port = server.address().port;
  });

  afterAll(async () => {
    if (server && server.close) {
      // Await server.close to ensure Node clears the handle
      await new Promise((resolve) => {
        try {
          server.close(() => resolve());
        } catch {
          resolve();
        }
      });
      if (server.removeAllListeners) server.removeAllListeners();
      // short pause to allow sockets to close
      await new Promise((r) => setTimeout(r, 50));
    }
  });

  it('should handle webhook requests properly', async () => {
    const logs = await captureConsoleAsync(async () => {
      // Use action 'ping' — keep debug printing enabled to inspect actual response shape.
      const resp = await postJson(
        `http://localhost:${port}/webhook`,
        {
          action: 'ping',
          question: 'hello',
        },
        {
          'x-api-key': process.env.WEBHOOK_API_KEY,
        }
      );

      // DEBUG: print full response body/shape (copy the DEBUG resp line into chat)
      console.log('DEBUG resp:', JSON.stringify(resp && resp.data ? resp.data : resp, null, 2));

      expect(resp.status).toBeGreaterThanOrEqual(200);
      expect(resp.status).toBeLessThan(300);

      // ensure shape exists before deep-checking
      expect(resp.data).toBeDefined();
      expect(resp.data.raw).toBeDefined();
      // stub should set raw.source === 'stub'
      expect(resp.data.raw.source).toBe('stub');
    });

    // Because NODE_ENV=test and DEBUG_WEBHOOK=false there should be no LLM payload snippet logged
    const outText = logs.out.join('\n') + '\n' + logs.err.join('\n');
    expect(outText.includes('llm payload snippet')).toBe(false);
  });
});

// small helper
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
