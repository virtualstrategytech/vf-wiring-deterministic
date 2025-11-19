<#
run_mock.ps1
Starts the mock business server from the webhook folder. Keeps behavior identical but
adds a small startup message and error handling for clearer failures.
#>
Set-Location $PSScriptRoot
Write-Output "Starting mock business server (mock_business_server.js) in $PSScriptRoot"
try {
	node .\mock_business_server.js
} catch {
	Write-Error "Failed to start mock server: $($_.Exception.Message)"
	exit 1
}
