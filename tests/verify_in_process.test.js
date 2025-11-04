// Lightweight in-process verification test: require the Express app without listening
// and exercise a couple of endpoints using supertest.

process.env.WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY || 'test-key';

const request = require('supertest');
const path = require('path');

// require the app directly (exports the Express app and a createServer helper)
const app = require(path.join(__dirname, '..', 'novain-platform', 'webhook', 'server.js'));

describe('in-process app smoke', () => {
  test('GET /health returns ok', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(String(res.text)).toBe('ok');
  });

  test('POST /webhook ping (in-process) works with API key', async () => {
    const payload = require('./fixtures/ping.json');
    const res = await request(app)
      .post('/webhook')
      .set('x-api-key', 'test-key')
      .send(payload)
      .expect(200);

    expect(res.body && res.body.ok).toBe(true);
    expect(typeof res.body.reply).toBe('string');
    expect(res.body.port).toBeDefined();
  });
});
