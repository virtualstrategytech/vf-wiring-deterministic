param(
  [switch]$Apply  # pass -Apply to perform changes; default = dry-run
)

# Ensure repo root (adjust check if your repo root differs)
if (-not (Test-Path .git)) {
  Write-Error "Run this script from the repository root (where .git exists)."
  exit 2
}

# Create cleanup branch
$branch = "chore/consolidate-duplicates"
git fetch origin
# Robust branch existence check (avoid relying on shell redirection)
$branchExists = $false
try {
  & git rev-parse --verify $branch > $null 2>&1
  $branchExists = $true
} catch {
  $branchExists = $false
}

if (-not $branchExists) {
  Write-Host "Creating branch $branch (local)"
  & git checkout -b $branch
} else {
  Write-Host "Switching to existing branch $branch"
  & git checkout $branch
}

if (-not (git rev-parse --verify $branch 2>$null)) {
  Write-Host "Creating branch $branch (local)"
  git checkout -b $branch
} else {
  Write-Host "Switching to existing branch $branch"
  git checkout $branch
}

# Find duplicate basenames tracked by git
Write-Host "`nFinding duplicate basenames tracked by git..."
$dups = git ls-files | ForEach-Object { Split-Path $_ -Leaf } |
        Group-Object | Where-Object { $_.Count -gt 1 } |
        Select-Object -ExpandProperty Name
if (-not $dups) {
  Write-Host "No duplicate basenames found in git index."
} else {
  Write-Host "Duplicate basenames:"
  $dups | ForEach-Object { Write-Host " - $_" }
}

# Show full paths for duplicates (for review)
if ($dups) {
  Write-Host "`nPaths for duplicate names (sample):"
  foreach ($name in $dups) {
    git ls-files | Where-Object { $_ -like "*$name" } | ForEach-Object { Write-Host "  $($_)" }
  }
}

# Detect common backup/legacy directories & editor-copy patterns
$patterns = @(
  "webhook.legacy",
  "prompts_backup_*",
  "prompts_fix_backup_*",
  "*_backup_*",
  "*_fix_backup_*",
  "*.bak",
  "* - Copy.*",
  "* (1).*",
  "* copy.*",
  "*~"
)

Write-Host "`nSearching for common backup/duplicate patterns..."
$found = @()
foreach ($p in $patterns) {
  $matches = Get-ChildItem -Recurse -Force -ErrorAction SilentlyContinue -Filter $p | Select-Object -ExpandProperty FullName -ErrorAction SilentlyContinue
  if ($matches) { $found += $matches }
}
$found = $found | Sort-Object -Unique

if (-not $found) {
  Write-Host "No files/folders matching common backup patterns found."
} else {
  Write-Host "Found candidates to archive:"
  $found | ForEach-Object { Write-Host " - $_" }
}

# Also find any files with duplicate basenames in the working tree (not just git index)
Write-Host "`nAlso listing duplicate basenames across working tree (non-git):"
$allFiles = Get-ChildItem -Recurse -File -Force | Select-Object -ExpandProperty FullName
$byName = $allFiles | ForEach-Object { [PSCustomObject]@{ Name = Split-Path $_ -Leaf; Path = $_ } } |
         Group-Object Name | Where-Object { $_.Count -gt 1 }
if ($byName) {
  foreach ($g in $byName) {
    Write-Host "`nDuplicate name: $($g.Name)"
    $g.Group.Path | ForEach-Object { Write-Host "  $($_)" }
  }
} else {
  Write-Host "No duplicate basenames in working tree found."
}

# Plan moves: archive into archived_duplicates/
$archiveDir = Join-Path (Get-Location) "archived_duplicates"
Write-Host "`nArchive directory: $archiveDir"

if ($Apply) {
  if (-not (Test-Path $archiveDir)) { New-Item -ItemType Directory -Path $archiveDir | Out-Null }
} else {
  Write-Host "(DRY RUN) Would create archive directory if needed."
}

# Prepare list of paths to move (only those we found earlier)
$toMove = $found + ($byName | ForEach-Object { $_.Group.Path }) | Sort-Object -Unique
# Filter out canonical locations you want to keep (use pattern matching)
$canonicalKeepPatterns = @("novain-platform\webhook\server.js","novain-platform\prompts\server.js")
$toMove = $toMove | Where-Object {
  $full = $_ -replace '/','\'
  $keep = $false
  foreach ($patt in $canonicalKeepPatterns) {
    if ($full -like "*$patt*") { $keep = $true; break }
  }
  -not $keep
}
# Confirm and perform moves & git operations if -Apply
if ($Apply -and $toMove) {
  foreach ($p in $toMove) {
    $dest = Join-Path $archiveDir ([IO.Path]::GetFileName($p))
    if ((Test-Path $dest)) {
      $basename = [IO.Path]::GetFileNameWithoutExtension($p)
      $ext = [IO.Path]::GetExtension($p)
      $dest = Join-Path $archiveDir ("$basename-$(Get-Date -Format yyyyMMddHHmmss)$ext")
    }
    Write-Host "Moving:`n  $p`n  -> $dest"

    # Determine if tracked (use try/catch)
    $isTracked = $false
    try {
      & git ls-files --error-unmatch -- "$p" > $null 2>&1
      $isTracked = $true
    } catch {
      $isTracked = $false
    }

    try {
      if ($isTracked) {
        $destDir = Split-Path $dest -Parent
        if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir | Out-Null }
        & git mv -- "$p" "$dest"
      } else {
        # non-tracked: move file/dir on disk
        $destDir = Split-Path $dest -Parent
        if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir | Out-Null }
        Move-Item -Path $p -Destination $dest -Force
        # ensure git isn't tracking old path (best effort)
        try { & git rm --cached -- "$p" > $null 2>&1 } catch {}
      }
    } catch {
      Write-Warning "Failed to move $p : $($_.Exception.Message)"
    }
  }
  # Stage & commit changes
  git add -A archived_duplicates
  git commit -m "chore: archive duplicate/backup copies into archived_duplicates"
  git push --set-upstream origin $branch
  Write-Host "Archive & commit complete. Pushed branch $branch"
} else {
  Write-Host "`nDRY RUN complete. To apply these changes run the script again with -Apply."
  Write-Host "Example: .\\scripts\\consolidate-duplicates.ps1 -Apply"
}

Write-Host "`nManual step: close any duplicate/unsaved editor buffers (tabs named like 'deployed-smoke.yml 2') and save the correct file to disk."