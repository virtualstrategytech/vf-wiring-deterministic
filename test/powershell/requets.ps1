# Health
Invoke-RestMethod -Uri https://vf-webhook-service.onrender.com/health

# Ping
$body = @{ action='ping'; question='hi'; name='Tester' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri https://vf-webhook-service.onrender.com/webhook `
  -Headers @{ 'x-api-key'='{WEBHOOK_KEY}' } -ContentType 'application/json' -Body $body

# Retrieve
$body = @{ action='retrieve'; question='What is SPQA?'; tenantId='default'; topK=6 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri https://vf-webhook-service.onrender.com/webhook `
  -Headers @{ 'x-api-key'='{WEBHOOK_KEY}' } -ContentType 'application/json' -Body $body

# Generate lesson
$body = @{ action='generate_lesson'; question='Teach me SPQA'; tenantId='default' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri https://vf-webhook-service.onrender.com/webhook `
  -Headers @{ 'x-api-key'='{WEBHOOK_KEY}' } -ContentType 'application/json' -Body $body

# Generate quiz
$body = @{ action='generate_quiz'; question='Quiz me on SPQA'; tenantId='default' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri https://vf-webhook-service.onrender.com/webhook `
  -Headers @{ 'x-api-key'='{WEBHOOK_KEY}' } -ContentType 'application/json' -Body $body

# Export lesson (data URL)
$body = @{
  action='export_lesson'; format='markdown'; tenantId='default'; title='SPQA Lesson';
  lesson=@{
    meta=@{question='Churn is upâ€”what should we do?'}
    objectives=@('Separate symptoms from root problems','Define precise success criteria','Prioritize decisions & risks')
    content='Use SPQA: Situation -> Problem -> Questions -> Actions...'
    keyTakeaways=@('Answer the right questions','Tie actions to metrics','Take a 48h step')
    references=@(@{label='VST Playbook: Discovery'; url='https://example.com'})
  }
} | ConvertTo-Json -Depth 10

Invoke-RestMethod -Method Post -Uri https://vf-webhook-service.onrender.com/webhook `
  -Headers @{ 'x-api-key'='{WEBHOOK_KEY}' } -ContentType 'application/json' -Body $body

# Export lesson file
$body2 = @{
  title='SPQA Lesson'
  lesson=@{
    meta=@{question='Churn is upâ€”what should we do?'}
    objectives=@('Separate symptoms from root problems','Define precise success criteria','Prioritize decisions & risks')
    content='Use SPQA: Situation -> Problem -> Questions -> Actions...'
    keyTakeaways=@('Answer the right questions','Tie actions to metrics','Take a 48h step')
    references=@(@{label='VST Playbook: Discovery'; url='https://example.com'})
  }
} | ConvertTo-Json -Depth 10

Invoke-WebRequest -Uri https://vf-webhook-service.onrender.com/export_lesson_file `
  -Method Post -ContentType 'application/json' -Body $body2 `
  -OutFile "$env:USERPROFILE\Desktop\lesson.md"

