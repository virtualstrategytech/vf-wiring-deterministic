Render settings to apply for vf-webhook-staging

If your repository is a monorepo (it is), set Render's Root Directory to the webhook subfolder and use simple build/start commands.

Recommended Render UI values:

- Root Directory: novain-platform/webhook
- Build Command: npm ci
- Start Command: npm start
- Health Check Path: /health
- Start Timeout: 120 (seconds)
- Add required env vars under Environment -> "Environment Variables (Secret)":
  - WEBHOOK_API_KEY (secret)
  - WEBHOOK_BASE (non-secret)
  - PROMPT_URL (optional)
  - RETRIEVAL_URL (optional)
  - BUSINESS_URL (optional)

Notes:

- Do NOT prepend the path in the Build or Start commands (for example, do not enter "novain-platform/webhook/ $ npm ci"). When Root Directory is set, Render will run commands from that folder.
- If `npm ci` fails on Render due to lockfile/package.json mismatches, either regenerate the lockfile for the targeted folder locally and commit it, or as a temporary workaround set Build Command to: `cd novain-platform/webhook && npm install` (less reproducible than `npm ci`).
