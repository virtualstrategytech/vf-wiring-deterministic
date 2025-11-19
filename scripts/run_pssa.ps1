# scripts/run_pssa.ps1
# Run PSScriptAnalyzer across the repo and write JSON report to artifacts/pssa_report.json
$repoRoot = 'C:\Users\peais\Documents\Virtual Strategy Tech\VST NovAIn Voiceflow\vf-wiring-deterministic'
Set-Location -LiteralPath $repoRoot
if (-not (Test-Path artifacts)) { New-Item -ItemType Directory -Path artifacts | Out-Null }

try {
  if (-not (Get-Module -ListAvailable -Name PSScriptAnalyzer)) {
    Write-Output 'PSScriptAnalyzer not found; installing for current user (may prompt).' 
    Install-Module -Name PSScriptAnalyzer -Scope CurrentUser -Force -AllowClobber -Confirm:$false -ErrorAction Stop
  } else {
    Write-Output 'PSScriptAnalyzer already available.'
  }
} catch {
  Write-Output "Failed to install PSScriptAnalyzer: $($_.Exception.Message)"
  exit 2
}

try {
  Write-Output 'Running Invoke-ScriptAnalyzer (this may take a few seconds)...'
  $results = Invoke-ScriptAnalyzer -Path . -Recurse -Severity Error,Warning -IncludeRule * -ErrorAction SilentlyContinue
  if ($null -eq $results -or $results.Count -eq 0) {
    Write-Output 'Invoke-ScriptAnalyzer returned no findings.'
    # Still write an empty JSON array for consistency
    @() | ConvertTo-Json -Depth 5 | Out-File -Encoding utf8 artifacts/pssa_report.json
    Write-Output 'Wrote empty artifacts/pssa_report.json'
    exit 0
  }
  $results | ConvertTo-Json -Depth 10 | Out-File -Encoding utf8 artifacts/pssa_report.json
  Write-Output 'PSScriptAnalyzer report written to artifacts/pssa_report.json'
  exit 0
} catch {
  Write-Output "PSScriptAnalyzer run failed: $($_.Exception.Message)"
  exit 3
}
