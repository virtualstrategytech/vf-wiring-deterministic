**Voiceflow Wiring (Quick Reference)**

- **Purpose:** Wire Voiceflow flows to the local webhook in this repo. The webhook expects requests with an `x-api-key` header and returns deterministic JSON for several components (lessons, quizzes, KB retrieval).

- **Run locally:**
  - Set environment variables and start the webhook from `novain-platform/webhook` root.
    ```powershell
    $env:WEBHOOK_API_KEY = 'test123'  # use a local secret, do NOT commit
    $env:PORT = '3000'
    $env:PROMPT_URL = 'http://localhost:4001'  # if using prompt service locally
    node .\server.js
    ```

- **Health / quick ping:**
  - POST /webhook with action `ping` (example using PowerShell):
    ```powershell
    Invoke-RestMethod -Method Post -Uri http://localhost:3000/webhook -Headers @{ 'x-api-key' = $env:WEBHOOK_API_KEY } -Body (@{ action='ping'; name='Tester'; message='hello' } | ConvertTo-Json)
    ```

- **Voiceflow settings:**
  - Webhook URL: `https://<your-deployment>/webhook` (or `http://localhost:3000/webhook` for local testing)
  - Headers: add `x-api-key` = your secret (use Vault/Env in production)
  - Method: `POST`. Body: JSON (components use `action` field to choose handler).

- **Important security notes:**
  - Never commit real secrets. Use `.env`, OS secret stores, or CI secret variables. This repo ignores `.env` and common backup/log patterns.
  - If a secret was accidentally exposed, rotate it immediately (ngrok tokens, webhook keys, etc.).

- **Troubleshooting:**
  - If the webhook returns `401 unauthorized`, verify `x-api-key` matches `WEBHOOK_API_KEY` in the environment.
  - Use `DEBUG_WEBHOOK=true` locally to enable verbose fetch and handler logs for debugging (do NOT enable in production).

---

File: `novain-platform/webhook/server.js` contains the handlers and startup instructions.
