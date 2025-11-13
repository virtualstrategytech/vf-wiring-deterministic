# Component Stubs (paste these as you create components)

## C_CollectNameEmail

Goal: Ask FirstName, validate business email (no freemail).
Inputs: none
Outputs: FirstName, CustomerEmail, customer_email_lc
Notes:

- Lowercase/trim: `customer_email_lc = (CustomerEmail || "").toLowerCase().trim()`
- Freemail reject list: gmail|yahoo|outlook|aol|hotmail|icloud|proton|gmx|live|msn|me

## C_CaptureQuestion

Goal: Get a 1–2 sentence business question.
Outputs: user_message
Chips (optional): Business Analysis, Strategy Consulting, Digital Transformation

## C_OptimizeQuestion

Goal: Shorten/clarify `user_message` → `optimized_question`
Use AI/Set → output var `optimized_question`

## C_KB_Retrieve

Goal: POST {WEBHOOK_URL} with action=retrieve
Capture: API_Response, API_Hits
Failure: friendly retry/skip

## C_GenerateLesson

Goal: POST {WEBHOOK_URL} with action=generate_lesson
Capture: API_Response, API_LessonTitle, API_BulletCount, (optional) API_Lesson_JSON
Failure: friendly retry/skip

## C_GenerateQuiz

Goal: POST {WEBHOOK_URL} with action=generate_quiz
Capture: API_Response, API_LessonTitle, API_Quiz_JSON
Failure: friendly retry/skip

## C_BookConsult_Cal

Goal: Open `{CAL_URL}?name={FirstName}&email={CustomerEmail}&notes={user_message}`
Then Speak a short confirmation.
