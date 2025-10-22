// in_process.test.js — start a short-lived server and hit it with supertest
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

  it('should return llm_elicit stub with raw.source = "stub"', async () => {
    const logs = await captureConsoleAsync(async () => {
      const http = require('http');
      // Create an explicit server so we can control its lifecycle.
      const server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, resolve));
      // Do not let the test server keep the Node.js event loop alive
      // if something else accidentally leaves a handle open.
      if (typeof server.unref === 'function') server.unref();
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;
      const postUrl = `${baseUrl}/webhook`;
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
                } catch (_e) {
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

      let resp;
      try {
        resp = await postJson(postUrl, { action: 'llm_elicit', question: 'Please clarify X?', tenantId: 'default' }, { headers: { 'x-api-key': process.env.WEBHOOK_API_KEY, Connection: 'close' }, timeout: 5000 });
} finally {
  try {
    await new Promise((resolve) => server.close(resolve));
  } catch (e) {
    /* ignore */
  }
}

// Basic status checks
      expect(resp.status).toBeGreaterThanOrEqual(200);
      expect(resp.status).toBeLessThan(300);
      // supertest exposes parsed body as resp.body
      expect(resp.body).toBeDefined();
      // llm_elicit stub returns raw.source === 'stub'
      // Some callers wrap the LLM payload in `data.raw`; accept either.
      const raw = resp.body.raw || (resp.body.data && resp.body.data.raw);
      expect(raw).toBeDefined();
      expect(raw.source).toBe('stub');
    });

    const outText = logs.out.join('\n') + '\n' + logs.err.join('\n');
    // With NODE_ENV=test and DEBUG_WEBHOOK=false we should not log full LLM snippets
    expect(outText.includes('llm payload snippet')).toBe(false);
  });
});
