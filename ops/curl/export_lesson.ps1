<#
Saves a lesson markdown file using your Render webhook service.
- First option calls /webhook with action=export_lesson and receives a data: URL (good for quick checks).
- Second option calls /export_lesson_file and streams the file directly to disk (preferred).

USAGE:
  ./export_lesson.ps1 -BaseUrl https://vf-webhook-service.onrender.com -ApiKey %%WEBHOOK_API_KEY%% `
    -Title "SPQA Lesson" -OutFile "$env:USERPROFILE\Desktop\lesson.md"
#>

param(
  [string]$BaseUrl = "https://vf-webhook-service.onrender.com",
  [string]$ApiKey  = "%%WEBHOOK_API_KEY%%",
  [string]$Title   = "SPQA Lesson",
  [string]$OutFile = "$env:USERPROFILE\Desktop\lesson.md"
)

# Example lesson payload (adjust freely)
$lesson = @{
  meta         = @{ question = "Churn is up — what should we do?" }
  objectives   = @("Separate symptoms from root problems","Define precise success criteria","Prioritize decisions & risks")
  content      = "Use SPQA: Situation → Problem → Questions → Actions. Start by restating the situation, isolate the real problem, list your top 3 questions to reduce uncertainty, then pick 1–2 actions for the next 48 hours."
  keyTakeaways = @("Answer the right questions","Tie actions to metrics","Take a 48h step")
  references   = @(@{ label="VST Playbook: Discovery"; url="https://example.com/spqa" })
} | ConvertTo-Json -Depth 8

# ---------- Method B (direct file endpoint — preferred)
try {
  $body = @{
    title  = $Title
    lesson = ($lesson | ConvertFrom-Json) # ensure object (not stringified json) when server expects JSON
  } | ConvertTo-Json -Depth 10

  Invoke-WebRequest -Uri "$BaseUrl/export_lesson_file" `
    -Method Post `
    -ContentType 'application/json; charset=utf-8' `
    -Body $body `
    -OutFile $OutFile

  Write-Host "Saved:" $OutFile
  exit 0
}
catch {
  Write-Warning "Direct file endpoint failed. Falling back to data: URL method ..."
}

# ---------- Method A (data: URL via /webhook action=export_lesson)
try {
  $payload = @{
    action = 'export_lesson'
    format = 'markdown'
    title  = $Title
    lesson = ($lesson | ConvertFrom-Json)
  } | ConvertTo-Json -Depth 10

  $resp = Invoke-RestMethod -Uri "$BaseUrl/webhook" `
    -Method Post `
    -Headers @{ 'x-api-key' = $ApiKey } `
    -ContentType 'application/json; charset=utf-8' `
    -Body $payload

  if (-not $resp.ok) { throw "Webhook replied not ok: $($resp.reply)" }
  if (-not $resp.url -or -not ($resp.url -like 'data:text/markdown*')) { throw "No markdown data URL in response." }

  # Parse the data: URL and save it
  if ($resp.url -match '^data:text/markdown;base64,(?<b64>.+)$') {
    $bytes = [Convert]::FromBase64String($Matches['b64'])
    [IO.File]::WriteAllBytes($OutFile, $bytes)
    Write-Host "Saved (from data URL):" $OutFile
  } else {
    throw "Unexpected data URL format."
  }
}
catch {
  Write-Error $_.Exception.Message
  exit 1
}

