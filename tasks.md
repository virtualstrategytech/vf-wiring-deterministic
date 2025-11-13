# Wiring tasks — prioritized checklist

Goal: finish wiring 26 components so the core happy path (welcome → capture → clarify → retrieve → generate → deliver) works reliably.

Instructions: for each component, check the three required items, wire branches to exact component_result values, and add tests.

- [ ] C_CaptureQuestion
  - [ ] Inputs: reads { user_message, capture_attempts, tenantId }
  - [ ] Outputs: sets { component_result = "success" | "needs_clarify" | "failure" }, increments capture_attempts when empty
  - [ ] Branches: empty → retry, success → next component

- [ ] C_CollectNameEmail
  - [ ] Validate email, set { first_name, email, component_result }
  - [ ] Failure → set component_result = "failure" and route to apology
  - [ ] Success → route to C_EnsureIdentity

- [ ] C_EnsureIdentity
  - [ ] Check business email and presence of required fields
  - [ ] Set component_result = "success" or "failure"
  - [ ] On failure, route to capture/CollectNameEmail

- [ ] C_ClarifyQuestion
  - [ ] Decide if clarification needed; outputs { clarify_needed (bool), clarified_question, component_result }
  - [ ] If clarify_needed true → prompt user then re-run capture
  - [ ] Track attempts (cap at 2–3)

- [ ] C_DiscoveryNextQuestion
  - [ ] Decide next discovery question based on prior answers
  - [ ] Outputs next_question_text and component_result = "success"

- [ ] C_KB_Query
  - [ ] POST to retrieval service with { query, tenantId, topK, namespace }
  - [ ] Map empty results → component_result = "menu" or "no_results"

- [ ] C_KB_Retrieve
  - [ ] Accept retrieval id/context, return content snippet and count
  - [ ] Set component_result appropriately

- [ ] C_GenerateLesson / C_GenerateFullLessonContent
  - [ ] POST to prompt/generation service with prompt + context
  - [ ] Set component_result = "success" and provide lesson_text (or url)

- [ ] C_GenerateQuiz
  - [ ] Accept lesson_text, return quiz JSON (mcq list), set component_result

- [ ] C_TeachAndQuiz
  - [ ] Orchestrator: call generation + quiz components, set component_result = "success" or "failure"

- [ ] C_BookConsult_Cal
  - [ ] POST to business booking endpoint with { name, email, slot, timezone }
  - [ ] Return booking confirmation and component_result

- [ ] C_SubmitTicket
  - [ ] POST new ticket; set ticket_id and component_result

- [ ] C_OptimizeQuestion
  - [ ] Run short prompt to rephrase/optimize the user question; return optimized_question

- [ ] C_ResetQuizCounts
  - [ ] Reset quiz counters in variables, set component_result = "success"

- [ ] C_WrapUpLesson
  - [ ] Present lesson summary + next steps, set component_result

- [ ] C_AgentTurn
  - [ ] Handoff to human if irate or escalation detected

- [ ] C_API_ErrorHandler
  - [ ] Centralize error handling: set component_result = "failure", set debug_trace, user_text

- [ ] C_IrateGate / C_Deescalate
  - [ ] Detect irate language and route to de-escalation flows/agent

- [ ] C_GenerateLessonStructure
  - [ ] Return structured outline for lesson generation

- [ ] C_KB_Search
  - [ ] Lightweight KB search; map to KB_Retrieve if needed

- [ ] C_ClarifyLessonTopic
  - [ ] Confirm lesson topic with user; set component_result

- [ ] C_CollectNameEmail (duplicate — verify single canonical)
  - [ ] Confirm wiring and dedupe duplicates

- [ ] C_CaptureQuestion (ensure single canonical)
  - [ ] Final consistency: trim and normalise strings

- [ ] Utility components (AgentTurn, API_ErrorHandler, etc.)
  - [ ] Ensure they are reachable from any failure branch

Testing matrix (for each component after wiring)
- Happy path: component_result = "success"
- Clarify path: component_result = "needs_clarify" → user provides clarification → success
- Failure path: component_result = "failure" → shows user-friendly apology
- Unauthorized/503: simulate webhook or retrieval failures and ensure API_ErrorHandler runs

Notes:
- Use exact string matches for component_result in branch conditions.
- Add debug_trace updates around every POST for easy troubleshooting.