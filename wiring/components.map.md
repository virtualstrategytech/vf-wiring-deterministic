Build components in this order:

1. C_CollectNameEmail

- Ask name → FirstName
- Ask email → CustomerEmail
- Set (trim+lower): customer_email_lc = {CustomerEmail.trim().toLowerCase()}
- Condition: valid business email (your working regex)
  true → proceed; false → retry up to 3, then offer alt path
- Output: FirstName, CustomerEmail

2. C_CaptureQuestion

- Ask: “Tell me your business question (1–2 sentences).”
- Chips: Business Analysis • Strategy Consulting • Digital Transformation (optional)
- Save → user_message
- Output: user_message

3. C_OptimizeQuestion

- AI→Set → prompt from `prompts/optimize_question.prompt.md`
- Set optimized_question
- Output: optimized_question

4. C_KB_Retrieve

- API POST {WEBHOOK_URL}
- Body: { "action":"retrieve","question":"{user_message}","tenantId":"{tenantId}","topK":6 }
- Capture: reply→API_Response, hitCount→API_Hits
- Failure → friendly retry message
- Output: API_Response, API_Hits

5. C_GenerateLesson

- API POST {WEBHOOK_URL} with action:"generate_lesson"
- Capture: reply→API_Response, lessonTitle→API_LessonTitle, bulletCount→API_BulletCount
- Output same

6. C_GenerateQuiz

- API POST {WEBHOOK_URL} with action:"generate_quiz"
- Capture: reply→API_Response, lessonTitle→API_LessonTitle,
  mcqCount→API_MCQ, tfCount→API_TF, openCount→API_OPEN
- Output same

7. C_AgentTurn

- AI→Set using `prompts/agent_turn.prompt.md` → set agent_reply
- Speak: {agent_reply}
- Output: agent_reply

8. C_AgentDecide (for later, optional)

- AI→Set from `prompts/agent_decide.prompt.md` → agent_decision
- Code (parse JSON; whitelist; defaults)
- Outputs: agent_next_action, agent_question, agent_reason, agent_params

9. C_BookConsult_Cal

- Button → Open URL:
  {CAL_URL}?name={FirstName}&email={CustomerEmail}&notes={user_message}&utm_source=novain
- Speak confirm
