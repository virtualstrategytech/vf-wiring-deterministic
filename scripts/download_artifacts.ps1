<#
scripts/download_artifacts.ps1

Minimal, robust script to download a GitHub Actions artifact for a run.
Behavior:
- Prefer the GitHub CLI (`gh`) when available and authenticated.
- Otherwise use the REST API with a token supplied via the environment variable `GITHUB_TOKEN` or the `-Token` parameter.
- Exits with clear error messages on common failures (missing token, placeholder token, 401/403 responses).
#>

[CmdletBinding(DefaultParameterSetName='Default')]
<#
.SYNOPSIS
  Download a GitHub Actions artifact for a run. Prefers the GitHub CLI (gh) when available and falls back to REST+PAT.
.
.PARAMETER Owner
  Repository owner (user or org).
.
.PARAMETER Repo
  Repository name.
.
.PARAMETER RunId
  Actions run id containing the artifact.
.
.PARAMETER ArtifactName
  Name of the artifact to download.
.
.PARAMETER DestDir
  Destination directory to extract the artifact into. Default: ./downloads/<Artifact>-<RunId>
.
.PARAMETER Token
  Optional PAT to use for REST fallback. If not supplied the script reads $env:GITHUB_TOKEN.
.
.EXAMPLE
  .\download_artifacts.ps1 -Owner virtualstrategytech -Repo myrepo -RunId 12345 -ArtifactName build-artifacts -Verbose
#>
param(
  [Parameter(Mandatory=$true)] [ValidateNotNullOrEmpty()] [string]$Owner,
  [Parameter(Mandatory=$true)] [ValidateNotNullOrEmpty()] [string]$Repo,
  [Parameter(Mandatory=$true)] [ValidateNotNullOrEmpty()] [long]$RunId,
  [Parameter(Mandatory=$true)] [ValidateNotNullOrEmpty()] [string]$ArtifactName,
  [Parameter(Mandatory=$false)] [string]$DestDir = "./downloads/$ArtifactName-$RunId",
  [Parameter(Mandatory=$false)] [string]$Token
)

function Fail([string]$msg, [int]$code = 1) {
  Write-Error $msg
  exit $code
}
function Test-GhDownload([string]$Owner, [string]$Repo, [long]$RunId, [string]$ArtifactName, [string]$DestDir) {
  # return $true if gh successfully downloaded the artifact
  $gh = Get-Command gh -ErrorAction SilentlyContinue
  if ($null -eq $gh) { return $false }

  # Check whether gh is authenticated (non-zero exit = not authenticated)
  & $gh.Path auth status > $null 2>&1
  if ($LASTEXITCODE -ne 0) { return $false }

  try { New-Item -ItemType Directory -Path $DestDir -Force | Out-Null } catch { Fail "Failed to create destination directory '$DestDir' for gh download: $($_.Exception.Message)" }

  $repoFlag = "$Owner/$Repo"
  # avoid assigning to the automatic $args variable used by PowerShell
  $ghArgs = @('run','download',$RunId,'-n',$ArtifactName,'-D',$DestDir,'--repo',$repoFlag)
  $proc = Start-Process -FilePath $gh.Path -ArgumentList $ghArgs -NoNewWindow -PassThru -Wait -RedirectStandardOutput "$env:TEMP\gh_out.txt" -RedirectStandardError "$env:TEMP\gh_err.txt"
  # we capture gh stdout/stderr to temp files to avoid console noise; their contents are not used by default
  Remove-Item "$env:TEMP\gh_out.txt","$env:TEMP\gh_err.txt" -ErrorAction SilentlyContinue
  return ($proc.ExitCode -eq 0)
}

# If the caller passed -Token, use it; otherwise rely on GITHUB_TOKEN env var
if ($Token) { $env:GITHUB_TOKEN = $Token }

