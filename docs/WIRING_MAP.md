# Voiceflow Deterministic MVP — Wiring Map

## 0) Globals (init in W_Welcome)

- first_name (Text) = ""
- customer_email (Text) = ""
- is_valid_email (Bool) = false
- is_consumer_email (Bool) = false
- user_message (Text) = ""
- notes_q (Text) = ""
- topic_label (Text) = ""
- irate_mode (Bool) = false
- irate_count (Number) = 0
- API_Response (Text) = ""
- API_LessonTitle (Text) = ""
- API_BulletCount (Number) = 0
- APL_MCQ (Number) = 0
- APL_TF (Number) = 0
- APL_OPEN (Number) = 0
- Export_URL (Text) = ""
- tenantId (Text) = "default"

> Reset on new session: set counts to 0, titles to "", flags false.

---

## Components (IO + where they plug)

### C_CollectNameEmail

- Inputs: none (reads globals)
- Side effects: sets `first_name`, `customer_email`, `is_valid_email`, `is_consumer_email`
- Failure path: loops up to 3 tries; else → W_Fallback_Contact (or polite exit)
- Used in: W_Welcome (first run), W_BookConsult (guard if missing)

### C_CaptureQuestion

- Inputs: optional `prompt_text`
- Output: `user_message`
- Used in: W_Welcome → before routing; W_TeachQuiz when topic unclear

### C_OptimizeQuestion (optional)

- Inputs: `user_message`
- Outputs: `user_message` (refined), optional `topic_label`
- Used in: W_Welcome (right after capture)

### C_KB_Retrieve

- Inputs: `user_message`, `tenantId`
- Outputs: `API_Response`, `API_Hits` (if you expose it)
- Failure: message + Choice (Retry / Teach instead)
- Used in: W_QueryKB, fallback from W_TeachQuiz when KB could help

### C_GenerateLesson

- Inputs: `user_message`, `tenantId`
- Outputs: `API_Response`, `API_LessonTitle`, `API_BulletCount`
- Side effects: set `current_lesson_title = API_LessonTitle`
- Used in: W_TeachQuiz (first step), after KB miss

### C_GenerateQuiz

- Inputs: `user_message` or `API_LessonTitle` (preferred), `tenantId`
- Outputs: `APL_Quiz_JSON`, `APL_MCQ`, `APL_TF`, `APL_OPEN`
- Precondition: `quiz_lesson_title == current_lesson_title` (or set it)
- Used in: W_TeachQuiz after lesson, or on explicit “quiz me”

### C_BookConsult_Cal

- Inputs: `first_name`, `customer_email`, `user_message`
- Behavior: opens Cal URL with prefill; acknowledges after
- Used in: W_BookConsult, soft-CTA after KB/Lesson/Quiz

### C_IrateGate (optional)

- Inputs: last_utterance
- Outputs: `irate_mode`, `irate_count`
- Used in: W_Welcome / anywhere user text is captured

---

## Workflows (deterministic)

### W_Welcome (Start)

1. If `{first_name} is empty` → Call C_CollectNameEmail
2. Call C_CaptureQuestion (chips optional)
3. (Optional) C_OptimizeQuestion
4. Menu (Choice):
   - Teach & Quiz → Go W_TeachQuiz
   - Ask the KB → Go W_QueryKB
   - Book a Consult → Go W_BookConsult
   - Submit a Ticket → W_SubmitTicket

### W_TeachQuiz (callable)

1. Set: `APL_MCQ=0`, `APL_TF=0`, `APL_OPEN=0`, `quiz_lesson_title=""`
2. C_GenerateLesson → show `API_LessonTitle`
3. Choice “Generate Quiz now?”:
   - Yes → Set `quiz_lesson_title = current_lesson_title` → C_GenerateQuiz → speak counts
   - No → End (soft CTA → BookConsult)
4. Soft CTA: “Want to book time?” → W_BookConsult

### W_QueryKB (callable)

1. C_KB_Retrieve
2. If no good hits → ask “Want me to generate a short lesson?” → W_TeachQuiz
3. Else → speak `API_Response` → soft CTA → W_BookConsult

### W_BookConsult (callable)

1. If name/email missing → C_CollectNameEmail
2. C_BookConsult_Cal (prefilled)
3. End

### W_SubmitTicket (callable)

- Your existing ticket steps; end with a confirmation message.

---

## Guardrails

- Email: lowercase + regex validate; block major freemails for consult
- Quiz Stale: if `quiz_lesson_title != current_lesson_title` → re-confirm
- Irate: if `irate_mode==true` → route to De-escalation template then resume

---

## Test passes (per flow)

- W_Welcome → Teach → Quiz → Book (happy path)
- W_Welcome → KB hit → Book
- W_Welcome → KB miss → Teach fallback
- Failure: webhook down → friendly retry/skip
- Export: call webhook `export_lesson_file` after lesson → returns `Export_URL`

---

## Webhook endpoints used

- POST /webhook { action: "generate_lesson" | "generate_quiz" | "retrieve" }
- POST /webhook { action: "export_lesson" } → data: URL (optional)
- POST /export_lesson_file { title, lesson } → file response (md)
