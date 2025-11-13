param(
  [string]$ApiKey = 'test123',
  [int]$WebhookPort = 3000,
  [int]$PromptsPort = 4001,
  [int]$MockBizPort = 4002,
  [string]$DeployedWebhookUrl = ''  # NEW: optional public URL (https://your-service.onrender.com)
)


# Consolidated setup: ensure logs, env and helper function are defined once
New-Item -ItemType Directory -Path (Join-Path (Get-Location) 'logs') -Force | Out-Null
Write-Output -InputObject ("Running webhook verification from: {0}" -f (Get-Location).Path)

# Ensure local .env exists (safe copy from example)
if (Test-Path -Path '.\.env' -PathType Any -ErrorAction SilentlyContinue -eq $false) {
  if (Test-Path '.\env\.example.env') {
    Copy-Item '.\env\.example.env' '.\.env' -Force
    Write-Output 'Copied env/.example.env -> .env (edit .env if needed)'
  } else {
    Write-Output 'No env/.example.env found; continuing (you can set envs inline)'
  }
}

# define helper before any calls
function PostJson($uri, $body) {
  try {
    $resp = Invoke-RestMethod -Uri $uri -Method Post -Headers @{ 'x-api-key' = $ApiKey } -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 6) -TimeoutSec 20
  Write-Output -InputObject ("POST {0} -> OK" -f $uri)
    return ($resp | ConvertTo-Json -Depth 6)
  } catch {
  Write-Output -InputObject ("POST {0} -> ERROR: {1}" -f $uri, $_)
    return $null
  }
}

# If a deployed URL is provided, skip starting local webhook and run checks against it.
if (-not [string]::IsNullOrEmpty($DeployedWebhookUrl)) {
  Write-Output -InputObject ("Testing deployed webhook at {0}" -f $DeployedWebhookUrl)
  $base = $DeployedWebhookUrl.TrimEnd('/')
  # health endpoint (some deployments may not expose /health publicly)
  try { $h = Invoke-RestMethod -Uri "$base/health" -Method Get -Headers @{ 'x-api-key' = $ApiKey } -TimeoutSec 10; Write-Output -InputObject ("health -> $h") } catch { Write-Output -InputObject ("health failed: $_") }
  PostJson "$base/webhook" @{ action='ping'; question='hello'; name='Verifier'; tenantId='default' } | Out-File -FilePath .\logs\webhook_ping_deployed.json -Force
  Write-Output -InputObject 'Deployed tests saved to .\logs\*'
  return
}
# (setup already performed above)
# Start services in new PowerShell windows
$webhookCmd = "Set-Location -LiteralPath 'novain-platform/webhook'; `$env:WEBHOOK_API_KEY='$ApiKey'; `$env:PORT='$WebhookPort'; `$env:RETRIEVAL_URL='http://localhost:$MockBizPort/v1/retrieve'; `$env:PROMPT_URL='http://localhost:$PromptsPort'; node server.js"
Start-Process -FilePath pwsh -ArgumentList '-NoExit','-Command',$webhookCmd -WorkingDirectory (Get-Location).Path
Start-Sleep -Seconds 1

if (Test-Path '.\novain-platform\prompts\server.js') {
  $promptsCmd = "Set-Location -LiteralPath 'novain-platform/prompts'; `$env:PORT='$PromptsPort'; node server.js"
  Start-Process -FilePath pwsh -ArgumentList '-NoExit','-Command',$promptsCmd -WorkingDirectory (Get-Location).Path
  Start-Sleep -Seconds 1
} else { Write-Output -InputObject 'prompts server not present - skipping start' }

if (Test-Path '.\novain-platform\webhook\mock_business_server.js') {
  $mockCmd = "Set-Location -LiteralPath 'novain-platform/webhook'; `$env:PORT='$MockBizPort'; node mock_business_server.js"
  Start-Process -FilePath pwsh -ArgumentList '-NoExit','-Command',$mockCmd -WorkingDirectory (Get-Location).Path
  Start-Sleep -Seconds 1
} else { Write-Output -InputObject 'mock_business_server.js not present - skip mock start' }

Start-Sleep -Seconds 2

# Local smoke tests against the webhook
$base = "http://localhost:$WebhookPort"
Write-Output -InputObject ("Checking health: {0}/health" -f $base)
try {
  $h = Invoke-RestMethod -Uri "$base/health" -Method Get -TimeoutSec 5
  Write-Output -InputObject ("health -> {0}" -f $h)
} catch {
  Write-Output -InputObject ("health failed: {0}" -f $_)
}