Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$wfRoot = Join-Path $PSScriptRoot '..\.github\workflows' | Resolve-Path
$files  = Get-ChildItem -Path $wfRoot -Recurse -Include *.yml,*.yaml

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

foreach ($f in $files) {
    $raw = Get-Content -Raw -LiteralPath $f.FullName

    # Normalize newlines to LF and drop stray CR
    $norm = $raw -replace "`r`n", "`n"
    $norm = $norm -replace "`r", ""

    # Quote top-level `on:` keys (preserve indentation and trailing comments)
    $pattern = '^(?<indent>\s*)on:(?<tail>\s*(?:#.*)?)$'
    $norm = [Regex]::Replace($norm, $pattern, '${indent}"on":${tail}',
                             [System.Text.RegularExpressions.RegexOptions]::Multiline)

    if ($norm -ne $raw) {
        [IO.File]::WriteAllText($f.FullName, $norm, $utf8NoBom)
        Write-Host "Updated $($f.FullName)"
    }
}

Write-Host "Done."
