# Workflow: W_QueryKB

**Goal**  
Query the Knowledgebase first. If weak/no hits, offer to generate a short lesson.

**Variables Used**

- Input: `user_message`, `tenantId` ("default"), `WEBHOOK_URL`, `WEBHOOK_API_KEY`
- Output: `API_Response`, `API_Hits`, `API_LessonTitle`

**Blocks (sequence)**

0. **Start**

1. **Condition** “Need a question?”

- IF `user_message == "" OR user_message == null` → Ask:
  - Prompt: “What should I search in the knowledgebase (1–2 sentences)?”
  - Save to `user_message`
- ELSE skip to 2)

2. **API** “KB Retrieve”

- Method: `POST`
- URL: `{WEBHOOK_URL}`
- Headers:
  - `Content-Type: application/json`
  - `x-api-key: {WEBHOOK_API_KEY}`
- Body (Raw JSON):

```json
{
  "action": "retrieve",
  "question": "{user_message}",
  "tenantId": "{tenantId}",
  "topK": 6
}
```
