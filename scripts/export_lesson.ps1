$body = @{
  action='export_lesson'
  title='SPQA Lesson'
  lesson=@{ content='SPQA basics...' }
} | ConvertTo-Json -Depth 6

Invoke-RestMethod -Uri "$env:WEBHOOK_URL/webhook" `
  -Headers @{ 'x-api-key'=$env:WEBHOOK_API_KEY } `
  -ContentType 'application/json' -Method Post -Body $body
