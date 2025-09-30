# MVP Deterministic Wiring Map

## High-level flow

1. **Welcome (Start)**

   - Ensure identity once: `C_CollectNameEmail` (only if `FirstName` or `CustomerEmail` missing)
   - Capture business question: `C_CaptureQuestion`
   - Optional refine: `C_OptimizeQuestion` → `optimized_question`
   - Menu (deterministic):
     - **Teach & Quiz** → `C_GenerateLesson` → speak summary → ask “Generate quiz?” → `C_GenerateQuiz` → `W_QuizRunner`
     - **Ask KB** → `C_KB_Retrieve` → speak summary → offer Teach or Book
     - **Book Consult** → `C_BookConsult_Cal`
     - **Submit Ticket** → `C_SubmitTicket` (your existing)

2. **Teach & Quiz Orchestrator**

   - Input: `user_message` or `optimized_question`
   - `C_GenerateLesson` → confirm title
   - Choice: **Quiz now** → `C_GenerateQuiz` (capture `API_Quiz_JSON`) → `W_QuizRunner`

3. **W_QuizRunner (optional)**
   - Walks `mcq` → `tf` → `open` from `API_Quiz_JSON`
   - Scores MCQ/TF, stores a JSON `quiz_report_json`
   - Optional: export markdown via `/webhook export_lesson`

## Deterministic Guardrails

- Disable global agent takeover.
- Validate business email (block freemail) with explicit Condition paths.
- Always wire **Failure** paths on API steps.
- Reset quiz counters before first run:
  - `quiz_mcq_idx = 0`, `quiz_tf_idx = 0`, `quiz_open_idx = 0`, `quiz_score = 0`, `quiz_total = 0`.

## Minimal API surface

- `action: "retrieve"` → summary & hits
- `action: "generate_lesson"` → `lessonTitle`, `lesson` (JSON)
- `action: "generate_quiz"` → `lessonTitle`, `quiz` (JSON with mcq/tf/open)
- `action: "export_lesson"` → `url` (data: markdown) or a hosted file endpoint
