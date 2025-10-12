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
