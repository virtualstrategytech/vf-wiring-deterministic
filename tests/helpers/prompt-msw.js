// Lightweight HTTP mock for PROMPT_URL used in tests.
// MSW caused compatibility issues with the fetch implementation in this
// environment (headers shape). Use a small native HTTP server so tests
// reliably receive deterministic mocked prompt responses.
const http = require('http');

let server = null;
let serverInfo = null;

function _makeResponder() {
  return async function (req, res) {
    try {
      if (req.method !== 'POST') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('not found');
      }
      let raw = '';
      req.setEncoding && req.setEncoding('utf8');
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        let parsed = {};
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch (e) {
          parsed = {};
        }
        const payloadRaw = { source: 'http-mock', request: parsed };
        const body = {
          summary: 'mocked prompt response',
          needs_clarify: false,
          followup_question: '',
          raw: payloadRaw,
          data: { raw: payloadRaw },
        };
        const bodyText = JSON.stringify(body);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyText),
        });
        res.end(bodyText);
      });
      req.on('error', () => {
        try {
          res.writeHead(500);
          res.end('error');
        } catch {}
      });
    } catch (err) {
      try {
        res.writeHead(500);
        res.end('error');
      } catch {}
    }
  };
}

function startMock(promptUrl = process.env.PROMPT_URL || 'http://127.0.0.1:3000') {
  if (server) return serverInfo;
  try {
    const u = new URL(promptUrl);
    const host = u.hostname || '127.0.0.1';
    const port = parseInt(u.port || (u.protocol === 'https:' ? '443' : '80'), 10) || 3000;

    server = http.createServer(_makeResponder());

    // Try to bind to the requested host/port. If that fails (in CI or when
    // the port is already in use), bind to an ephemeral port and update
    // process.env.PROMPT_URL so downstream callers use the mock.
    return new Promise((resolve) => {
      server
        .listen(port, host)
        .once('listening', () => {
          serverInfo = { host, port, url: `http://${host}:${port}` };
          resolve(serverInfo);
        })
        .once('error', () => {
          // fallback: listen ephemeral
          server.listen(0, '127.0.0.1').once('listening', () => {
            const addr = server.address();
            const p = addr && addr.port ? addr.port : 0;
            serverInfo = { host: '127.0.0.1', port: p, url: `http://127.0.0.1:${p}` };
            // Override PROMPT_URL so tests and code under test hit this mock
            try {
              process.env.PROMPT_URL = serverInfo.url;
            } catch {}
            resolve(serverInfo);
          });
        });
    });
  } catch (err) {
    return null;
  }
}

function stopMock() {
  try {
    if (server) {
      server.close();
    }
  } catch {}
  server = null;
  serverInfo = null;
}

module.exports = { startMock, stopMock };
