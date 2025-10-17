Import-Module Microsoft.PowerShell.SecretManagement -ErrorAction Stop

try {
  $sec = Get-Secret -Name WEBHOOK_API_KEY -Vault MyLocalVault
} catch {
  Write-Error "Could not read WEBHOOK_API_KEY from MyLocalVault. Run: Set-Secret -Name WEBHOOK_API_KEY -Secret (Read-Host -AsSecureString 'Paste secret') -Vault MyLocalVault"
  exit 1
}

$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
$plain = ($plain -replace '[^\u0020-\u007E]','').Trim()

if (-not $plain) { Write-Error "Sanitized secret is empty. Aborting."; exit 1 }

$env:WEBHOOK_API_KEY = $plain

# run tests from repo root
Set-Location (Resolve-Path "$PSScriptRoot\..")
npm test

Remove-Item Env:\WEBHOOK_API_KEY -ErrorAction SilentlyContinue
