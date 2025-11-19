Summary of wiring-agent-fixes/catch-cleanup

This branch contains iterative test-harness and webhook hardening changes made to stabilize local and CI test runs.

Key fixes in this branch:

- Use per-request agents and deterministic in-process test helpers to avoid lingering socket handles.
- Added `fetchWithTimeout` and gated debug logs with `DEBUG_WEBHOOK` to avoid leaking LLM responses in prod.
- Exported Express `app` for in-process testing and added `requestApp` helper usage in tests.
- Replaced fragile `supertest` usage in `tests/verify_in_process.test.js` with `requestApp` to avoid bound-anonymous-fn open-handle warnings in Jest.
- Minor test refactors and defensive assertions to reduce flakiness.

Remaining recommended actions (follow-ups):

- Sweep remaining `catch (e)` patterns and replace unused parameters where safe (manual review required).
- Dispatch the `deployed-smoke` CI workflow three times with `DEBUG_TESTS` enabled and collect artifacts for async-handle analysis.
- Review Render start command and service env vars (PROMPT_URL, BUSINESS_URL, RETRIEVAL_URL) for deployed validation.

How to run locally:

1. npm ci
2. npm test

Contact: please paste this into the GitHub PR description for reviewers.
