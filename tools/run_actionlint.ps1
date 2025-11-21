$ErrorActionPreference = 'Stop'
$zip = "actionlint.zip"
$dir = ".\.actionlint"
$url = "https://github.com/rhysd/actionlint/releases/latest/download/actionlint_windows_amd64.zip"
Write-Output "Downloading actionlint from $url..."
Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -ErrorAction Stop
Write-Output "Extracting $zip to $dir..."
if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
Expand-Archive -Path $zip -DestinationPath $dir -Force
$exe = Join-Path $dir "actionlint.exe"
if (-Not (Test-Path $exe)) { throw "actionlint.exe not found after extraction" }
Write-Output "Running actionlint on .github/workflows..."
# Run actionlint and capture both stdout and stderr
& $exe -no-color .github/workflows\* 2>&1 | Tee-Object -Variable out
Write-Output "---- actionlint output start ----"
$out | ForEach-Object { Write-Output $_ }
Write-Output "---- actionlint output end ----"
if (Test-Path $zip) { Remove-Item $zip -Force }
