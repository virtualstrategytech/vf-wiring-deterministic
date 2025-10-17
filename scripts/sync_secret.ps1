Import-Module Microsoft.PowerShell.SecretManagement -ErrorAction Stop

# Path to secret file (repo-root\tests\webhook.secret)
$secretFile = Resolve-Path -Path (Join-Path $PSScriptRoot '..\tests\webhook.secret') -ErrorAction SilentlyContinue
if (-not $secretFile) {
  $secretFile = Join-Path $PSScriptRoot '..\tests\webhook.secret'
} else {
  $secretFile = $secretFile.Path
}

try {
  # Read secure string from vault (you will be prompted for the vault password if required)
  $sec = Get-Secret -Name WEBHOOK_API_KEY -Vault MyLocalVault
} catch {
  Write-Error "Could not read WEBHOOK_API_KEY from MyLocalVault: $_"
  exit 1
}

$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
$plain = ($plain -replace '[^\u0020-\u007E]','').Trim()

if (-not $plain) {
  Write-Error "Sanitized secret is empty. Aborting."
  exit 1
}

# Ensure tests directory exists
if (-not (Test-Path (Join-Path $PSScriptRoot '..\tests'))) { New-Item -ItemType Directory -Path (Join-Path $PSScriptRoot '..\tests') | Out-Null }

# Write file (no newline)
Set-Content -Path $secretFile -Value $plain -NoNewline -Encoding utf8

Write-Output "Secret written to $secretFile (local only)."