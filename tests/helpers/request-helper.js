const supertest = require('supertest');

async function requestApp(
  app,
  { method = 'post', path = '/', body, headers = {}, timeout = 5000 } = {}
) {
  // Use supertest directly against the Express app to avoid creating a
  // real TCP listener which can leave bound handles in some environments.
  let req = supertest(app)[method](path);
  if (headers) {
    for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
  }
  if (body) req = req.send(body);
  if (timeout) req = req.timeout({ deadline: timeout });

  const res = await req;
  return res;
}

module.exports = { requestApp };
