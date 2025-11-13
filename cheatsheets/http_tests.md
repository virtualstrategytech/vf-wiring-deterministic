# HTTP Test Cheats

## Local webhook

POST http://localhost:3000/webhook
Content-Type: application/json
x-vf-signature: {{HMAC_IF_USED}}

{
"action":"generate_lesson",
"user_message":"How to prioritize features?",
"first_name":"Alex",
"tenant":"default"
}

## Render

POST https://vf-webhook-service.onrender.com/webhook
Content-Type: application/json
{
"action":"generate_quiz",
"lesson_title":"Feature Prioritization 101",
"tenant":"default"
}

## curl quickies

curl -X POST https://vf-webhook-service.onrender.com/webhook \
 -H "Content-Type: application/json" \
 -d '{"action":"export_lesson_file","lesson_title":"Feature Prioritization 101"}'
