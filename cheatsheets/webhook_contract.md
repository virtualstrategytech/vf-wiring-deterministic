# Webhook Contract (MVP)

## Actions

- generate_lesson: { user_message, audience, tone, length, examples }
- generate_quiz: { lesson_title } → { APL_Quiz_JSON, APL_MCQ, APL_TF, APL_OPEN }
- export_lesson: { lesson_title } → { API_Response, API_LessonTitle, API_BulletCount }
- export_lesson_file: { lesson_title } → { Export_URL }

## Response (base)

{
"ok": true,
"message": "string",
"data": { ... } // see action
}

## Error

{ "ok": false, "message": "why", "code": "TOOL_TIMEOUT|RAG_MISS|RATE_LIMIT" }
