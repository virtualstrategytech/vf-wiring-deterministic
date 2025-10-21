### Debug wiring PR checklist

- What changed
  - Adds a debug-only Jest test (`tests/debug_llm_logging.test.js`) that asserts LLM payload snippets are logged when `DEBUG_WEBHOOK=true` and `NODE_ENV` is not `production`.
  - Hardened in-process tests to avoid open-handle warnings.
  - Adds a manual/opt-in GitHub Actions workflow (`.github/workflows/debug-webhook-test.yml`) to run the debug test.

- How to run locally
  - `npm ci && npm test`

- Reviewer guidance
  - This change is mostly test-only and safe for review. To run the debug test in Actions, set the repo secret `DEBUG_WEBHOOK_ENABLED=true` and `WEBHOOK_API_KEY`.
