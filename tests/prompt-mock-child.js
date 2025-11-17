// Lightweight prompt mock child process.
// Start with: `node tests/prompt-mock-child.js` or set PORT env.
const http = require('http');
const port = Number(process.env.PROMPT_MOCK_PORT || process.env.PORT || 3001);

function handler(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('not found');
  }
  let raw = '';
  if (typeof req.setEncoding === 'function') req.setEncoding('utf8');
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    let parsed = {};
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch (e) {
      parsed = {};
    }
    const payloadRaw = { source: 'prompt-mock-child', request: parsed };
    const body = {
      summary: 'mocked prompt child response',
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
}

const server = http.createServer(handler);
server.listen(port, '127.0.0.1', () => {
   
  console.log(`prompt-mock-child listening on http://127.0.0.1:${port}`);
});

// Keep process alive until killed by parent
process.on('SIGTERM', () => {
  try {
    server.close(() => process.exit(0));
  } catch {
    process.exit(0);
  }
});
// Lightweight prompt mock child process (fixed).
// Start with: `node tests/prompt-mock-child-fixed.js` or set PORT env.
const http = require('http');
const port = Number(process.env.PROMPT_MOCK_PORT || process.env.PORT || 3001);

function handler(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('not found');
  }
  let raw = '';
  if (typeof req.setEncoding === 'function') req.setEncoding('utf8');
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    let parsed = {};
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch (e) {
      parsed = {};
    }
    const payloadRaw = { source: 'prompt-mock-child-fixed', request: parsed };
    const body = {
      summary: 'mocked prompt child response',
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
}

const server = http.createServer(handler);
server.listen(port, '127.0.0.1', () => {
  console.log(`prompt-mock-child-fixed listening on http://127.0.0.1:${port}`);
});

// Keep process alive until killed by parent
process.on('SIGTERM', () => {
  try {
    server.close(() => process.exit(0));
  } catch {
    process.exit(0);
  }
});
