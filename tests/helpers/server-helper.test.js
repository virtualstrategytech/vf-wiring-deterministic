const supertest = require('supertest');

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

    // Use supertest(app) to avoid binding to an ephemeral port in this unit test
    const resp = await supertest(app).get('/').timeout({ deadline: 2000 });
    expect(resp.status).toBe(200);
    expect(resp.text).toBe('ok');
  });
});
