tests prompt mock

This repo's test suite can spawn a lightweight prompt-mock child process to provide a deterministic prompt service during tests.

How it works

- `tests/globalSetup.js` will spawn a prompt mock child process when tests run locally or when `USE_CHILD_PROCESS_SERVER=1` is set.
- The child listens on `127.0.0.1:${process.env.PROMPT_MOCK_PORT || 3001}` by default.
- Once the prompt mock is confirmed listening, `globalSetup` writes `tests/prompt-mock.json` atomically with the mock URL and also sets `process.env.PROMPT_URL` for the test run.

Env vars

- `USE_CHILD_PROCESS_SERVER=1`: force the test runner to spawn child-process servers (useful when `GITHUB_ACTIONS=true` and you still want to spawn local servers).
- `PROMPT_MOCK_PORT`: port for the prompt mock child (default `3001`).
- `PROMPT_URL`: if set externally, `globalSetup` will persist it to `tests/prompt-mock.json` and will not spawn the prompt mock.

Troubleshooting

- If tests fail with `ECONNREFUSED 127.0.0.1:3000`, ensure the prompt mock has started and `tests/prompt-mock.json` exists. Setting `USE_CHILD_PROCESS_SERVER=1` helps force local spawning during CI debugging.
- If prompt child spawn fails, check `tests/prompt-mock.child.stdout.log` / `tests/prompt-mock.child.stderr.log` for errors.

Notes

- The new prompt mock child script (`tests/prompt-mock-child-fixed.js`) is a small, deterministic HTTP server that returns a JSON body with both `raw` and `data.raw` fields; it's used to make tests deterministic and avoid hitting external services.
