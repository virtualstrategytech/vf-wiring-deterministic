# Workflow: Welcome (Start)

1. Speak: “Hi, I’m NovAIn. I can answer KB, teach & quiz, or book a consult.”
2. Component → C_CollectNameEmail (only if FirstName/CustomerEmail missing)
3. Component → C_CaptureQuestion
4. Component → C_OptimizeQuestion (optional but recommended)
5. Choice:
   - “Teach & Quiz” → Component → C_TeachAndQuiz_Orchestrator
   - “Ask the KB” → Workflow → Query_KB
   - “Book a Consult” → Workflow → Book_Consult
   - “Submit a Ticket” → Workflow → Submit_Ticket