# Try gh first (interactive users)
try {
  if (Test-GhDownload -Owner $Owner -Repo $Repo -RunId $RunId -ArtifactName $ArtifactName -DestDir $DestDir) {
    Write-Output -InputObject "Artifact downloaded via gh CLI to: $DestDir"
    exit 0
  }
} catch {
  Write-Verbose -Message "gh path not available or failed; falling back to REST+PAT."
<#
scripts/download_artifacts.ps1

Minimal, robust script to download a GitHub Actions artifact for a run.
Behavior:
- Prefer the GitHub CLI (`gh`) when available and authenticated.
- Otherwise use the REST API with a token supplied via the environment variable `GITHUB_TOKEN` or the `-Token` parameter.
- Exits with clear error messages on common failures (missing token, placeholder token, 401/403 responses).
#>

[CmdletBinding(DefaultParameterSetName='Default')]
<#
.SYNOPSIS
  Download a GitHub Actions artifact for a run. Prefers the GitHub CLI (gh) when available and falls back to REST+PAT.
.
.PARAMETER Owner
  Repository owner (user or org).
.
.PARAMETER Repo
  Repository name.
.
.PARAMETER RunId
  Actions run id containing the artifact.
.
.PARAMETER ArtifactName
  Name of the artifact to download.
.
.PARAMETER DestDir
  Destination directory to extract the artifact into. Default: ./downloads/<Artifact>-<RunId>
.
.PARAMETER Token
  Optional PAT to use for REST fallback. If not supplied the script reads $env:GITHUB_TOKEN.
.
.EXAMPLE
  .\download_artifacts.ps1 -Owner virtualstrategytech -Repo myrepo -RunId 12345 -ArtifactName build-artifacts -Verbose
#>
param(
  [Parameter(Mandatory=$true)] [ValidateNotNullOrEmpty()] [string]$Owner,
  [Parameter(Mandatory=$true)] [ValidateNotNullOrEmpty()] [string]$Repo,
  [Parameter(Mandatory=$true)] [ValidateNotNullOrEmpty()] [long]$RunId,
  [Parameter(Mandatory=$true)] [ValidateNotNullOrEmpty()] [string]$ArtifactName,
  [Parameter(Mandatory=$false)] [string]$DestDir = "./downloads/$ArtifactName-$RunId",
  [Parameter(Mandatory=$false)] [string]$Token
)

function Fail([string]$msg, [int]$code = 1) {
  Write-Error $msg
  exit $code
}
function Test-GhDownload([string]$Owner, [string]$Repo, [long]$RunId, [string]$ArtifactName, [string]$DestDir) {
  # return $true if gh successfully downloaded the artifact
  $gh = Get-Command gh -ErrorAction SilentlyContinue
  if ($null -eq $gh) { return $false }

  # Check whether gh is authenticated (non-zero exit = not authenticated)
  & $gh.Path auth status > $null 2>&1
  if ($LASTEXITCODE -ne 0) { return $false }

  try { New-Item -ItemType Directory -Path $DestDir -Force | Out-Null } catch { Fail "Failed to create destination directory '$DestDir' for gh download: $($_.Exception.Message)" }

  $repoFlag = "$Owner/$Repo"
  # avoid assigning to the automatic $args variable used by PowerShell
  $ghArgs = @('run','download',$RunId,'-n',$ArtifactName,'-D',$DestDir,'--repo',$repoFlag)
  $proc = Start-Process -FilePath $gh.Path -ArgumentList $ghArgs -NoNewWindow -PassThru -Wait -RedirectStandardOutput "$env:TEMP\gh_out.txt" -RedirectStandardError "$env:TEMP\gh_err.txt"
  # we capture gh stdout/stderr to temp files to avoid console noise; their contents are not used by default
  Remove-Item "$env:TEMP\gh_out.txt","$env:TEMP\gh_err.txt" -ErrorAction SilentlyContinue
  return ($proc.ExitCode -eq 0)
}

# If the caller passed -Token, use it; otherwise rely on GITHUB_TOKEN env var
if ($Token) { $env:GITHUB_TOKEN = $Token }

# Try gh first (interactive users)
try {
  if (Test-GhDownload -Owner $Owner -Repo $Repo -RunId $RunId -ArtifactName $ArtifactName -DestDir $DestDir) {
    Write-Output -InputObject "Artifact downloaded via gh CLI to: $DestDir"
    exit 0
  }
} catch {
  Write-Verbose -Message "gh path not available or failed; falling back to REST+PAT."
}

# REST fallback requires a token
if ($null -eq $env:GITHUB_TOKEN -or [string]::IsNullOrEmpty($env:GITHUB_TOKEN)) { Fail "GITHUB_TOKEN not set. Set env:GITHUB_TOKEN or pass -Token to this script." }
if ($env:GITHUB_TOKEN -match '^<.+>$' -or $env:GITHUB_TOKEN.Length -lt 20) { Fail "GITHUB_TOKEN looks like a placeholder or is too short (length=$($env:GITHUB_TOKEN.Length))." }

$baseApi = "https://api.github.com/repos/$Owner/$Repo/actions/runs/$RunId/artifacts"
$headers = @{ Authorization = "Bearer $env:GITHUB_TOKEN"; Accept = 'application/vnd.github+json'; 'User-Agent' = 'download_artifacts_script' }

Write-Verbose "Querying artifacts for run $RunId..."
try {
  $artifactsResp = Invoke-RestMethod -Uri $baseApi -Headers $headers -Method Get -ErrorAction Stop
} catch {
  if ($_.Exception.Response) {
    $status = try { $_.Exception.Response.StatusCode } catch { $null }
    if ($status -eq 401 -or $status -eq 403) { Fail "GitHub API returned $status. Token invalid or missing permissions (Actions read)." }
  }
  Fail "Failed to query artifacts: $($_.Exception.Message)"
}

if ($null -eq $artifactsResp.artifacts -or -not $artifactsResp.artifacts) { Fail "No artifacts found for run $RunId" }

$artifact = $artifactsResp.artifacts | Where-Object { $_.name -eq $ArtifactName } | Select-Object -First 1
if ($null -eq $artifact) { $names = ($artifactsResp.artifacts | ForEach-Object { $_.name }) -join ', '; Fail "Artifact named '$ArtifactName' not found. Available: $names" }

$artifactId = $artifact.id
$downloadUrl = "https://api.github.com/repos/$Owner/$Repo/actions/artifacts/$artifactId/zip"

# Prepare dest dir
if (Test-Path -LiteralPath $DestDir) { Fail "Destination directory '$DestDir' already exists; choose a different -DestDir or remove the existing directory." }
New-Item -ItemType Directory -Path $DestDir -Force | Out-Null

$tempZip = Join-Path -Path $env:TEMP -ChildPath ("artifact_$ArtifactName_$RunId_{0}.zip" -f ([System.Guid]::NewGuid().ToString()))

Write-Verbose "Downloading artifact '$ArtifactName' (id=$artifactId) to temporary file..."
try {
  Invoke-WebRequest -Uri $downloadUrl -Headers $headers -Method Get -UseBasicParsing -ErrorAction Stop -OutFile $tempZip
} catch {
  if ($_.Exception.Response) { $status = try { $_.Exception.Response.StatusCode } catch { $null }; if ($status -eq 401 -or $status -eq 403) { Fail "Download failed with $status (unauthorized). Ensure token has Actions read permissions." } }
  Fail "Failed to download artifact: $($_.Exception.Message)"
}

Write-Verbose "Download complete. Extracting to '$DestDir'..."
try { Expand-Archive -Path $tempZip -DestinationPath $DestDir -Force } catch { Remove-Item -LiteralPath $tempZip -ErrorAction SilentlyContinue; Fail "Failed to extract artifact zip: $($_.Exception.Message)" }
Remove-Item -LiteralPath $tempZip -ErrorAction SilentlyContinue

Write-Output "Artifact extracted to: $DestDir"
Write-Output "Done."
