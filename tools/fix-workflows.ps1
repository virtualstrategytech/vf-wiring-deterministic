# tools/fix-workflows.ps1
$root = ".github/workflows"
Get-ChildItem $root -Filter *.yml -Recurse | ForEach-Object {
  $t = Get-Content $_.FullName -Raw
  # Quote top-level 'on:' keys
  $t = $t -replace '(^|\r?\n)on:', '$1"on":'
  # Normalize CRLF -> LF
  $t = $t -replace "`r`n", "`n"
  Set-Content -Encoding utf8 $_.FullName $t
}