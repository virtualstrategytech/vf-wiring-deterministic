const http = require('http');

describe('webhook smoke', () => {
  test('POST /webhook returns 2xx', async () => {
    const body = { action: 'ping', question: 'hello', name: 'Bob', tenantId: 'default' };
    const resp = await postJson(
      'http://127.0.0.1:3000/webhook',
      body,
      { 'x-api-key': (process.env.WEBHOOK_API_KEY || 'test123') },
      5000
    );
    expect(resp.status).toBeGreaterThanOrEqual(200);
    expect(resp.status).toBeLessThan(300);
    expect(resp.data).toBeDefined();
  }, 15000);
});

async function postJson(url, body, headers = {}, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const options = {
      method: 'POST',
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers: Object.assign(
        { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        headers
      ),
    };
    const req = http.request(options, (res) => {
      let chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        let json;
        try { json = JSON.parse(text); } catch { json = text; }
        resolve({ status: res.statusCode, data: json });
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
    setTimeout(() => reject(new Error('timeout')), timeout);
  });
}
