# Variable Inventory (Deterministic MVP)

## Identity

- `FirstName` (Text)
- `CustomerEmail` (Text)
- `customer_email_lc` (Text; lowercase / trimmed)
- `tenantId` (Text; default: `default`)

## Conversation

- `user_message` (Text)
- `optimized_question` (Text)

## API outputs

- `API_Response` (Text)
- `API_Hits` (Text/Number)
- `API_LessonTitle` (Text)
- `API_BulletCount` (Text/Number)
- `API_Quiz_JSON` (Text; stringified quiz JSON)
- `API_Lesson_JSON` (Text; optional, stringified lesson JSON)

## Quiz runner

- `quiz_mcq_idx`, `quiz_tf_idx`, `quiz_open_idx` (Numbers)
- `quiz_score`, `quiz_total` (Numbers)
- `quiz_last_correct` (Text: "true"/"false")
- `quiz_answer` (Text)
- `quiz_feedback` (Text)
- `quiz_report_json` (Text; stringified array)

## Cal booking

- `CAL_URL` (Text; e.g., `https://cal.com/you/event`)
- `notes_qs` (Text; optional: pass `user_message`)
- `first_name_qs` (Text; optional override for Cal prefill)

## Webhook

- `WEBHOOK_URL` (Text)
- `WEBHOOK_API_KEY` (Text)

## Recommended defaults

- `tenantId = "default"`
- Counters = `0`
- Strings = `""`
