Workflow: Welcome (Start)

- Condition: if !FirstName → Call C_CollectNameEmail
- Call C_CaptureQuestion → user_message
- (Optional) Call C_OptimizeQuestion → optimized_question
- Menu (Choice):
  1. “Teach & Quiz” → Call C_TeachAndQuiz_Orchestrator (see below)
  2. “Ask the Knowledgebase” → Call C_KB_Retrieve → Speak {API_Response}
     → Call C_AgentTurn → Choice “Turn this into a lesson?” → yes → C_TeachAndQuiz_Orchestrator
  3. “Book a Consult” → Call C_BookConsult_Cal → Call C_AgentTurn
  4. “Submit a Ticket” → your ticket component → Call C_AgentTurn

Component: C_TeachAndQuiz_Orchestrator

- Set API_MCQ, API_TF, API_OPEN = 0 (avoid stale counts)
- Call C_GenerateLesson → Speak title or bullets (or just run C_AgentTurn)
- Call C_AgentTurn
- Choice “Generate a quiz now?” → Yes → C_GenerateQuiz → C_AgentTurn
- End
