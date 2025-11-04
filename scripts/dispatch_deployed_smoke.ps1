<#
Dispatch the deployed-smoke workflow three times using GitHub CLI (`gh`).
Prereqs:
 - GitHub CLI installed and authenticated (`gh auth login`).
 - You have `workflow` permission for the repository.
Usage:
  $env:WEBHOOK_BASE = 'https://your-deployed-webhook.example'
  .\scripts\dispatch_deployed_smoke.ps1

This script will run the workflow on the current branch (or specify -Ref).
#>
param(
  [string]$Repo = 'virtualstrategytech/vf-wiring-deterministic',
  [string]$WorkflowFile = 'deployed-smoke.yml',
  [string]$Ref = 'wiring-agent-fixes/catch-cleanup',
  [int]$Runs = 3
)

if (-not $env:WEBHOOK_BASE) {
  Write-Host "Please set `WEBHOOK_BASE` env var before running, e.g."
  Write-Host "  $env:WEBHOOK_BASE = 'https://your-webhook.example'"
  exit 1
}

# Ensure gh is present
$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) {
  Write-Error "GitHub CLI 'gh' not found in PATH. Install it: https://cli.github.com/"
  exit 2
}

for ($i = 1; $i -le $Runs; $i++) {
  Write-Host "Dispatching run #$i against ref '$Ref'..."
  $out = gh workflow run $WorkflowFile --repo $Repo --ref $Ref --field WEBHOOK_BASE=$env:WEBHOOK_BASE --field DEBUG_TESTS=true 2>&1
  Write-Host $out
  # Try to extract run URL
  if ($out -match 'https://github.com/.*/actions/runs/\d+') {
    $match = ($out -match 'https://github.com/.*/actions/runs/\d+') | Out-Null
    $url = ($out -split '\s+' | Where-Object { $_ -match 'https://github.com/.*/actions/runs/\d+' })[0]
    if ($url) { Write-Host "Workflow run created: $url" }
  }
  Start-Sleep -Seconds 5
}

Write-Host "Dispatched $Runs runs. Monitor the Actions page for artifacts; set DEBUG_TESTS=true to collect diagnostics."