# normalize tests\webhook.secret: remove BOM/CR, trim whitespace, write UTF-8 without BOM
$secretPath = Resolve-Path (Join-Path $PSScriptRoot '..\tests\webhook.secret')

if (-not (Test-Path $secretPath)) {
  Write-Error "Secret file not found: $secretPath"
  Exit 1
}

$content = Get-Content $secretPath -Raw

# remove BOM, CRs, trim whitespace/newlines
$content = $content.Trim([char]0xFEFF) -replace "`r",""
$content = $content.Trim()

# write back without BOM and no trailing newline
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($secretPath, $content, $utf8NoBom)

# output safe verification info
$prefix = $content.Substring(0,[math]::Min(6,$content.Length))
$len = $content.Length
$bytes = [System.Text.Encoding]::UTF8.GetBytes($content)
$sha = [System.BitConverter]::ToString((New-Object System.Security.Cryptography.SHA256Managed).ComputeHash($bytes)).Replace('-','').ToLower()
Write-Output "Normalized: prefix=$prefix len=$len sha256=$sha"