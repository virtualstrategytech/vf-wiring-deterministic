# Test Plan (Deterministic MVP)

## 1) Identity & Email Gate

- Start → If `FirstName` missing, prompt and set.
- Enter `CustomerEmail`:
  - `john@company.com` → ACCEPT (happy path)
  - `john@gmail.com` → REJECT (freemail path, 3 tries max, then fail)
  - Confirm lowercasing/trim works.

## 2) Capture & Optimize

- Provide a 1–2 sentence business question.
- If Optimize on: confirm `optimized_question` differs (shorter, clearer).

## 3) Knowledgebase (Retrieve)

- Choose **Ask KB**.
- Success: see `API_Response` summary and hits.
- Low/no hits path: offer Teach & Quiz.

## 4) Teach (Generate Lesson)

- Choose **Teach & Quiz**.
- Verify `API_LessonTitle` sets, speak a short confirmation.
- Failure path: friendly retry/skip.

## 5) Quiz (Generate)

- Choose “Quiz now”.
- Confirm `API_Quiz_JSON` present.
- Run `W_QuizRunner`:
  - MCQ/TF score increments correctly.
  - Open answers stored in `quiz_report_json`.
  - Summary shows `quiz_score/quiz_total`.

## 6) Export (Optional)

- Choose Export Report in Summary.
- Open `export_url` and verify markdown content.

## 7) Cal Booking

- From menu (or soft CTA), open Cal URL with `name`, `email`, `notes` prefilled.

## 8) Failure Modes

- Simulate webhook `400/502` → graceful messaging.
- Unreachable service: ask to retry or continue without.

## 9) Regression

- Re-run full path without resetting session; ensure no stale quiz counts (reset on entry of Teach/Quiz).
