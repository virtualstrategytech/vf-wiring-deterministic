# start server in separate window (example)

Start-Process powershell -ArgumentList '-NoExit','-Command','$env:WEBHOOK_API_KEY=\"test123\"; $env:PORT=\"3000\"; node .\novain-platform\webhook\server.js' -WorkingDirectory (Resolve-Path .)

# run tests

Invoke-RestMethod -Uri http://localhost:3000/health
$body = @{ action='ping'; question='hello'; name='Bob' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:3000/webhook -Headers @{ 'x-api-key'='test123' } -Body $body -ContentType 'application/json'
