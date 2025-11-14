// Early Jest setup: disable external network connections during tests so
// outbound TLS sockets to real hosts (e.g., staging) don't get created
// and confuse Jest's open-handle detection. Allows localhost/127.0.0.1.
try {
  const nock = require('nock');
  // disallow all external network connections by default. Build a single
  // whitelist regex that always includes localhost and, when provided,
  // the WEBHOOK_BASE host so the deployed smoke test can reach staging.
  nock.disableNetConnect();
  // If DEBUG_TESTS is enabled we are intentionally running a deployed smoke
  // test that must reach an external host. In that mode, allow external
  // network connections so the smoke test can exercise the deployed webhook.
  // We still keep metadata mocks below to avoid long cloud metadata timeouts.
  const DEBUG_TESTS = process.env.DEBUG_TESTS === '1' || process.env.DEBUG_TESTS === 'true';
  if (DEBUG_TESTS) {
    try {
      nock.enableNetConnect();
      try {
        require('fs').appendFileSync(
          '/tmp/nock_allowlist.log',
          'DEBUG_TESTS enabled: allowing external network connects\n'
        );
      } catch {}
      // proceed but still register harmless metadata mocks below
    } catch {}
  }
  if (!DEBUG_TESTS) {
    try {
      const allowed = ['127\\.0\\.0\\.1', '::1', 'localhost'];
      try {
        const base = process.env.WEBHOOK_BASE || '';
        if (base) {
          const hostMatch = String(base)
            .replace(/^https?:\/\//, '')
            .replace(/\/.*$/, '');
          const esc = hostMatch.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
          allowed.push(esc);
        }
      } catch {}
      const combined = new RegExp(allowed.join('|'));
      // Enable net connect for our combined allowlist. Also write a short
      // debugging hint so CI uploads include the allowlist if nock later
      // rejects the deployed host (helps triage "Disallowed net connect").
      nock.enableNetConnect(combined);
      try {
        // prefer /tmp for CI; fall back to console if not writable (e.g., Windows dev)
        const fs = require('fs');
        const msg = `nock allowlist regex: ${combined}\n`;
        try {
          fs.appendFileSync('/tmp/nock_allowlist.log', msg);
        } catch {
          /* ignore */
        }
        // also emit to console for immediate developer visibility

        console.log('jest.netblock: set nock allowlist ->', combined);
      } catch {
        // swallow errors to avoid blocking tests
      }
    } catch {
      // fallback to localhost-only allow if something goes wrong
      try {
        nock.enableNetConnect(/127\.0\.0\.1|::1|localhost/);
      } catch {}
    }
  } else {
    try {
      require('fs').appendFileSync(
        '/tmp/nock_allowlist.log',
        'DEBUG_TESTS: external connects allowed (skip allowlist)\n'
      );
    } catch {}
  }
  // Prevent cloud metadata calls (AWS/Azure) from being attempted during tests.
  // Some SDKs attempt to reach instance metadata (169.254.169.254 for AWS,
  // 168.63.129.16 for Azure). Disable AWS metadata lookups via env var and
  // mock the IPs with nock so any accidental calls return harmless responses.
  process.env.AWS_EC2_METADATA_DISABLED = 'true';
  try {
    // respond with empty success for common metadata endpoints to avoid
    // long hangs or real network egress in CI.
    nock('http://169.254.169.254').persist().get(/.*/).reply(200, '');
    nock('http://168.63.129.16').persist().get(/.*/).reply(200, '');
  } catch {
    // if nock internals throw here, ignore — the primary protection is
    // nock.disableNetConnect() which is already in place.
  }
  // Helpful debug hint when tests attempt to reach external hosts.
  // Previously this silenced all unhandled rejections which can obscure
  // real test failures. Instead, log the rejection (and stack when
  // available) and rethrow on the next tick so Jest fails fast and the
  // root cause is visible in CI logs. We also append to a local file
  // (`/tmp/unhandled_rejections.log`) when possible for artifact upload.
  process.on('unhandledRejection', (err) => {
    try {
      const msg =
        (err && (err.stack || err.message || String(err))) || 'unhandledRejection (no error)';
      try {
        // best-effort: write to /tmp for CI artifact collection
        require('fs').appendFileSync(
          '/tmp/unhandled_rejections.log',
          `${new Date().toISOString()} ${msg}\n\n`
        );
      } catch {}
      try {
        console.error('UnhandledPromiseRejection in tests:', msg);
      } catch {}
      // Re-throw on next tick to make the process fail loudly (so CI shows the error)
      setImmediate(() => {
        throw err;
      });
    } catch (e) {
      try {
        console.error('Error in unhandledRejection handler:', e && e.stack ? e.stack : e);
      } catch {}
    }
  });
} catch {
  // If nock is not installed, avoid noisy repeated warnings. Emit a single
  // informational line (not a loud `warn`) and write a small file for CI
  // artifact collection. Guard with a global flag so multiple test files
  // loading this helper won't spam the logs.
  try {
    if (!global.__NETBLOCK_NOCK_MISSING) {
      global.__NETBLOCK_NOCK_MISSING = true;
      try {
        require('fs').appendFileSync(
          '/tmp/nock_missing_notice.log',
          `${new Date().toISOString()} nock not installed: network blocking disabled\n`
        );
      } catch {}
      try {
        console.info(
          'jest.netblock: nock not installed; external network calls will not be blocked (quiet notice)'
        );
      } catch {}
    }
  } catch {}
}
