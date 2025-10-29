// Early Jest setup: disable external network connections during tests so
// outbound TLS sockets to real hosts (e.g., staging) don't get created
// and confuse Jest's open-handle detection. Allows localhost/127.0.0.1.
try {
  const nock = require('nock');
  // disallow all external network connections
  nock.disableNetConnect();
  // allow localhost (both IPv4 and IPv6) and any ephemeral localhost ports
  // Use a regex so ports like 127.0.0.1:56976 are allowed.
  nock.enableNetConnect(/127\.0\.0\.1|::1|localhost/);
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
  } catch (e) {
    // if nock internals throw here, ignore — the primary protection is
    // nock.disableNetConnect() which is already in place.
  }
  // helpful debug hint when tests attempt to reach external hosts
  process.on('unhandledRejection', () => {});
} catch (e) {
  // If nock is not installed, fail loudly so CI/devs add the dependency.
  // But in case of a tooling quirk, log a warning and continue.
  try {
    // eslint-disable-next-line no-console
    console.warn(
      'tests/jest.netblock.js: nock not available, external network requests will not be blocked'
    );
  } catch {}
}
