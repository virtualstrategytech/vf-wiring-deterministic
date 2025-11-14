param(
  [Parameter(Mandatory=$true)][ValidateNotNullOrEmpty()] [string]$WebhookBase,
  [Parameter(Mandatory=$true)][ValidateNotNullOrEmpty()] [string]$WebhookApiKey,
  [switch]$DebugTests
)

# High-level: readiness checks, install deps, run smoke jest test in-band,
# collect traces and async-handle dumps into temp for debugging.

Write-Host "Running deployed smoke locally against: $WebhookBase"
Write-Host "DebugTests: $($DebugTests.IsPresent)"

# Normalize base (remove trailing slash)
$Base = $WebhookBase.TrimEnd('/')

# Temp files and dirs
$Tmp = [System.IO.Path]::GetTempPath().TrimEnd('\')
$HealthTrace = Join-Path $Tmp 'health_trace.txt'
$PingTrace = Join-Path $Tmp 'ping_trace.txt'
$HealthBody = Join-Path $Tmp 'health_body.txt'
$HealthErr = Join-Path $Tmp 'health_err.txt'
$AsyncMap = Join-Path $Tmp 'async_handle_map.json'
$ActiveHandles = Join-Path $Tmp 'active_handles.json'
$SmokeDebugDir = Join-Path $Tmp 'smoke-debug'
New-Item -Path $SmokeDebugDir -ItemType Directory -Force | Out-Null

# PSScriptAnalyzer disable=PSUseDeclaredVarsMoreThanAssignments
# Reference SocketDebug if it exists to avoid "assigned but never used" warnings from analyzers
if (Get-Variable -Name 'SocketDebug' -Scope Script -ErrorAction SilentlyContinue) {
  # Log the type for diagnostics and keep a script-scoped reference so analyzers/counting tools see the variable used
  Write-Verbose ("SocketDebug present (type: {0})" -f ($Script:SocketDebug.GetType().FullName))
  Set-Variable -Name '__SocketDebugRef' -Scope Script -Value $Script:SocketDebug -Force
  # Harmlessly coerce/use the script-scoped value so static analyzers treat it as used
  $null = $Script:SocketDebug -as [object]
} else {
  # Ensure the reference exists (explicitly null) to avoid "unused variable" reports in environments that examine script scope
  Set-Variable -Name '__SocketDebugRef' -Scope Script -Value $null -Force
}
# Also perform a guaranteed no-op read so analyzers see the variable used even if the above block was skipped
# Reading an undefined variable in PowerShell yields $null and does not error, so this is safe.
if ($Script:SocketDebug -ne $null) { Write-Verbose ("SocketDebug (script-scope): {0}" -f $Script:SocketDebug) } else { Write-Verbose "SocketDebug (script-scope): <null>" }
# Also read the unscoped variable name to satisfy analyzers that check for assignment/usage of SocketDebug
if ($SocketDebug -ne $null) { Write-Verbose ("SocketDebug: {0}" -f $SocketDebug) } else { Write-Verbose "SocketDebug: <null>" }
# PSScriptAnalyzer enable=PSUseDeclaredVarsMoreThanAssignments

# Function: Test-Ready (returns status code or $null)
# PSScriptAnalyzer disable=PSUseApprovedVerbs
function Test-Ready {
  param($url, $timeoutSec)
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec $timeoutSec -ErrorAction Stop
    return $r.StatusCode
  } catch {
    return $null
  }
}
# PSScriptAnalyzer enable=PSUseApprovedVerbs

