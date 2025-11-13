# vf-webhook-services

# Local dev: webhook

1. Copy example env:
   cp .env.example .env
   (Edit .env to set WEBHOOK_API_KEY)

2. Install deps (if needed):
   npm install

3. Start server:

   # PowerShell

   $env:WEBHOOK_API_KEY = 'test123'; $env:PORT='3000'; node .\server.js

4. Smoke tests (PowerShell):
   Invoke-RestMethod -Uri http://localhost:3000/health
   $body = @{ action='ping'; question='hello'; name='Bob' } | ConvertTo-Json
   Invoke-RestMethod -Method Post -Uri http://localhost:3000/webhook -Headers @{ 'x-api-key'='test123' } -Body $body -ContentType 'application/json'

````markdown
# vf-webhook-services

## Local dev: webhook

1. Copy example env:
   cp .env.example .env
   (Edit .env to set WEBHOOK_API_KEY)

2. Install deps (if needed):
   npm install

3. Start server (PowerShell example):

   $env:WEBHOOK_API_KEY = 'test123'; $env:PORT='3000'; node .\server.js

4. Quick request example (PowerShell):
   Invoke-RestMethod -Uri http://localhost:3000/health
   $body = @{ action='ping'; question='hello'; name='Bob' } | ConvertTo-Json
   Invoke-RestMethod -Method Post -Uri http://localhost:3000/webhook -Headers @{ 'x-api-key'='test123' } -Body $body -ContentType 'application/json'

---

## Environment variables and behavior

- WEBHOOK_API_KEY (required in production)
  - Secret used to authenticate incoming requests (header `x-api-key`).
  - Locally you can store it in `tests/webhook.secret` (gitignored) or set it in your shell.

- PORT (optional)
  - Default: 3000

- RETRIEVAL_URL (optional)
  - Full URL to the retrieval microservice, including path if required. Example:
    `https://vf-retrieval-service.onrender.com/v1/retrieve`

- PROMPT_URL (optional)
  - Full URL to the prompt service endpoint used by `llm_elicit`. Example:
    `https://vf-prompt-service.onrender.com/v1/teach-and-quiz`

- BUSINESS_URL (optional)
  - Base URL for business logic endpoints. The webhook will POST to `${BUSINESS_URL}/v1/lessons/generate` when configured.

- NODE_ENV
  - Set to `production` in production environments. When `NODE_ENV=production`, the webhook disables sensitive debug logging.

- DEBUG_WEBHOOK
  - When set to `true` and `NODE_ENV` is not `production`, the webhook will print additional debug output (fetch start/response snippets and LLM payload snippets).
  - Do NOT set `DEBUG_WEBHOOK` in production.

### Enabling debug logs for tests

- To assert or inspect debug logging from tests, set `NODE_ENV` to a non-production value and `DEBUG_WEBHOOK=true` before requiring the server in your test. The test suite includes `tests/debug_llm_logging.test.js` as an example.
- Example (PowerShell):

  $env:NODE_ENV = 'development'; $env:DEBUG_WEBHOOK = 'true'; node .\server.js

## Render configuration (recommended)

- Set `NODE_ENV=production` for the webhook service.
- Add `WEBHOOK_API_KEY` as a secret in Render's environment settings.
- Do not set `DEBUG_WEBHOOK` in production. If you need verbose logs, enable it in a staging service only.
- Ensure the Node version on Render is Node 18+ (or otherwise provide `node-fetch`) so `fetch` is available.
- Ensure `RETRIEVAL_URL`, `PROMPT_URL`, and `BUSINESS_URL` are configured with required path segments where applicable.

## Local debugging example

```powershell
$env:WEBHOOK_API_KEY = (Get-Content .\tests\webhook.secret -Raw).Trim()
$env:PORT = '3000'
$env:DEBUG_WEBHOOK = 'true'
$env:NODE_ENV = 'development'
node .\server.js
```
````

## Notes

- The webhook intentionally never logs full secret values. Presence checks (true/false) and debug output require explicit enabling.
- For CI, provide `WEBHOOK_API_KEY` as a secret environment variable to the runner so tests can authenticate.

```

```
