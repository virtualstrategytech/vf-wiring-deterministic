# Workflow: Query the KB

API → C_KB_Retrieve
Speak: “{API_Response}”
Component → C_AgentTurn
Choice:

- “Turn this into a short lesson” → C_TeachAndQuiz_Orchestrator
- “Book a consult” → Book_Consult
- “Done” → End
