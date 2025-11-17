# Monitor and triage script for child-server CI failures
# Polls GitHub Actions for workflow runs with failures, downloads artifacts,
# and summarizes async handle types from async_handles and child_active_handles JSON dumps.

param(
    [string]$Repo = 'virtualstrategytech/vf-wiring-deterministic',
    [int]$WorkflowId = 202503268,
    [int]$PollIntervalSec = 60,
    [int]$MaxIterations = 60
)

$ProcessedFile = "$PSScriptRoot/processed.txt"
$LogFile = "$PSScriptRoot/monitor.log"
if (-not (Test-Path "$PSScriptRoot")) { New-Item -ItemType Directory -Path "$PSScriptRoot" -Force | Out-Null }
if (-not (Test-Path $ProcessedFile)) { '' | Out-File -FilePath $ProcessedFile -Encoding utf8 }

function Log {
    param([string]$s)
    $t = "$(Get-Date -Format o) " + $s
    $t | Tee-Object -FilePath $LogFile -Append
}

Log "Starting monitor-and-triage (WorkflowId=$WorkflowId)"

$iter = 0
while ($iter -lt $MaxIterations) {
    try {
        Log "Polling for failed runs (iteration $iter)"
        $resp = gh api "repos/$Repo/actions/runs?workflow_id=$WorkflowId&per_page=50" --silent | ConvertFrom-Json
        $runs = @()
        if ($resp -and $resp.workflow_runs) { $runs = $resp.workflow_runs }
        foreach ($r in $runs) {
            try {
                if ($r.conclusion -ne 'failure') { continue }
                $rid = $r.id
                $already = Get-Content $ProcessedFile -ErrorAction SilentlyContinue | Where-Object { $_ -eq "$rid" }
                if ($already) { continue }

                Log "Found failed run id=$rid head_branch=$($r.head_branch) url=$($r.html_url)"

                # create output dir
                $outDir = Join-Path -Path (Resolve-Path .).Path -ChildPath "artifacts/triage_$rid"
                if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

                Log "Downloading artifacts for run $rid into $outDir"
                gh run download $rid --dir $outDir --repo $Repo 2>&1 | Tee-Object -FilePath "$outDir/download.log"

                # summarize artifacts
                $files = Get-ChildItem -Path $outDir -Recurse -File -ErrorAction SilentlyContinue
                Log "Downloaded $(($files | Measure-Object).Count) files for run $rid"

                # Search for async handle maps and child active handles
                $handleFiles = $files | Where-Object { $_.Name -match 'async_handle' -or $_.Name -match 'child_active_handles' -or $_.Name -match 'async_handles_smoke' }
                if (-not $handleFiles) { Log "No handle dumps found for run $rid" }

                foreach ($hf in $handleFiles) {
                    try {
                        Log "Analyzing $($hf.FullName)"
                        $text = Get-Content -Raw -Path $hf.FullName -ErrorAction SilentlyContinue
                        if (-not $text) { Log "  (empty file)"; continue }
                        try {
                            $json = $text | ConvertFrom-Json -ErrorAction Stop
                        } catch {
                            Log "  Failed to parse JSON: $($_.Exception.Message)"
                            continue
                        }
                        # If top-level is array of handles
                        if ($json -is [System.Object[]]) {
                            $counts = @{}
                            foreach ($item in $json) {
                                $type = $item.type -as [string]
                                if (-not $type) { $type = ($item | ConvertTo-Json -Depth 1).Substring(0,30) }
                                if ($counts.ContainsKey($type)) { $counts[$type] += 1 } else { $counts[$type] = 1 }
                            }
                            $summary = $counts.GetEnumerator() | Sort-Object -Property Value -Descending
                            Log "  Handle type counts:"
                            foreach ($kv in $summary) { Log "    $($kv.Name): $($kv.Value)" }
                        } else {
                            # attempt to locate 'handles' property
                            if ($json.handles) {
                                $counts = @{}
                                foreach ($h in $json.handles) {
                                    $t = $h.type -as [string]
                                    if (-not $t) { $t = 'unknown' }
                                    if ($counts.ContainsKey($t)) { $counts[$t] += 1 } else { $counts[$t] = 1 }
                                }
                                Log "  Handle type counts:"
                                $counts.GetEnumerator() | Sort-Object -Property Value -Descending | ForEach-Object { Log "    $($_.Name): $($_.Value)" }
                            } else {
                                Log "  JSON did not match expected handle formats"
                            }
                        }
                    } catch {
                        Log "  Error analyzing file: $($_.Exception.Message)"
                    }
                }

                # Grep for common leak indicators in text artifacts (Pipe, WriteStream, Socket)
                $interesting = $files | Where-Object { $_.Extension -in '.txt','.log','.json' }
                foreach ($f in $interesting) {
                    try {
                        $lines = Select-String -Path $f.FullName -Pattern 'Pipe|WriteStream|Socket|TCPSERVERWRAP|TCPWRAP' -SimpleMatch -ErrorAction SilentlyContinue
                        if ($lines) {
                            Log "Matches in $($f.FullName):"
                            foreach ($ln in $lines | Select-Object -First 10) { Log "  $($ln.Line.Trim())" }
                        }
                    } catch {}
                }

                # mark processed
                "$rid" | Out-File -FilePath $ProcessedFile -Append -Encoding utf8

                Log "Completed triage for run $rid"
            } catch {
                Log "Error processing run $($r.id): $($_.Exception.Message)"
            }
        }
    } catch {
        Log "Polling error: $($_.Exception.Message)"
    }

    $iter++
    Start-Sleep -Seconds $PollIntervalSec
}

Log "Monitor exiting after $MaxIterations iterations"
