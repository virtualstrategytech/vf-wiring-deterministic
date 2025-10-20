const http = require('http');
// Ensure required env vars are set before importing the app so module-level
// initialization uses the correct values (API key and debug flags).
process.env.WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY || 'test123';
process.env.PROMPT_URL = process.env.PROMPT_URL || '';
process.env.NODE_ENV = process.env.NODE_ENV || 'production';
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
    if (server && server.close) await new Promise((r) => server.close(r));
  });

  test('llm_elicit stub and logging gating', async () => {
    // env already set at module top
    const body = { action: 'llm_elicit', question: 'Explain SPQA', tenantId: 'default' };

    let resp;
    const logs = await captureConsoleAsync(async () => {
      resp = await postJson(
        `http://127.0.0.1:${port}/webhook`,
        body,
        { 'x-api-key': String(process.env.WEBHOOK_API_KEY) },
        5000
      );
    });

    expect(resp.status).toBeGreaterThanOrEqual(200);
    expect(resp.status).toBeLessThan(300);
    // stub should set raw.source === 'stub'
    expect(resp.data && resp.data.raw && resp.data.raw.source).toBe('stub');

    // Because NODE_ENV=production and DEBUG_WEBHOOK=false there should be no LLM payload snippet logged
    const outText = logs.out.join('\n') + '\n' + logs.err.join('\n');
    expect(outText.includes('llm payload snippet')).toBe(false);
  });
});

// copy small helper from other tests
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
              json = JSON.parse(text);
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
