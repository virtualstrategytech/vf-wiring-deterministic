# Consolidate three folders into a monorepo layout (Windows PowerShell)
param(
  [string] $root = "."
)

Push-Location $root

# create target folders
New-Item -ItemType Directory -Path ".\novain-platform\webhook\config" -Force | Out-Null
New-Item -ItemType Directory -Path ".\novain-platform\prompts\config" -Force | Out-Null
New-Item -ItemType Directory -Path ".\novain-platform\components\config" -Force | Out-Null

# backup nested .git dirs (safe)
If (Test-Path ".\vf-webhook-service\.git") { Move-Item ".\vf-webhook-service\.git" ".\vf-webhook-service\.git.bak" -Force }
If (Test-Path ".\vf-agent-prompt-engineer\.git") { Move-Item ".\vf-agent-prompt-engineer\.git" ".\vf-agent-prompt-engineer\.git.bak" -Force }
If (Test-Path ".\vf-agent-business-logic\.git") { Move-Item ".\vf-agent-business-logic\.git" ".\vf-agent-business-logic\.git.bak" -Force }

# copy JSONs into config folders (adjust src paths if different)
Copy-Item ".\vf-webhook-service\*.json" -Destination ".\novain-platform\webhook\config\" -Force -ErrorAction SilentlyContinue
Copy-Item ".\vf-agent-prompt-engineer\*.json" -Destination ".\novain-platform\prompts\config\" -Force -ErrorAction SilentlyContinue
Copy-Item ".\vf-agent-business-logic\*.json" -Destination ".\novain-platform\components\config\" -Force -ErrorAction SilentlyContinue

# optionally remove big node_modules to keep repo light
Remove-Item -Recurse -Force ".\vf-webhook-service\node_modules" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force ".\vf-agent-prompt-engineer\node_modules" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force ".\vf-agent-business-logic\node_modules" -ErrorAction SilentlyContinue

# init root git if needed and commit
if (-not (Test-Path .git)) { git init }
git add . 
git commit -m "Consolidate into novain-platform monorepo (import configs)" || Write-Output "Nothing to commit"

Pop-Location
Write-Output "Done. Inspect novain-platform/* and push when ready."