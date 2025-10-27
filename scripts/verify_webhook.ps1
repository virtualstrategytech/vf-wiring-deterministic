param(
  [string]$ApiKey = 'test123',
  [int]$WebhookPort = 3000,
  [int]$PromptsPort = 4001,
  [int]$MockBizPort = 4002,
  [string]$DeployedWebhookUrl = ''  # NEW: optional public URL (https://your-service.onrender.com)
)


# ensure logs dir exists
New-Item -ItemType Directory -Path (Join-Path (Get-Location) 'logs') -Force | Out-Null

Write-Output 'Running webhook verification from: ' + (Get-Location).Path

# Ensure local .env exists (safe copy from example)
if (-not (Test-Path .\.env)) {
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
    Write-Output "POST $uri -> OK"
    return ($resp | ConvertTo-Json -Depth 6)
  } catch {
    Write-Output "POST $uri -> ERROR: $_"
    return $null
  }
}

# If a deployed URL is provided, skip starting local webhook and run checks against it.
if ($DeployedWebhookUrl -ne '') {
  Write-Output "Testing deployed webhook at $DeployedWebhookUrl"
  $base = $DeployedWebhookUrl.TrimEnd('/')
  # health endpoint (some deployments may not expose /health publicly)
  try { $h = Invoke-RestMethod -Uri "$base/health" -Method Get -Headers @{ 'x-api-key' = $ApiKey } -TimeoutSec 10; Write-Output "health -> $h" } catch { Write-Output "health failed: $_" }
  PostJson "$base/webhook" @{ action='ping'; question='hello'; name='Verifier'; tenantId='default' } | Out-File -FilePath .\logs\webhook_ping_deployed.json -Force
  Write-Output 'Deployed tests saved to .\logs\*'
  return
}
# ensure logs dir exists
New-Item -ItemType Directory -Path (Join-Path (Get-Location) 'logs') -Force | Out-Null

Write-Output 'Running webhook verification from: ' + (Get-Location).Path

# Ensure local .env exists (safe copy from example)
if (-not (Test-Path .\.env)) {
  if (Test-Path '.\env\.example.env') {
    Copy-Item '.\env\.example.env' '.\.env' -Force
    Write-Output 'Copied env/.example.env -> .env (edit .env if needed)'
  } else {
    Write-Output 'No env/.example.env found; continuing (you can set envs inline)'
  }
}

# If a deployed URL is provided, skip starting local webhook and run checks against it.
if ($DeployedWebhookUrl -ne '') {
  Write-Output "Testing deployed webhook at $DeployedWebhookUrl"
  $base = $DeployedWebhookUrl.TrimEnd('/')
  # health endpoint (some deployments may not expose /health publicly)
  try { $h = Invoke-RestMethod -Uri "$base/health" -Method Get -Headers @{ 'x-api-key' = $ApiKey } -TimeoutSec 10; Write-Output "health -> $h" } catch { Write-Output "health failed: $_" }
  PostJson "$base/webhook" @{ action='ping'; question='hello'; name='Verifier'; tenantId='default' } | Out-File -FilePath .\logs\webhook_ping_deployed.json -Force
  Write-Output 'Deployed tests saved to .\logs\*'
  return
}
# Start services in new PowerShell windows
$webhookCmd = "Set-Location -LiteralPath 'novain-platform/webhook'; `$env:WEBHOOK_API_KEY='$ApiKey'; `$env:PORT='$WebhookPort'; `$env:RETRIEVAL_URL='http://localhost:$MockBizPort/v1/retrieve'; `$env:PROMPT_URL='http://localhost:$PromptsPort'; node server.js"
Start-Process -FilePath pwsh -ArgumentList '-NoExit','-Command',$webhookCmd -WorkingDirectory (Get-Location).Path
Start-Sleep -Seconds 1

if (Test-Path '.\novain-platform\prompts\server.js') {
  $promptsCmd = "Set-Location -LiteralPath 'novain-platform/prompts'; `$env:PORT='$PromptsPort'; node server.js"
  Start-Process -FilePath pwsh -ArgumentList '-NoExit','-Command',$promptsCmd -WorkingDirectory (Get-Location).Path
  Start-Sleep -Seconds 1
} else { Write-Output 'prompts server not present - skipping start' }

if (Test-Path '.\novain-platform\webhook\mock_business_server.js') {
  $mockCmd = "Set-Location -LiteralPath 'novain-platform/webhook'; `$env:PORT='$MockBizPort'; node mock_business_server.js"
  Start-Process -FilePath pwsh -ArgumentList '-NoExit','-Command',$mockCmd -WorkingDirectory (Get-Location).Path
  Start-Sleep -Seconds 1
} else { Write-Output 'mock_business_server.js not present - skip mock start' }

Start-Sleep -Seconds 2

# Local smoke tests against the webhook
$base = "http://localhost:$WebhookPort"
Write-Output "Checking health: $base/health"
try {
  $h = Invoke-RestMethod -Uri "$base/health" -Method Get -TimeoutSec 5
  Write-Output "health -> $h"
} catch {
  Write-Output "health failed: $_"
}

function PostJson($uri, $body) {
  try {
    $resp = Invoke-RestMethod -Uri $uri -Method Post -Headers @{ 'x-api-key' = $ApiKey } -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 6) -TimeoutSec 20
    Write-Output "POST $uri -> OK"
    return ($resp | ConvertTo-Json -Depth 6)
  } catch {
    Write-Output "POST $uri -> ERROR: $_"
    return $null
  }
}

# run tests and save outputs (logs/ guaranteed to exist above)
PostJson "$base/webhook" @{ action='ping'; question='hello'; name='Verifier'; tenantId='default' } | Out-File -FilePath .\logs\webhook_ping.json -Force
PostJson "$base/webhook" @{ action='generate_quiz'; question='Quiz me on SPQA'; tenantId='default' } | Out-File -FilePath .\logs\webhook_generate_quiz.json -Force
PostJson "$base/webhook" @{ action='generate_lesson'; question='Teach me SPQA'; tenantId='default' } | Out-File -FilePath .\logs\webhook_generate_lesson.json -Force
PostJson "$base/webhook" @{ action='retrieve'; question='What is SPQA?'; tenantId='default'; topK=5 } | Out-File -FilePath .\logs\webhook_retrieve.json -Force
PostJson "$base/webhook" @{ action='export_lesson'; title='SPQA Lesson'; lesson=@{ content='Sample'; objectives=@('o1','o2'); keyTakeaways=@('k1') } } | Out-File -FilePath .\logs\webhook_export_lesson.json -Force

try {
  $dl = Invoke-RestMethod -Uri "$base/export_lesson_file" -Method Post -Headers @{ 'x-api-key' = $ApiKey } -ContentType 'application/json' -Body (@{ title='SPQA Lesson'; lesson=@{ content='Use SPQA...' } } | ConvertTo-Json) -TimeoutSec 30 -ErrorAction Stop
  $dl | ConvertTo-Json -Depth 6 | Out-File .\logs\export_lesson_file_response.json -Force
  Write-Output 'export_lesson_file returned; saved to .\logs\export_lesson_file_response.json'
} catch {
  Write-Output "export_lesson_file failed: $_"
}

Write-Output 'Logs saved to .\logs\*.json - review responses.'
Write-Output ("Next: set Voiceflow globals 'WEBHOOK_URL' -> (use ngrok or public URL) and 'WEBHOOK_API_KEY' -> {0} (see wiring/globals.map.md and variables.md)" -f $ApiKey)