<#
  verify-github-token.ps1
  Usage: run from repo root in a PowerShell terminal
    - To avoid leaving token in shell history, paste it when prompted, or set in environment for the single session only:
      $env:GHTOKEN = Read-Host -AsSecureString | ConvertFrom-SecureString
      # (simpler: just paste at prompt when asked below)
#>

param(
  [string]$owner = "virtualstrategytech",
  [string]$repo = "vf-wiring-deterministic",
  [string]$denyRepo = "some-other-repo-you-did-not-select", # set a repo you did NOT include
  [switch]$downloadArtifact # pass -downloadArtifact to attempt to download first artifact (safe)
)

$# Prompt for token (avoid hardcoding)
Write-Output "Enter your token (it will not be echoed):"
$token = Read-Host -AsSecureString
# convert to plaintext only in memory for this script run
$ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($token)
try {
  $tokenPlain = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
} finally {
  [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}

$base = "https://api.github.com"
$headers = @{
  Authorization = "Bearer $tokenPlain"
  Accept = "application/vnd.github+json"
  'User-Agent' = 'verify-github-token-script'
}

function Show-JsonPretty($obj) {
  $obj | ConvertTo-Json -Depth 5
}

# 1) Who am I?
Write-Output "`n==> 1) GET /user (whoami)"; Write-Output "--------------------------------"
$response = Invoke-RestMethod -Uri "$base/user" -Headers $headers -Method Get -ErrorAction SilentlyContinue
if ($null -ne $response) {
  Write-Output "Authenticated as: $($response.login) (id:$($response.id))"
} else {
  Write-Error "Failed to get user info. HTTP/permission error. Check token and SSO authorization."
  exit 2
}

# 2) Positive: access to allowed repo
Write-Output "`n==> 2) GET /repos/$owner/$repo (positive check)"; Write-Output "--------------------------------"
$respRepo = Invoke-RestMethod -Uri "$base/repos/$owner/$repo" -Headers $headers -Method Get -ErrorAction SilentlyContinue
if ($null -ne $respRepo) {
  Write-Output "OK: token can access $owner/$repo"
  Write-Output "Repo private?: $($respRepo.private) ; default_branch: $($respRepo.default_branch)"
} else {
  Write-Error "FAIL: token could not access $owner/$repo (expected to succeed). HTTP error / permission denied."
}

# 3) Negative: access to a repo you did NOT select (should be denied)
Write-Output -InputObject "`n==> 3) GET /repos/$owner/$denyRepo (negative check)"
Write-Output -InputObject "--------------------------------"
try {
  Invoke-RestMethod -Uri "$base/repos/$owner/$denyRepo" -Headers $headers -Method Get -ErrorAction Stop | Out-Null
  Write-Warning "WARNING: Token appears to access $owner/$denyRepo (unexpected). This suggests token is not restricted."
} catch {
  $err = $_.Exception.Response
  if ($null -ne $err) {
    $status = ($err).StatusCode.value__
    Write-Output -InputObject "Negative check HTTP status: $status (expected 404 or 403 if token is limited)."
  } else {
    Write-Output -InputObject "Negative check failed with error: $($_.Exception.Message)"
  }
}

# 4) List actions runs for allowed repo (small sample)
Write-Output "`n==> 4) List recent Actions runs for $owner/$repo (will show first 5)"; Write-Output "--------------------------------"
$runs = Invoke-RestMethod -Uri "$base/repos/$owner/$repo/actions/runs?per_page=5" -Headers $headers -Method Get -ErrorAction SilentlyContinue
if ($null -ne $runs -and $null -ne $runs.workflow_runs) {
  foreach ($run in $runs.workflow_runs) {
    Write-Output ("Run id: {0}  status:{1}  conclusion:{2}  created_at:{3}" -f $run.id,$run.status,$run.conclusion,$run.created_at)
  }
  $firstRunId = $runs.workflow_runs[0].id
} else {
  Write-Output "No runs visible or access denied for runs listing."
  $firstRunId = $null
}

# 5) If -downloadArtifact and a run exists, list artifacts and optionally download the first artifact
if ($downloadArtifact -and $firstRunId) {
  Write-Output "`n==> 5) Listing artifacts for run $firstRunId"
  $arts = Invoke-RestMethod -Uri "$base/repos/$owner/$repo/actions/runs/$firstRunId/artifacts" -Headers $headers -Method Get -ErrorAction SilentlyContinue
  if ($null -ne $arts -and $null -ne $arts.artifacts -and $arts.artifacts.Count -gt 0) {
    $art = $arts.artifacts[0]
    Write-Output "Found artifact: id=$($art.id) name=$($art.name) size_in_bytes=$($art.size_in_bytes)"
    $downloadUrl = "$base/repos/$owner/$repo/actions/artifacts/$($art.id)/zip"
    $outFile = Join-Path -Path $PWD -ChildPath ("artifact_{0}.zip" -f $art.id)
    Write-Output "Downloading artifact to $outFile (will overwrite if exists)"
    Invoke-RestMethod -Uri $downloadUrl -Headers $headers -Method Get -OutFile $outFile -ErrorAction Stop
    Write-Output "Downloaded artifact to $outFile"
  } else {
    Write-Output "No artifacts found for run $firstRunId (or access denied)."
  }
}

Write-Output "`nFinished checks. If the negative check returned 403/404, your token is limited correctly."