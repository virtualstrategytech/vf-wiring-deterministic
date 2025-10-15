# Voiceflow Webhook (Deterministic MVP)

## Endpoints

- `GET /health` â†’ `ok`
- `GET /health` â†’ `ok`
- `POST /webhook` with header `x-api-key: <key>`:
  - `action=ping` â†’ echo
  - `action=retrieve` â†’ calls RETRIEVAL_URL (if configured) else returns 400
  - `action=generate_lesson` â†’ calls BUSINESS_URL if set, else returns stub lesson
  - `action=generate_quiz` â†’ calls PROMPT_URL if set, else returns stub quiz
  - `action=export_lesson` â†’ returns `data:` URL (base64 markdown)
- `POST /export_lesson_file` â†’ returns a file download (`text/markdown`)
  - `action=ping` â†’ echo
  - `action=retrieve` â†’ calls RETRIEVAL_URL (if configured) else returns 400
  - `action=generate_lesson` â†’ calls BUSINESS_URL if set, else returns stub lesson
  - `action=generate_quiz` â†’ calls PROMPT_URL if set, else returns stub quiz
  - `action=export_lesson` â†’ returns `data:` URL (base64 markdown)
- `POST /export_lesson_file` â†’ returns a file download (`text/markdown`)

## Env

- `PORT=3000`
- `WEBHOOK_API_KEY={WEBHOOK_KEY}`
- `RETRIEVAL_URL=...` (optional)
- `BUSINESS_URL=...` (optional)
- `PROMPT_URL=...` (optional)

## Local

bash
npm i
WEBHOOK_API_KEY={WEBHOOK_KEY}

novain-platform/webhook — Local dev & Render deploy notes

Environment (local / Render)

- WEBHOOK_API_KEY — secret key (do NOT commit real secret). Example: test123 for local testing.
- PORT — optional locally (Render supplies PORT).
- PROMPT_URL — full URL to prompts service (http://localhost:4001 for local prompts).
- RETRIEVAL_URL — optional retrieval service URL.

Local start

1. Copy example env: cp env/.example.env .env (or edit .env)
2. npm install
3. WEBHOOK_API_KEY=test123 PORT=3000 PROMPT_URL=http://localhost:4001 node server.js

Render settings (paste into Render UI)

- Root Directory: novain-platform/webhook
- Build Command: npm install
- Start Command: node server.js
- Environment:
  - WEBHOOK_API_KEY = <your_key>
  - PROMPT_URL = https://<prompts-service>.onrender.com
  - RETRIEVAL_URL = https://<retrieval-service>.onrender.com

Security

- Do not commit real secrets. Ensure .env is listed in .gitignore.
