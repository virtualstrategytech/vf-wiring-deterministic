// Global Jest setup/teardown helpers to reduce open-handle warnings.
// Called after each test file via setupFilesAfterEnv.
const http = require('http');
const https = require('https');

// Attempt to destroy global agents and give Node a chance to clear handles.
afterAll(async () => {
  try {
    if (http && http.globalAgent && typeof http.globalAgent.destroy === 'function') {
      try {
        http.globalAgent.destroy();
      } catch {}
    }
    if (https && https.globalAgent && typeof https.globalAgent.destroy === 'function') {
      try {
        https.globalAgent.destroy();
      } catch {}
    }

    // If there are any modules that track sockets (like tests/helpers/server-helper.js),
    // attempt to call their cleanup method if exposed.
    try {
      const serverHelper = require('./helpers/server-helper');
      if (serverHelper && typeof serverHelper._forceCloseAllSockets === 'function') {
        try {
          serverHelper._forceCloseAllSockets();
        } catch {}
      }
    } catch {
      // ignore, helper may not expose force-close API
    }

    // yield to the event loop to allow handles to close
    await new Promise((r) => setImmediate(r));

    // tiny additional delay to allow native handles to fully close on CI/Windows
    await new Promise((r) => setTimeout(r, 20));

    // CI diagnostic: if Jest still sees open handles, try to list them and aggressively close
    try {
      if (typeof process._getActiveHandles === 'function') {
        const handles = process._getActiveHandles();
        if (handles && handles.length) {
          console.warn('CI diagnostic: active handles after test cleanup:', handles.length);
          try {
            handles.forEach((h, i) => {
              try {
                const name = h && h.constructor && h.constructor.name;
                // log a brief summary about the handle
                console.warn(`  handle[${i}] type=${String(name)}`);
                // If the socket has a recorded creation stack, print it (shortened)
                try {
                  if (h && typeof h._createdStack === 'string') {
                    const lines = h._createdStack
                      .split('\n')
                      .slice(0, 6)
                      .map((l) => l.trim());
                    console.warn(`    created at:`);
                    lines.forEach((ln) => console.warn(`      ${ln}`));
                  }
                } catch {}
              } catch {}
            });
          } catch {}

          // Attempt to close/destroy known handle types (sockets, servers)
          for (const h of handles) {
            try {
              if (!h) continue;
              // sockets
              if (typeof h.destroy === 'function') {
                try {
                  h.destroy();
                } catch {}
              }
              // servers
              if (typeof h.close === 'function') {
                try {
                  h.close(() => {});
                } catch {}
              }
            } catch {}
          }

          // give the runtime a short moment to settle after forced cleanup
          await new Promise((r) => setTimeout(r, 20));
        }
      }
    } catch (err) {
      // swallow any diagnostic errors - diagnostics must not fail tests
      try {
        console.warn('handle-dump error', err && err.stack ? err.stack : String(err));
      } catch {}
    }
  } catch {
    // swallow errors to avoid masking test failures
  }
});
