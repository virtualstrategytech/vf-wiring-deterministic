# Voiceflow POST block notes (paste into each POST block's Note)

Block: <PLACEHOLDER>
Endpoint: {WEBHOOK_URL} or {RETRIEVAL_URL} or {PROMPT_URL} (replace per block)
Method: POST
Request body: (use the examples below / replace placeholders with runtime variables)
Success -> component_result = "success"
Failure -> component_result = "failure" (include debug_trace and forward to API_ErrorHandler)

---

## Webhook (Voiceflow → your webhook)
Block: <PLACEHOLDER>
Request body:
{
  "action": "invoke_component",
  "component": "C_CaptureQuestion",
  "question": "{user_message}",
  "tenantId": "{tenantId}",
  "last_clicked_button": "{last_clicked_button}",
  "capture_attempts": "{capture_attempts}",
  "session": {
    "variables": {
      "first_name": "{first_name}",
      "email": "{email}"
    }
  }
}

## Retrieval service (C_KB_Retrieve)
Block: <PLACEHOLDER>
Endpoint: {RETRIEVAL_URL}
Request body:
{
  "query": "{optimized_question}",
  "tenantId": "{tenantId}",
  "topK": 5,
  "namespace": "{tenantNamespace}",
  "filters": {}
}

## Prompt / Generation (C_GenerateLesson / C_OptimizeQuestion)
Block: <PLACEHOLDER>
Endpoint: {PROMPT_URL}
Request body:
{
  "prompt": "Create a concise 3-point lesson from the following client input:\n\n{retrieved_snippets}\n\nConstraints:\n- Output JSON with title, summary, steps[3]\n- Tone: coaching, actionable\n- TenantId: {tenantId}",
  "context": {
    "question": "{optimized_question}",
    "tenantId": "{tenantId}"
  },
  "format": "json"
}

## C_GenerateQuiz
Block: <PLACEHOLDER>
Endpoint: {PROMPT_URL}
Request body: (see example_requests.md -> prompt/generation)

## Booking (C_BookConsult_Cal)
Block: <PLACEHOLDER>
Request body:
{
  "name": "{first_name} {last_name}",
  "email": "{email}",
  "tenantId": "{tenantId}",
  "preferred_slots": ["2025-10-15T14:00:00Z"],
  "timezone": "{timezone}"
}

## Submit ticket (C_SubmitTicket)
Block: <PLACEHOLDER>
Request body:
{
  "subject": "Customer escalation: {first_name}",
  "body": "Issue details: {user_message}",
  "priority": "normal",
  "tenantId": "{tenantId}"
}

## Error handler (when POST returns non-2xx)
Block: <PLACEHOLDER>
Response your POST should return to trigger API_ErrorHandler:
{
  "ok": false,
  "reply": "unauthorized",
  "http_status": 401,
  "debug_trace": {
    "endpoint": "{url}",
    "status": 401,
    "response": "{raw_response}"
  }
}

---

Paste the appropriate block number in "Block: <PLACEHOLDER>" on your Voiceflow canvas, and set the POST URL/headers:
- URL: {WEBHOOK_URL} (or {RETRIEVAL_URL}/{PROMPT_URL} per block)
- Header: x-api-key: {WEBHOOK_API_KEY}

Reference: example_requests.md (same folder) for full examples.
