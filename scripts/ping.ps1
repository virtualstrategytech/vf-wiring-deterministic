$params = @{
  Uri = "$env:WEBHOOK_URL/webhook"
  Method = 'Post'
  Headers = @{ 'x-api-key' = $env:WEBHOOK_API_KEY }
  ContentType = 'application/json'
  Body = '{"action":"ping","question":"hi"}'
}
Invoke-RestMethod @params
