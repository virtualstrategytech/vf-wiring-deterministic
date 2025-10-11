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

```bash
npm i
WEBHOOK_API_KEY={WEBHOOK_KEY}
```



