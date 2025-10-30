# Run PSScriptAnalyzer across the repo and write JSON report to artifacts/pssa_report.json
New-Item -ItemType Directory -Path .\artifacts -Force | Out-Null
if (-not (Get-Command Invoke-ScriptAnalyzer -ErrorAction SilentlyContinue)) {
  Write-Output 'PSScriptAnalyzer missing; attempting Install-Module (may require network access)'
  Install-Module -Name PSScriptAnalyzer -Scope CurrentUser -Force -AllowClobber -ErrorAction Stop
}
$results = Invoke-ScriptAnalyzer -Path . -Recurse -ErrorAction SilentlyContinue
if ($null -eq $results -or $results.Count -eq 0) {
  Write-Output 'No PSScriptAnalyzer findings (empty result).'
  exit 0
}
$results | Select-Object @{n='File';e={$_.ScriptName}}, Line, RuleName, Severity, Message | ConvertTo-Json -Depth 6 | Out-File -FilePath .\artifacts\pssa_report.json -Encoding utf8
Write-Output "PSScriptAnalyzer run complete; report written to artifacts\pssa_report.json"