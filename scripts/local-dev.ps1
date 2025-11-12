# Usage: from repo root: .\scripts\local-dev.ps1

Set-StrictMode -Version Latest

# Ensure `.gitignore` contains our local generated-test ignores to avoid
# interactive one-liners accidentally piping FileInfo objects into Select-String.
try {
  $ensureScript = Join-Path $PSScriptRoot 'ensure-gitignore.ps1'
  if (Test-Path $ensureScript) { & $ensureScript } else { Write-Verbose "ensure-gitignore.ps1 not found; skipping" }
} catch {
  Write-Warning "ensure-gitignore.ps1 failed: $_"   # non-fatal
}

$repoRoot = (Resolve-Path .).Path
$webhookDir = Join-Path $repoRoot 'novain-platform\webhook'
$envFile = Join-Path $repoRoot '.env'
$envExample = Join-Path $repoRoot '.env.example'
$backupDir = Join-Path $repoRoot 'local_backups'
$serverFile = Join-Path $webhookDir 'server.js'

# Ensure backup dir exists
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

# 1) Ensure .env exists (backup existing)
if (Test-Path $envFile) {
  $ts = (Get-Date -Format yyyyMMddHHmmss)
  $bk = Join-Path $backupDir ".env.bak_$ts"
  Move-Item -Path $envFile -Destination $bk -Force
  Write-Output ".env found and moved to $bk"
}
if (-not (Test-Path -Path $envFile -PathType Any -ErrorAction SilentlyContinue)) {
  if (Test-Path $envExample) {
    Copy-Item -Path $envExample -Destination $envFile -Force
    Write-Output ".env created from .env.example - edit $envFile with real values before pushing"
  } else {
    Write-Output "No .env.example present; create .env manually if needed."
  }
}

# 2) Parse .env into a hashtable (simple KEY=VALUE parser)
$envMap = @{}
# Only attempt to read the file if it exists — previous logic may have
# skipped creating a .env (no .env.example present). Guard to avoid errors.
if (Test-Path -Path $envFile -PathType Leaf -ErrorAction SilentlyContinue) {
  Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and ($line.StartsWith('#') -eq $false)) {
      $parts = $line -split '=', 2
      if ($parts.Length -eq 2) {
        $k = $parts[0].Trim()
        $v = $parts[1].Trim()
        $envMap[$k] = $v
      }
    }
  }
} else {
  Write-Output ".env not found; proceeding with empty env map."
}

# Determine port (default 3000)
$port = if ($envMap.ContainsKey('PORT') -and $envMap['PORT']) { $envMap['PORT'] } else { '3000' }

# 3) Install webhook deps if node_modules missing
if ((Test-Path -Path (Join-Path $webhookDir 'node_modules') -PathType Any -ErrorAction SilentlyContinue) -eq $false) {
  Write-Output "Installing webhook dependencies in $webhookDir ..."
  Push-Location $webhookDir
  npm install
  Pop-Location
} else {
  Write-Output "Webhook node_modules present."
}

# 4) Build env set commands for new process
$envCmds = @()
foreach ($k in $envMap.Keys) {
  $val = $envMap[$k] -replace "'", "''"   # escape single quote for PowerShell single-quoted string
  $envCmds += "$([string]('$env:' + $k)) = '$val'"
}
$envCmdsString = $envCmds -join '; '

if ((Test-Path -Path $serverFile -PathType Any -ErrorAction SilentlyContinue) -eq $false) {
  Write-Error "Server file not found: $serverFile"
  exit 1
}

# 5) Start the server in a new PowerShell window (keeps it running)
$startCmd = if ($envCmdsString) { "$envCmdsString; node .\server.js" } else { "node .\server.js" }
Start-Process powershell -ArgumentList '-NoExit', '-Command', $startCmd -WorkingDirectory $webhookDir
Write-Output "Started server in new PowerShell window (working dir: $webhookDir). Waiting for startup..."

# 6) Wait and run smoke tests locally
Start-Sleep -Seconds 3

$healthUrl = "http://localhost:$port/health"
$webhookUrl = "http://localhost:$port/webhook"
try {
  $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 5
  Write-Output "Health check response:"
  Write-Output $health
} catch {
  Write-Error "Health check failed: $($_.Exception.Message)"
}

$body = @{ action = 'ping'; question = 'hello'; name = 'LocalTest' } | ConvertTo-Json
try {
  $resp = Invoke-RestMethod -Method Post -Uri $webhookUrl -Headers @{ 'x-api-key' = $envMap['WEBHOOK_API_KEY'] } -Body $body -ContentType 'application/json' -TimeoutSec 10
  Write-Output "Webhook ping response:"
  $resp | ConvertTo-Json -Depth 5
} catch {
  Write-Error "Webhook ping failed: $($_.Exception.Response.Content | Out-String)"
}

Write-Output "Done. Server window remains open. Stop it by closing the window or pressing Ctrl+C there."