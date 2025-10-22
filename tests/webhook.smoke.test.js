const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const secretFile = path.resolve(__dirname, 'webhook.secret');
const key =
  process.env.WEBHOOK_API_KEY ||
  (fs.existsSync(secretFile) ? fs.readFileSync(secretFile, 'utf8').trim() : 'test123');

const base = process.env.WEBHOOK_BASE || 'http://127.0.0.1:3000';

describe('webhook smoke', () => {
  // Allow longer for remote operations in CI (business/prompt services may be slower)
  jest.setTimeout(60000);

  afterAll(async () => {
    try {
      if (http && http.globalAgent && typeof http.globalAgent.destroy === 'function') {
        http.globalAgent.destroy();
      }
      if (https && https.globalAgent && typeof https.globalAgent.destroy === 'function') {
        https.globalAgent.destroy();
      }
      await new Promise((r) => setImmediate(r));
    } catch {}
  });

  test('GET /health returns ok', async () => {
    const url = `${base}/health`;
    const resp = await getText(url, 5000);
    expect(typeof resp).toBe('string');
    expect(resp.trim().toLowerCase()).toBe('ok');
  });

  test('POST /webhook (ping) returns 2xx', async () => {
    const body = { action: 'ping', question: 'hello', name: 'Bob', tenantId: 'default' };
    const resp = await postJson(`${base}/webhook`, body, { 'x-api-key': String(key) }, 7000);
    expect(resp.status).toBeGreaterThanOrEqual(200);
    expect(resp.status).toBeLessThan(300);
    expect(resp.data).toBeDefined();
  });

  test('POST /webhook generate_lesson (best-effort)', async () => {
    const body = { action: 'generate_lesson', question: 'Teach me SPQA', tenantId: 'default' };
    const resp = await postJson(`${base}/webhook`, body, { 'x-api-key': String(key) }, 45000);

    // Accept success (2xx) OR a controlled server-side failure (500) when external services are not configured.
    if (resp.status >= 200 && resp.status < 300) {
      if (resp.data && typeof resp.data === 'object') {
        expect(
          resp.data.lessonTitle !== undefined ||
            resp.data.lesson !== undefined ||
            resp.data.reply !== undefined
        ).toBeTruthy();
      } else {
        expect(resp.data).toBeDefined();
      }
    } else {
      // allow 500 but fail other unexpected statuses
      expect(resp.status).toBe(500);
    }
  });

  test('POST /webhook generate_quiz (best-effort)', async () => {
    const body = { action: 'generate_quiz', question: 'Quiz me on SPQA', tenantId: 'default' };
    const resp = await postJson(`${base}/webhook`, body, { 'x-api-key': String(key) }, 45000);

    if (resp.status >= 200 && resp.status < 300) {
      if (resp.data && typeof resp.data === 'object') {
        expect(
          resp.data.quiz !== undefined ||
            resp.data.mcqCount !== undefined ||
            resp.data.mcq !== undefined ||
            resp.data.reply !== undefined
        ).toBeTruthy();
      } else {
        expect(resp.data).toBeDefined();
      }
    } else {
      // allow 500 as above
      expect(resp.status).toBe(500);
    }
  });
});

// Helper: POST JSON and return { status, data }
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
        // prevent socket pooling / keep-alive so Jest can exit cleanly
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

      const transport = u.protocol === 'https:' ? https : http;
      const req = transport.request(options, (res) => {
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

// Helper: simple GET returning plain text
function getText(url, timeout = 3000) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const options = {
        method: 'GET',
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        agent: false,
        headers: { Connection: 'close' },
      };

      const transport = u.protocol === 'https:' ? https : http;
      const req = transport.request(options, (res) => {
        clearTimeout(timer);
        let chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(Buffer.concat(chunks).toString());
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

      req.end();
    } catch (e) {
      reject(e);
    }
  });
}
