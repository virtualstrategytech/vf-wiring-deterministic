# Example HTTP request bodies for POST blocks (replace block numbers with your actual block number IDs)

Guidance: replace `tenantId`, `WEBHOOK_API_KEY` and other placeholders with runtime values. Use PowerShell Invoke-RestMethod or curl to test locally.

## Webhook (Voiceflow → your webhook)

- Block 19 (POST to your webhook) — example body the Voiceflow POST should send to your server (/webhook)

```json
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
```

## Retrieval service (C_KB_Query / C_KB_Retrieve)

- Typical POST body for retrieval (replace block where you call RETRIEVAL_URL)

```json
{
  "query": "{optimized_question}",
  "tenantId": "{tenantId}",
  "topK": 5,
  "namespace": "{tenantNamespace}",
  "filters": {}
}
```

- Expected response (example)

```json
{
  "ok": true,
  "results": [
    { "id": "doc1", "score": 0.92, "snippet": "Important excerpt..." },
    { "id": "doc2", "score": 0.77, "snippet": "Other useful excerpt..." }
  ],
  "count": 2
}
```

## Prompt / Generation service (C_GenerateLesson / C_OptimizeQuestion)

- Example request (POST to PROMPT_URL)

```json
{
  "prompt": "Create a concise 3-point lesson from the following client input:\n\n{retrieved_snippets}\n\nConstraints:\n- Output JSON with title, summary, steps[3]\n- Tone: coaching, actionable\n- TenantId: {tenantId}",
  "context": {
    "question": "{optimized_question}",
    "tenantId": "{tenantId}"
  },
  "format": "json"
}
```

- Expected response

```json
{
  "ok": true,
  "title": "How to clarify product-market fit",
  "summary": "Short summary...",
  "steps": ["Step 1: ...", "Step 2: ...", "Step 3: ..."]
}
```

## Booking (C_BookConsult_Cal)

- Example request body

```json
{
  "name": "{first_name} {last_name}",
  "email": "{email}",
  "tenantId": "{tenantId}",
  "preferred_slots": ["2025-10-15T14:00:00Z"],
  "timezone": "{timezone}"
}
```

- Expected response

```json
{
  "ok": true,
  "booking_confirmation": {
    "id": "bk_12345",
    "slot": "2025-10-15T14:00:00Z"
  }
}
```

## Submit ticket (C_SubmitTicket)

- Example body

```json
{
  "subject": "Customer escalation: {first_name}",
  "body": "Issue details: {user_message}",
  "priority": "normal",
  "tenantId": "{tenantId}"
}
```

- Expected response

```json
{ "ok": true, "ticket_id": "TCK-9876" }
```

## Error handler (what your POST should include when failing)

- When a non-2xx is returned, set debug_trace and forward to API_ErrorHandler block:

```json
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
```

## Example PowerShell smoke test (call your webhook directly)

```powershell
$body = @{ action='ping'; question='hello'; name='Bob'; tenantId='default' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:3000/webhook -Headers @{ 'x-api-key' = 'test123' } -Body $body -ContentType 'application/json'
```

## Mapping flows → blocks (how to document your canvas)

- Where the canvas shows a POST block, annotate that block with:
  - Block number (e.g. "Block 19" visible in Voiceflow)
  - Endpoint called (webhook / retrieval / prompt / booking)
  - Body template (one of the examples above)
  - Expected success component_result value (e.g. "success")
  - Expected failure component_result value (e.g. "failure" or "menu")

Example entry you can paste into each POST block note:

```
Block: 19
Endpoint: https://<your-host>/webhook
Method: POST
Request body: (see Webhook example)
Success -> component_result = "success"
Failure -> component_result = "failure" (set debug_trace)
```

---

If you want I can:

- generate a file with one entry per component pre-filled with the sample body and a "Block: <PLACEHOLDER>" you can paste into Voiceflow,
- or produce PowerShell test scripts per POST block (individual smoke tests).

Which of those two next?
