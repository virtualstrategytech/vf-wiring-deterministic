Create these **Global (Text)** variables in Voiceflow:

FirstName, CustomerEmail, user_message, tenantId("default"),
mode("manual"), WEBHOOK_URL, WEBHOOK_API_KEY, CAL_URL, agent_persona,
API_Response, API_LessonTitle, API_BulletCount, API_MCQ, API_TF, API_OPEN, API_Hits,
agent_reply, agent_decision, agent_next_action, agent_question, agent_reason, agent_params,
turn_count(0)

Notes:

- Treat numbers as Text; compare numerically via Conditions where needed.
- Set WEBHOOK_URL to your Render webhook: https://vf-webhook-service.onrender.com/webhook
- Set CAL_URL to your event: https://cal.com/<user-or-team>/<event>
- In **Project → Behaviour → Agent**, set “When to trigger” = **Never** (you already did this).
