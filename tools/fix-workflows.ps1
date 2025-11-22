# tools/fix-workflows.ps1
# Normalize all workflow YAML files: LF line endings, ASCII quotes, strip NBSP and control chars

[CmdletBinding()]
param(
  [string]$Root = ".github/workflows"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Characters we want to normalize
$singleCurly = ([char]0x2018) + ([char]0x2019)   # ‘ ’
$doubleCurly = ([char]0x201C) + ([char]0x201D)   # “ ”

# Find all workflow YAMLs
$files = Get-ChildItem -LiteralPath $Root -Include *.yml,*.yaml -Recurse -File

foreach ($f in $files) {
  $t = Get-Content -LiteralPath $f.FullName -Raw -Encoding utf8

  # Normalize CRLF -> LF
  $t = $t -replace "`r", ""

  # Replace curly quotes with straight ASCII
  $t = $t -replace "[$singleCurly]", "'"
  $t = $t -replace "[$doubleCurly]", '"'

  # Replace NBSP with a normal space
  $t = $t -replace [char]0x00A0, ' '

  # Strip all control chars except TAB (0x09) and LF (0x0A)
  $t = [regex]::Replace($t, '[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]', '')

  Set-Content -LiteralPath $f.FullName -Value $t -Encoding utf8 -NoNewline
  Write-Host "Fixed $($f.FullName)"
}
