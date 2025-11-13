const fs = require('fs');
const path = require('path');

const secretFile = path.resolve(__dirname, 'webhook.secret');
// resolution order: explicit env -> secret file -> fallback test123
let key = process.env.WEBHOOK_API_KEY || 'test123';
if (!process.env.WEBHOOK_API_KEY && fs.existsSync(secretFile)) {
  try {
    const s = fs.readFileSync(secretFile, 'utf8').trim();
    if (s) key = s;
  } catch {
    /* ignore, fall back */
  }
}

console.log('KEY_JSON:', JSON.stringify(key));
console.log('KEY_LENGTH:', key.length);
console.log('KEY_HEX (first 80 bytes):', Buffer.from(String(key)).slice(0, 80).toString('hex'));
for (let i = 0; i < Math.min(80, key.length); i++) {
  const c = key.charCodeAt(i);
  if (c < 32 || c === 127) {
    console.log('CONTROL at', i, 'code', c);
  }
}

try {
  const http = require('http');
  const req = http.request(
    {
      hostname: '127.0.0.1',
      port: 3000,
      path: '/webhook',
      method: 'POST',
      headers: { 'x-api-key': String(key) },
    },
    (res) => {
      console.log('request created, status', res && res.statusCode);
      res && res.resume();
    }
  );
  req.on('error', (e) => console.error('request error:', e.message));
  req.end();
} catch (e) {
  console.error('throw:', e && e.message);
}
