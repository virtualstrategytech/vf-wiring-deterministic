param(
  [Parameter(Mandatory=$true)][ValidateNotNullOrEmpty()] [string]$WebhookBase,
  [Parameter(Mandatory=$true)][ValidateNotNullOrEmpty()] [string]$ApiKey
)

Write-Output "Running deployed smoke tests against: $WebhookBase"

# Set envs for the smoke test runner
$env:WEBHOOK_BASE = $WebhookBase
$env:WEBHOOK_API_KEY = $ApiKey
$env:SKIP_SYNC_SECRET = 'true'

# Run Jest against the smoke test file only
Write-Output "Invoking smoke tests..."
try {
  npx jest tests/webhook.smoke.test.js -t "webhook smoke" --runInBand
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Smoke tests failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
  }
  Write-Output "Smoke tests completed successfully."
} catch {
  Write-Error "Failed to run smoke tests: $($_.Exception.Message)"
  exit 2
}
