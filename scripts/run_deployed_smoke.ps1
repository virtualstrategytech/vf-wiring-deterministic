param(
  [Parameter(Mandatory=$true)]
  [string]$WebhookBase,
  [Parameter(Mandatory=$true)]
  [string]$ApiKey
)

Write-Host "Running deployed smoke tests against: $WebhookBase"

# Set envs for the smoke test runner
$env:WEBHOOK_BASE = $WebhookBase
$env:WEBHOOK_API_KEY = $ApiKey
$env:SKIP_SYNC_SECRET = 'true'

# Run Jest against the smoke test file only
Write-Host "Invoking smoke tests..."
npx jest tests/webhook.smoke.test.js -t "webhook smoke" --runInBand

if ($LASTEXITCODE -ne 0) {
  Write-Error "Smoke tests failed with exit code $LASTEXITCODE"
  exit $LASTEXITCODE
}

Write-Host "Smoke tests completed successfully."
