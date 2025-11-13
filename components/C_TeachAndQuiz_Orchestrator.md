# C_TeachAndQuiz_Orchestrator

Set (clear stale counts at entry):

- API_MCQ = "0"
- API_TF = "0"
- API_OPEN = "0"

API → C_GenerateLesson (use the .http body)
Speak (show): “Lesson: {API_LessonTitle} (Key points: {API_BulletCount})”
Component → C_AgentTurn

Choice:

- “Quiz me” → API → C_GenerateQuiz → Component → C_AgentTurn
- “Skip quiz” → Speak: “Noted. Anything else?” → End
