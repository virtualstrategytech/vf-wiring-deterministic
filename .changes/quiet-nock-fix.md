PR: Quieter nock missing notice

Summary:

- Replace repeated loud console warnings when `nock` is missing with a single, quieter `console.info` note.
- Write a small `/tmp/nock_missing_notice.log` entry for CI artifact collection when `nock` is missing.
- Prevent repeated messages across multiple test files by using a global guard flag.

Why:

- Tests were noisy with repeated `nock not available` warnings. This keeps CI logs cleaner while preserving an artifact for debugging.

Files changed:

- `tests/jest.netblock.js` (updated)

Notes:

- This is a low-risk change intended to reduce test log noise. All tests were run locally after the change and passed.
