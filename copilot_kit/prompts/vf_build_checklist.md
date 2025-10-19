# Voiceflow Build Checklist (Deterministic MVP)

- [ ] Agent global fallback = Scripted → End in current flow
- [ ] Variables added with defaults (see docs/variable-inventory.md)
- [ ] Components created:
  - [ ] C_CollectNameEmail (with regex + 3 attempts)
  - [ ] C_CaptureQuestion
  - [ ] C_OptimizeQuestion
  - [ ] C_KB_Retrieve (Success + Failure)
  - [ ] C_GenerateLesson (Success + Failure)
  - [ ] C_GenerateQuiz (captures API_Quiz_JSON)
  - [ ] C_BookConsult_Cal
  - [ ] W_QuizRunner (orchestrates mcq/tf/open)
- [ ] Teach & Quiz Orchestrator wired
- [ ] All API steps have Failure branches
- [ ] Stale counters cleared on entry to Teach & Quiz
- [ ] Soft CTA to booking after results
- [ ] Quick Preview test passes (see docs/test-plan.md)
