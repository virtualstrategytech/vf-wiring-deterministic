Import-Module Microsoft.PowerShell.SecretManagement -ErrorAction Stop

try {
  $sec = Get-Secret -Name WEBHOOK_API_KEY -Vault MyLocalVault
} catch {
  Write-Error "Could not read WEBHOOK_API_KEY from MyLocalVault. Run: Set-Secret -Name WEBHOOK_API_KEY -Secret (Read-Host -AsSecureString 'Paste secret') -Vault MyLocalVault"
  exit 1
}

$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
$plain = ($plain -replace '[^\u0020-\u007E]','').Trim()

if ([string]::IsNullOrEmpty($plain)) { Write-Error "Sanitized secret is empty. Aborting."; exit 1 }

$env:WEBHOOK_API_KEY = $plain
if ([string]::IsNullOrEmpty($env:PORT)) { $env:PORT = '3000' }

Set-Location $PSScriptRoot
<#
start-webhook.ps1
Starts the webhook in the current PowerShell window. Ensures required envs are present
and prints a short message. This keeps behavior unchanged (runs npm start in-process).
#>
if ([string]::IsNullOrEmpty($env:WEBHOOK_API_KEY)) {
  Write-Warning "WEBHOOK_API_KEY is not set. The server may fail to start or accept requests."
}
Write-Output "Starting webhook in this window (secret not echoed)..."
try {
  npm start
} catch {
  Write-Error "Failed to start webhook via npm: $($_.Exception.Message)"
  exit 1
}