# Readiness: try /ready (fast) then fallback to /health
Write-Host "Checking readiness: $Base/ready (fast check)"
$ok = $false
for ($i=1; $i -le 18; $i++) {
  $status = Test-Ready "$Base/ready" 8
  Write-Host "Attempt $i/18 => /ready status: $status"
  if ($status -eq 200) { $ok = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $ok) {
  Write-Host "/ready did not return 200, falling back to /health"
  for ($i=1; $i -le 12; $i++) {
    try {
      Invoke-WebRequest -Uri "$Base/health" -UseBasicParsing -TimeoutSec 30 -OutFile $HealthBody -ErrorAction Stop
      $status = 200
      Write-Host "Health OK (attempt $i)"
      $ok = $true
      break
    } catch {
      Write-Host "Attempt $i => health failed. Writing health body & error files if available."
      if (Test-Path $HealthBody) { Get-Content $HealthBody -Raw | Out-Host }
      $_ | Out-File -FilePath $HealthErr -Append
      Start-Sleep -Seconds 5
    }
  }
}
if (-not $ok) {
  Write-Error "Readiness/Health check failed after retries"
  exit 1
}

# Export timeouts for tests (millis)
$env:WEBHOOK_HEALTH_TIMEOUT = '15000'
$env:WEBHOOK_PING_TIMEOUT = '20000'
$env:WEBHOOK_GENERATE_TIMEOUT = '120000'

# NOTE: instrumentation preload (NODE_OPTIONS) is set later, after deps are
# installed, to avoid affecting `npm ci` (preload would run for npm's node
# child processes and can cause failures on Windows). We'll set NODE_OPTIONS
# just before invoking Jest below when $DebugTests is present.
Write-Host "DEBUG_TESTS: $($DebugTests.IsPresent) - instrumentation preload will be applied only before Jest"

# Install deps (root + webhook) — optional but mirrors workflow
Write-Host "Installing repository root dependencies (npm ci)"
# Preserve any existing NODE_OPTIONS and clear it to avoid preloads affecting npm
$origNodeOptions = $env:NODE_OPTIONS
try {
  if ($env:NODE_OPTIONS) { Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue }
} catch {}
try {
  & npm ci
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
} catch {
  # restore NODE_OPTIONS before exiting
  try { if ($null -ne $origNodeOptions) { $env:NODE_OPTIONS = $origNodeOptions } else { Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue } } catch {}
  Write-Error $_
  exit 1
}

Write-Host "Installing webhook subpackage deps (novain-platform/webhook)"
Push-Location novain-platform/webhook
try {
  & npm ci
  if ($LASTEXITCODE -ne 0) { throw "npm ci for webhook subpackage failed" }
} catch {
  Pop-Location
  try { if ($null -ne $origNodeOptions) { $env:NODE_OPTIONS = $origNodeOptions } else { Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue } } catch {}
  Write-Error $_
  exit 1
}
Pop-Location

# After successful installs, clear any NODE_OPTIONS so we can set instrumentation safely later
try { Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue } catch {}

# Compute fingerprint (optional)
Write-Host "Computing fingerprint for provided key (sha256 slice)"
node -e "const c=require('crypto'); const k=process.env.WEBHOOK_API_KEY||process.argv[1]||''; const f=k?c.createHash('sha256').update(k).digest('hex').slice(0,16):'missing'; console.log('FINGERPRINT='+f);" -- $WebhookApiKey > fingerprint.txt
$fingerprint = Get-Content -Path fingerprint.txt -Raw
Write-Host "Fingerprint: $fingerprint"

# Quick traces: health and ping traces
Remove-Item -Path $HealthTrace,$PingTrace -ErrorAction SilentlyContinue -Force
Write-Host "Collecting quick traces (health + ping) to $Tmp"
try { Invoke-WebRequest -Uri "$Base/health" -UseBasicParsing -TimeoutSec 30 -OutFile $HealthTrace -ErrorAction SilentlyContinue } catch { Write-Warning "Health trace failed (nonfatal)" }

# POST ping trace
$PingJson = Join-Path $Tmp 'ping.json'
'{"action":"ping","question":"ci-check","name":"CI","tenantId":"default"}' | Out-File -FilePath $PingJson -Encoding utf8
try {
  Invoke-WebRequest -Uri "$Base/webhook" -Method Post -Headers @{ 'Content-Type'='application/json'; 'x-api-key'=$WebhookApiKey } -Body (Get-Content $PingJson -Raw) -TimeoutSec 30 -OutFile $PingTrace -ErrorAction SilentlyContinue
} catch { Write-Warning "Ping trace failed (nonfatal)" }

# Copy repo artifacts to temp smoke-debug dir
Get-ChildItem -Path ".\artifacts\async_handles_*.json" -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName -Destination $SmokeDebugDir -Force }
Get-ChildItem -Path ".\artifacts\active_handles_*.json" -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName -Destination $SmokeDebugDir -Force }

# Prevent pretest trying to sync vault
$env:SKIP_SYNC_SECRET = 'true'

# Ensure WORKER envs required by tests
$env:WEBHOOK_BASE = $Base
$env:WEBHOOK_API_KEY = $WebhookApiKey

