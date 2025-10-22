const http = require('http');
const supertest = require('supertest');
const { startTestServer } = require('./server-helper');

describe('server-helper', () => {
  it('starts a server and closes it cleanly', async () => {
    // Minimal handler: return 200 on GET /
    const app = (req, res) => {
      if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
        return;
      }
      res.writeHead(404);
      res.end();
    };

    const { base, close } = await startTestServer(app);
    // sanity check the server responds
    const resp = await supertest(base).get('/').timeout({ deadline: 2000 });
    expect(resp.status).toBe(200);
    expect(resp.text).toBe('ok');

    // closing should not throw
    await expect(close()).resolves.toBeUndefined();
  });
});
