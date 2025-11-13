---

# voiceflow-kit/workflows/W_TeachQuiz.vf.md

````md
# Workflow: W_TeachQuiz

**Goal**  
Generate a concise lesson from the current question; optionally follow with a quiz.

**Variables Used**

- Input: `user_message`, `tenantId`, `WEBHOOK_URL`, `WEBHOOK_API_KEY`
- Output: `API_LessonTitle`, `API_Response`, `API_MCQ`, `API_TF`, `API_OPEN`

**Blocks (sequence)**

0. **Start**

1. **Set** “Reset quiz counts”

- `API_MCQ = 0`
- `API_TF = 0`
- `API_OPEN = 0`

2. **Condition** “Do we have a question?”

- IF `user_message == "" OR user_message == null` → Ask:
  - Prompt: “What topic should I teach in one short lesson?”
  - Save → `user_message`
- ELSE continue

3. **API** “Generate Lesson”

- Method: `POST`
- URL: `{WEBHOOK_URL}`
- Headers:
  - `Content-Type: application/json`
  - `x-api-key: {WEBHOOK_API_KEY}`
- Body:

```json
{
  "action": "generate_lesson",
  "question": "{user_message}",
  "tenantId": "{tenantId}"
}
```
````

---

## Small tweak to your existing `W_TeachQuiz`

When you call `generate_quiz`, capture the full quiz JSON so the runner can use it:

- In **W_TeachQuiz → Block 5 (Generate Quiz)** add captures:
  - `quiz` → `API_Quiz_JSON` ✅
  - (optional) `promptLesson` → `API_Lesson_JSON`

Then send users to the runner:

- After Speak in block 6, on **“Start”** → **Go to `W_QuizRunner`**.

---

## Notes

- All Code blocks above are plain JS supported by Voiceflow’s **Code** step.
- If your MCQs sometimes have more or fewer than 4 choices, you can still render dynamically by showing a **Card** or **Speak** that enumerates choices in the Code block (set a single `quiz_choices_text` like `"A) ...\nB) ..."`), and change the **Ask** to free text. The grading still uses the first letter.
- If you want to email quiz results later, you already have `quiz_report_json` — post it to your webhook (a `/log_quiz` action) or attach it to a ticket.

If you want, I can also give you a **minimal “Quiz Export Only”** component that takes `API_LessonTitle`, `quiz_score`, `quiz_total`, and `quiz_report_json` and just returns a `export_url` using your existing export action.
