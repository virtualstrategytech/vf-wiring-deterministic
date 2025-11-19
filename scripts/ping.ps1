param(
  [Parameter(Mandatory=$false)] [string]$WebhookUrl = $env:WEBHOOK_URL,
  [Parameter(Mandatory=$false)] [string]$ApiKey = $env:WEBHOOK_API_KEY
)

$params = @{
  Uri = "$WebhookUrl/webhook"
  Method = 'Post'
  Headers = @{ 'x-api-key' = $ApiKey }
  ContentType = 'application/json'
  Body = '{"action":"ping","question":"hi"}'
}

try {
  Invoke-RestMethod @params -ErrorAction Stop
  Write-Output "Ping posted to $($params.Uri)"
} catch {
  Write-Error "Ping failed: $($_.Exception.Message)"
  exit 1
}
