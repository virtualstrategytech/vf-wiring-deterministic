Child-runner test notes

This repository supports a child-process test-server mode to isolate native Node handles
from the Jest process. The child-runner is opt-in and safe; use these env vars to control
behavior when running tests locally or in CI.

Env vars

- USE_CHILD_PROCESS_SERVER=1
  - When set, `tests/helpers/request-helper.js` will fork `tests/server-runner.js` which
    loads the exported Express `app` and listens on an ephemeral port.

- TEST_PROMPT_STUB=1
  - Optional. When set in the parent test before starting the child, the child process will
    install a local `nock` interceptor for `PROMPT_URL` and return the payload supplied via
    `TEST_PROMPT_PAYLOAD_JSON` (see below). This is necessary because `nock` interceptors
    installed in the parent process do not affect forked children.

- TEST_PROMPT_PAYLOAD_JSON
  - A JSON string containing the payload the child should return for POSTs to `PROMPT_URL`.
    Example:

    TEST_PROMPT_PAYLOAD_JSON='{"summary":"stub","needs_clarify":false}'

Notes

- The child-runner will also attempt to install `node-fetch` in the child (if available) so
  that `nock` can reliably intercept HTTP calls. This is opt-in via `TEST_PROMPT_STUB` and
  will not change production behavior.

- Tests that capture `console.log`/`console.error` in the parent will also see child logs because
  the test helper forwards child stdout/stderr to the parent (so no test rewrites are required
  for most cases).

- To run tests locally using child mode with diagnostic tracing:

```powershell
$env:USE_CHILD_PROCESS_SERVER='1'
$env:NODE_DEBUG='net,tls'
$env:DEBUG_TESTS='1'
npm test
```

- For CI diagnostic runs we recommend enabling NODE_DEBUG and DEBUG_TESTS so socket creation
  stacks and net/tls traces are captured. These traces are noisy — enable them only for CI
  diagnostics or targeted local debugging.
