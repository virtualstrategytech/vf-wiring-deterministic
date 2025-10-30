// scripts/trace_handles.js
// Best-effort tracer to capture async_hooks creation stacks and active handles
// for a single in-process POST /webhook call. Writes a JSON file to artifacts/.

const fs = require('fs');
const path = require('path');
const async_hooks = require('async_hooks');

const outDir = path.resolve(__dirname, '..', 'artifacts');
try {
  fs.mkdirSync(outDir, { recursive: true });
} catch (e) {}

const handleMap = new Map();
const hooks = async_hooks.createHook({
  init(asyncId, type, triggerAsyncId, resource) {
    try {
      const info = { type, stack: new Error('handle-init').stack };
      handleMap.set(asyncId, info);
    } catch (e) {}
  },
  destroy(asyncId) {
    try {
      handleMap.delete(asyncId);
    } catch (e) {}
  },
});
hooks.enable();

function getActiveHandlesSummary() {
  const handles =
    typeof process._getActiveHandles === 'function' ? process._getActiveHandles() : [];
  return handles.map((h) => {
    let ctor = 'unknown';
    try {
      ctor = (h && h.constructor && h.constructor.name) || ctor;
    } catch (e) {}
    // attempt to capture any attached _createdStack
    let created = null;
    try {
      if (h && h._createdStack) created = String(h._createdStack);
    } catch (e) {}
    // best-effort socket info
    const socketInfo = {};
    try {
      if (ctor === 'Socket' || ctor === 'TLSSocket') {
        socketInfo.localAddress = h.localAddress;
        socketInfo.localPort = h.localPort;
        socketInfo.remoteAddress = h.remoteAddress;
        socketInfo.remotePort = h.remotePort;
        socketInfo.destroyed = h.destroyed;
        socketInfo.pending = h.pending;
      }
    } catch (e) {}
    return { ctor, created, socketInfo, repr: String(h).slice(0, 400) };
  });
}

async function run() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(outDir, `handle_trace_${ts}.json`);

  // require the app under test
  // ensure environment matches test conditions
  process.env.WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY || 'test123';

  // require the app module (same as tests)
  let mod;
  try {
    mod = require('../novain-platform/webhook/server');
  } catch (e) {
    console.error('Failed to require server module:', (e && e.stack) || e);
    process.exit(2);
  }

  // build an in-process dispatcher similar to tests/dispatch
  const { Readable } = require('stream');
  const dispatch = (app, { method = 'GET', path = '/', headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      try {
        const req = new Readable({ read() {} });
        req.method = method;
        req.url = path;
        req.headers = Object.assign({}, headers);
        if (body !== undefined && body !== null) {
          const s = typeof body === 'string' ? body : JSON.stringify(body);
          try {
            req.headers['content-length'] = Buffer.byteLength(s).toString();
          } catch (e) {}
          req.push(s);
        }
        req.push(null);

        const headersOut = {};
        let statusCode = 200;
        const chunks = [];
        const res = {
          setHeader(name, value) {
            headersOut[String(name).toLowerCase()] = value;
          },
          getHeader(name) {
            return headersOut[String(name).toLowerCase()];
          },
          write(chunk) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
          },
          end(chunk) {
            if (chunk) this.write(chunk);
            const bodyBuf = Buffer.concat(chunks);
            const text = bodyBuf.toString('utf8');
            const ct = headersOut['content-type'] || '';
            let parsed = null;
            if (ct.includes('application/json')) {
              try {
                parsed = JSON.parse(text);
              } catch {}
            }
            resolve({ status: statusCode, headers: headersOut, text, body: parsed || text });
          },
          writeHead(code) {
            statusCode = code;
          },
          status(code) {
            statusCode = code;
            return this;
          },
          json(obj) {
            const s = JSON.stringify(obj);
            this.setHeader('content-type', 'application/json');
            this.end(s);
          },
          send(v) {
            if (typeof v === 'object') return this.json(v);
            this.end(String(v));
          },
        };

        try {
          // Express app may be exported as function (app) or as module with createServer
          const appToCall =
            typeof mod === 'function'
              ? mod
              : mod && typeof mod === 'object' && mod.app
                ? mod.app
                : mod;
          if (!appToCall) return reject(new Error('Unable to locate app to dispatch to'));
          // call app(req,res)
          appToCall(req, res);
        } catch (err) {
          try {
            if (mod && typeof mod.handle === 'function') {
              mod.handle(req, res);
            } else {
              return reject(err);
            }
          } catch (err2) {
            return reject(err2 || err);
          }
        }
      } catch (e) {
        return reject(e);
      }
    });

  // make one POST /webhook request to exercise the code path
  try {
    console.log('Running in-process POST /webhook to exercise handler...');
    const result = await dispatch(mod, {
      method: 'POST',
      path: '/webhook',
      headers: { 'x-api-key': 'test123', 'content-type': 'application/json' },
      body: { action: 'ping', name: 'Tracer', tenantId: 'default' },
    });
    console.log('dispatch result:', { status: result.status, bodyType: typeof result.body });
  } catch (e) {
    console.error('Dispatch error:', (e && e.stack) || e);
  }

  // give the runtime some time for async handles to be created/settle
  await new Promise((r) => setTimeout(r, 200));

  // collect active handles and async handle map
  const active = getActiveHandlesSummary();
  const asyncEntries = [];
  for (const [id, info] of handleMap.entries()) {
    asyncEntries.push({
      id,
      type: info.type,
      stack: info.stack && info.stack.split('\n').slice(0, 10),
    });
  }

  const dump = { timestamp: new Date().toISOString(), active, asyncEntries };

  try {
    fs.writeFileSync(outFile, JSON.stringify(dump, null, 2), 'utf8');
    console.log('Wrote trace file:', outFile);
  } catch (e) {
    console.error('Failed to write trace file:', (e && e.stack) || e);
  }

  // small delay then exit
  await new Promise((r) => setTimeout(r, 50));
  process.exit(0);
}

run().catch((e) => {
  console.error('Run failed', (e && e.stack) || e);
  process.exit(2);
});