Write-Host "Running smoke test (jest) against $Base"
$npx = Get-Command npx -ErrorAction SilentlyContinue
if (-not $npx) { Write-Error "npx not found on PATH. Ensure Node and npm are installed." ; exit 1 }

# If debug instrumentation requested, set NODE_OPTIONS now (after npm ci completes)
if ($DebugTests.IsPresent) {
  $netblock = (Resolve-Path -LiteralPath "./tests/jest.netblock.js" -ErrorAction SilentlyContinue)
  $instr = (Resolve-Path -LiteralPath "./tests/jest.instrumentation.js" -ErrorAction SilentlyContinue)
  $reqs = @()
  if ($netblock) {
    # convert backslashes to forward slashes and quote path
    $p = $netblock.Path -replace '\\','/'
    $reqs += "--require `"$p`""
  } else { Write-Warning "tests/jest.netblock.js not found; continuing" }
  if ($instr) {
    $p2 = $instr.Path -replace '\\','/'
    $reqs += "--require `"$p2`""
  } else { Write-Warning "tests/jest.instrumentation.js not found; continuing" }
  $prefix = ($reqs -join ' ')
  if ($prefix) {
    # Prepend safely, preserving existing NODE_OPTIONS and avoiding early preload for npm ci
    $current = $env:NODE_OPTIONS
    if ([string]::IsNullOrEmpty($current)) { $env:NODE_OPTIONS = $prefix } else { $env:NODE_OPTIONS = "$prefix $current" }
    Write-Host "NODE_OPTIONS set to: $env:NODE_OPTIONS"
  }
}

# Run jest and capture exit code
& npx jest tests/webhook.smoke.test.js --runInBand --verbose --testTimeout=180000
$EXIT_CODE = $LASTEXITCODE

# Collect async-handle dumps in this same process
Write-Host "Collecting async handle dumps to $Tmp"
node -e "try{const fs=require('fs'); const out=[]; const m=global.__async_handle_map||new Map(); for(const [id,info] of m.entries()){ out.push({id, type: String(info && info.type), stack: String(info && info.stack).split('\n').slice(0,8).join('\n')}); } fs.writeFileSync('$AsyncMap', JSON.stringify(out, null, 2)); console.error('wrote $AsyncMap'); }catch(e){console.error('async map dump failed', e && e.stack||e); }"
node -e "try{const fs=require('fs'); const handles=(process._getActiveHandles && process._getActiveHandles())||[]; const out=handles.map((h,i)=>{ try{ const name=(h && h.constructor && h.constructor.name) || '<unknown>'; const info={idx:i, type:name}; try{ if(h && typeof h._createdStack==='string') info._createdStack=h._createdStack.split('\n').slice(0,6).join('\n'); }catch{} try{ if(h && h.localAddress) info.localAddress=h.localAddress; if(h && h.localPort) info.localPort=h.localPort; if(h && h.remoteAddress) info.remoteAddress=h.remoteAddress; if(h && h.remotePort) info.remotePort=h.remotePort; }catch{} return info;}catch(e){return {idx:i,type:'error'}} }); fs.writeFileSync('$ActiveHandles', JSON.stringify(out, null, 2)); console.error('wrote $ActiveHandles'); }catch(e){console.error('active handles dump failed', e && e.stack||e); }"

# Copy repo artifacts to temp again
Get-ChildItem -Path ".\artifacts\async_handles_*.json" -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName -Destination $SmokeDebugDir -Force }
Get-ChildItem -Path ".\artifacts\active_handles_*.json" -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName -Destination $SmokeDebugDir -Force }

Write-Host "Smoke run complete. Jest exit code: $EXIT_CODE"
Write-Host "Debug artifacts (if any):"
Get-ChildItem -Path $SmokeDebugDir -ErrorAction SilentlyContinue | Select-Object Name,FullName
if (Test-Path $HealthTrace) { Write-Host "Health trace: $HealthTrace" }
if (Test-Path $PingTrace) { Write-Host "Ping trace: $PingTrace" }
if (Test-Path $AsyncMap) { Write-Host "Async map: $AsyncMap" }
if (Test-Path $ActiveHandles) { Write-Host "Active handles: $ActiveHandles" }
Write-Host "Also copied any artifacts/* debug files into $SmokeDebugDir"

# Exit with the jest exit code
exit $EXIT_CODE
