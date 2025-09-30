# Render Deployment Checklist

- Node LTS set (e.g., 20.x) in Render → Environment.
- ENV: OPENAI_API_KEY, PINECONE_API_KEY, HMAC_SECRET (if used).
- Healthcheck: GET /health → 200.
- Logs clean (no unhandled promise rejections).
- Smoke:
  - /webhook generate_lesson → ok
  - /webhook generate_quiz → ok
  - /export_lesson → ok
  - /export_lesson_file → URL
