Param(
  [string]$Root = '.github/workflows'
)

$ErrorActionPreference = 'Stop'

Get-ChildItem -Path $Root -Filter *.yml -Recurse | ForEach-Object {
  $p = $_.FullName
  $t = Get-Content -Raw -Encoding utf8 $p

  # Normalize newlines to LF and strip stray CR
  $t = $t -replace "`r`n", "`n"
  $t = $t -replace "`r", ''

  # Replace curly quotes with ASCII quotes
  $t = $t -replace [char]0x2018, "'"  # ‘
  $t = $t -replace [char]0x2019, "'"  # ’
  $t = $t -replace [char]0x201C, '"'  # “
  $t = $t -replace [char]0x201D, '"'  # ”

  # Strip invisible/bad whitespace
  $t = $t -replace [char]0x00A0, ' '   # NBSP
  $t = $t -replace [char]0x200B, ''    # Zero-width space
  $t = $t -replace [char]0x000B, ''    # Vertical tab

  Set-Content -Path $p -Value $t -Encoding utf8 -NoNewline
}
Write-Host "Normalized workflow files."