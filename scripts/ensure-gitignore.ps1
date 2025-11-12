<#
Ensure-GitIgnoreEntries

Safely ensure that one or more entries exist in the repository `.gitignore`.
This script reads the `.gitignore` file as raw text and uses regex-safe
matching to decide whether to append entries. It avoids piping FileInfo
objects into `Select-String`, which causes the PowerShell "input object cannot
be bound" error seen when piping non-string objects.

Usage (from repo root):
  pwsh .\scripts\ensure-gitignore.ps1

Custom entries can be passed by -Entries parameter. If not provided, the
script will ensure the common generated-test-artifact entries used in the
project.
#>

param(
  [string[]]$Entries = @( 
    'tests/listener_dump.json',
    'tests/handle_dump.json',
    'tests/dump_handles_preload.js',
    'tests/trace_connect_preload.js',
    '.github_artifacts/'
  ),
  [string]$GitIgnorePath
)

Set-StrictMode -Version Latest

if (-not $GitIgnorePath) {
  # Script lives in scripts/ — repo root is parent
  $repoRoot = Resolve-Path -Path (Join-Path $PSScriptRoot '..')
  $GitIgnorePath = Join-Path $repoRoot.Path '.gitignore'
}

# Ensure .gitignore exists
if (-not (Test-Path -Path $GitIgnorePath -PathType Leaf -ErrorAction SilentlyContinue)) {
  New-Item -Path $GitIgnorePath -ItemType File -Force | Out-Null
  Write-Output "Created new .gitignore at ${GitIgnorePath}"
}

# Read file as a single string to avoid piping object types into Select-String
$gitRaw = Get-Content -Path $GitIgnorePath -Raw -ErrorAction SilentlyContinue
if ($null -eq $gitRaw) { $gitRaw = '' }

$added = @()
foreach ($entry in $Entries) {
  $escaped = [regex]::Escape($entry)
  if (-not ($gitRaw -match $escaped)) {
    Add-Content -Path $GitIgnorePath -Value "`n# ignore generated test artifact`n$entry"
    $added += $entry
    # keep our copy of the raw content in sync so repeated runs don't re-add
    $gitRaw += "`n$entry"
  }
}

if ($added.Count -gt 0) {
  Write-Output "Added the following entries to ${GitIgnorePath}:"
  $added | ForEach-Object { Write-Output " - $_" }
} else {
  Write-Output "No changes; all entries already present in ${GitIgnorePath}."
}

# Return success code
exit 0
