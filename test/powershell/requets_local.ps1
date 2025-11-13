try {
  # Health
  Invoke-RestMethod -Uri http://localhost:3000/health -ErrorAction Stop

  # Ping
  $body = @{ action='ping'; question='hi'; name='Tester' } | ConvertTo-Json
  Invoke-RestMethod -Method Post -Uri http://localhost:3000/webhook `
    -Headers @{ 'x-api-key'=(Get-Clipboard -Raw).Trim() } -ContentType 'application/json' -Body $body -ErrorAction Stop

  # Retrieve
  $body = @{ action='retrieve'; question='What is SPQA?'; tenantId='default'; topK=6 } | ConvertTo-Json
  Invoke-RestMethod -Method Post -Uri http://localhost:3000/webhook `
    -Headers @{ 'x-api-key'=(Get-Clipboard -Raw).Trim() } -ContentType 'application/json' -Body $body -ErrorAction Stop

  # Generate lesson
  $body = @{ action='generate_lesson'; question='Teach me SPQA'; tenantId='default' } | ConvertTo-Json
  Invoke-RestMethod -Method Post -Uri http://localhost:3000/webhook `
    -Headers @{ 'x-api-key'=(Get-Clipboard -Raw).Trim() } -ContentType 'application/json' -Body $body -ErrorAction Stop

  # Generate quiz
  $body = @{ action='generate_quiz'; question='Quiz me on SPQA'; tenantId='default' } | ConvertTo-Json
  Invoke-RestMethod -Method Post -Uri http://localhost:3000/webhook `
    -Headers @{ 'x-api-key'=(Get-Clipboard -Raw).Trim() } -ContentType 'application/json' -Body $body -ErrorAction Stop

  # Export lesson file
  $body2 = @{
    title='SPQA Lesson'
    lesson=@{
      meta=@{question='Churn is up—what should we do?'}
      objectives=@('Separate symptoms from root problems','Define precise success criteria','Prioritize decisions & risks')
      content='Use SPQA: Situation -> Problem -> Questions -> Actions...'
      keyTakeaways=@('Answer the right questions','Tie actions to metrics','Take a 48h step')
      references=@(@{label='VST Playbook: Discovery'; url='https://example.com'})
    }
  } | ConvertTo-Json -Depth 10

  Invoke-WebRequest -Uri http://localhost:3000/export_lesson_file `
    -Method Post -ContentType 'application/json' -Body $body2 `
    -OutFile "$env:USERPROFILE\Desktop\lesson.md" -ErrorAction Stop
} catch {
  Write-Error "Request failed: $($_.Exception.Message)"
  exit 1
}

