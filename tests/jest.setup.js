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
  } catch {
    // swallow errors to avoid masking test failures
  }
});
