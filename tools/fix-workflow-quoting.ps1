# tools/fix-workflow-quoting.ps1
$files = Get-ChildItem ".github/workflows" -Recurse -Include *.yml,*.yaml

foreach ($f in $files) {
  $t = Get-Content $f.FullName -Raw

  # 1) echo VAR=$VAL >> $GITHUB_ENV  →  printf '%s\n' "VAR=$VAL" >> "$GITHUB_ENV"
  $t = $t -replace '(?m)^\s*echo\s+([A-Z0-9_]+)=(.+?)\s*>>\s*\$GITHUB_ENV\s*$',
                  "printf '%s`n' `"$1=$2`" >> `"$GITHUB_ENV`""

  # 2) Unquoted $GITHUB_ENV on redirection
  $t = $t -replace '>>\s*\$GITHUB_ENV', '>> "$GITHUB_ENV"'

  # 3) Curl/common: quote simple URL envs if unquoted in obvious places
  $t = $t -replace '(?<!")\$\{?URL\}?', '"${URL}"'
  $t = $t -replace '(?<!")\$\{?WEBHOOK_BASE\}?', '"${WEBHOOK_BASE}"'

  Set-Content -Path $f.FullName -Value $t -NoNewline
}

Write-Host "Quoting pass complete."