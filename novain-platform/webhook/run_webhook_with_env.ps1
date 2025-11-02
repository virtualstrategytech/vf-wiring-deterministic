<#
Runs the webhook server with recommended environment values for local development.
This script ensures it runs from the webhook folder and sets a sane default env.
#>
Set-Location $PSScriptRoot

# Set defaults only when not already provided in the environment
if ([string]::IsNullOrEmpty($env:WEBHOOK_API_KEY)) { $env:WEBHOOK_API_KEY = "{WEBHOOK_KEY}" }
if ([string]::IsNullOrEmpty($env:PORT)) { $env:PORT = "3000" }
if ([string]::IsNullOrEmpty($env:BUSINESS_URL)) { $env:BUSINESS_URL = "http://127.0.0.1:4000" }

Write-Output "Starting webhook (PORT=$($env:PORT)) - logs will appear in this window"

try {
	# Run in-process so logs appear here (matching previous behavior)
	node .\server.js
} catch {
	Write-Error "Failed to start webhook: $($_.Exception.Message)"
	exit 1
}

