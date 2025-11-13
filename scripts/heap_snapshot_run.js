// scripts/heap_snapshot_run.js
// Performs an in-process POST /webhook request and writes a V8 heap snapshot
// to artifacts/ for offline analysis.
const fs = require('fs');
const path = require('path');
const v8 = require('v8');

const outDir = path.resolve(__dirname, '..', 'artifacts');
try {
  fs.mkdirSync(outDir, { recursive: true });
} catch {}

async function dispatchAndSnapshot() {
  process.env.WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY || 'test123';
  // require the app
  let mod;
  try {
    mod = require('../novain-platform/webhook/server');
  } catch (e) {
    console.error('Failed to require server module:', (e && e.stack) || e);
    process.exit(2);
  }

  // in-process dispatch similar to previous tracer
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
          } catch {}
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
          const appToCall =
            typeof mod === 'function'
              ? mod
              : mod && typeof mod === 'object' && mod.app
                ? mod.app
                : mod;
          if (!appToCall) return reject(new Error('Unable to locate app to dispatch to'));
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

  try {
    console.log('Dispatching POST /webhook');
    const r = await dispatch(mod, {
      method: 'POST',
      path: '/webhook',
      headers: { 'x-api-key': 'test123', 'content-type': 'application/json' },
      body: { action: 'ping', name: 'HeapTracer', tenantId: 'default' },
    });
    console.log('Dispatch returned status:', r && r.status);
  } catch (e) {
    console.error('Dispatch error', (e && e.stack) || e);
  }

  // allow any async handles to be created
  await new Promise((r) => setTimeout(r, 200));

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const snap = path.join(outDir, `heap_${ts}.heapsnapshot`);
  try {
    v8.writeHeapSnapshot(snap);
    console.log('Heap snapshot written:', snap);
  } catch (e) {
    console.error('Failed to write heap snapshot:', (e && e.stack) || e);
    process.exit(2);
  }
}

dispatchAndSnapshot()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Error', (e && e.stack) || e);
    process.exit(2);
  });
