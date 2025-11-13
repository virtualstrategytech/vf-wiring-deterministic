# If the SecretManagement module isn't available, skip syncing from vault and
# try to fall back to environment or an existing local secret file. This keeps
# pretest from failing in CI or on machines that don't have the module.
if (-not (Get-Module -ListAvailable -Name Microsoft.PowerShell.SecretManagement)) {
  Write-Output "Microsoft.PowerShell.SecretManagement not installed; skipping vault sync."
  # If an env var exists, surface that message and exit success so tests can continue.
  if ($env:WEBHOOK_API_KEY) { Write-Output "Using WEBHOOK_API_KEY from environment." }
  else { Write-Output "No WEBHOOK_API_KEY env var set; tests/globalSetup will generate a local test key if needed." }
  exit 0
}

# Path to secret file (repo-root\tests\webhook.secret)
$secretFile = Resolve-Path -Path (Join-Path $PSScriptRoot '..\tests\webhook.secret') -ErrorAction SilentlyContinue
if (-not $secretFile) {
  $secretFile = Join-Path $PSScriptRoot '..\tests\webhook.secret'
} else {
  $secretFile = $secretFile.Path
}

# Try to read from the vault, but fall back to env var or an existing file.
try {
  Import-Module Microsoft.PowerShell.SecretManagement -ErrorAction Stop
  $sec = Get-Secret -Name WEBHOOK_API_KEY -Vault MyLocalVault -ErrorAction Stop
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  $plain = ($plain -replace '[^\u0020-\u007E]','').Trim()
  Write-Output "Read secret from MyLocalVault (sanitized length=$(($plain).Length))."
} catch {
  Write-Warning "Could not read from MyLocalVault: $_"
  # Try environment variable
  if ($env:WEBHOOK_API_KEY) {
    $plain = $env:WEBHOOK_API_KEY
    Write-Output "Using WEBHOOK_API_KEY from environment (length=$(($plain).Length))."
  } elseif (Test-Path $secretFile) {
    try {
      $plain = Get-Content -Path $secretFile -Raw
      $plain = $plain.Trim()
      Write-Output "Using existing secret file $secretFile (length=$(($plain).Length))."
    } catch {
      Write-Warning "Failed to read existing secret file: $_"
      $plain = ''
    }
  } else {
    Write-Output "No vault secret, env var, or local secret file found; skipping sync. Tests may generate a local key."
    exit 0
  }
}

$plain = ($plain -replace '[^\u0020-\u007E]','').Trim()

if (-not $plain) {
  Write-Warning "Sanitized secret is empty after fallback. Skipping write and exiting successfully."
  exit 0
}

# Ensure tests directory exists
if (-not (Test-Path (Join-Path $PSScriptRoot '..\tests'))) { New-Item -ItemType Directory -Path (Join-Path $PSScriptRoot '..\tests') | Out-Null }

# Write file (no newline)
try {
  Set-Content -Path $secretFile -Value $plain -NoNewline -Encoding utf8
  Write-Output "Secret written to $secretFile (local only)."
} catch {
  Write-Warning "Failed to write secret file: $_"
  # Exit success to avoid blocking tests — globalSetup will generate a key if necessary.
  exit 0
}