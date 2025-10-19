const http = require('http');
const fs = require('fs');
const path = require('path');

const secretFile = path.resolve(__dirname, 'webhook.secret');
const key =
  process.env.WEBHOOK_API_KEY ||
  (fs.existsSync(secretFile) ? fs.readFileSync(secretFile, 'utf8').trim() : 'test123');

const base = process.env.WEBHOOK_BASE || 'http://127.0.0.1:3000';

describe('llm_elicit stub behavior', () => {
  jest.setTimeout(10000);

  test('POST /webhook llm_elicit returns stub when PROMPT_URL not set', async () => {
    const body = { action: 'llm_elicit', question: 'Explain SPQA', tenantId: 'default' };

    const resp = await postJson(`${base}/webhook`, body, { 'x-api-key': String(key) }, 7000);

    expect(resp.status).toBeGreaterThanOrEqual(200);
    expect(resp.status).toBeLessThan(300);
    expect(resp.data).toBeDefined();
    // When prompt service is not configured the webhook returns raw.source === 'stub'
    if (resp.data && typeof resp.data === 'object') {
      expect(resp.data.raw).toBeDefined();
      expect(resp.data.raw.source === 'stub' || resp.data.raw.source === 'invoke_component_stub' || resp.data.raw.source === 'invoke_component_default').toBeTruthy();
    }
  });
});

// copy helpers from webhook.smoke.test.js
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
