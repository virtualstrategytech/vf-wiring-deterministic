vf-wiring-deterministic

# Voiceflow Kit (Deterministic + Agentic)

Use these files to wire a deterministic MVP in Voiceflow, with a clean slot to drop in the agentic loop later.

## Order of wiring

1. Add globals from `variables.md`.
2. Create components in this order:
   - C_CollectNameEmail
   - C_CaptureQuestion
   - C_OptimizeQuestion
   - C_KB_Retrieve
   - C_GenerateLesson
   - C_GenerateQuiz
   - C_AgentTurn
   - C_AgentDecide (optional for later)
   - C_BookConsult_Cal
   - C_TeachAndQuiz_Orchestrator
3. Build workflows from `workflows/`:
   - Welcome → menus
   - Query_KB
   - Book_Consult
   - Submit_Ticket
4. Test with `test/http/*.http` (VS Code REST Client) or `test/powershell/requests.ps1`.

## Voiceflow block notes

- API blocks: URL `{WEBHOOK_URL}`, header `x-api-key: {WEBHOOK_API_KEY}`
- AI blocks (Agent style): paste prompt text then **Output → Set variable** (e.g., `agent_reply`)
- Speak blocks: speak variables like `{agent_reply}` or `{API_Response}`

## Render/Env

Copy `.env.sample` to `.env` and set real values on Render:

- `WEBHOOK_API_KEY`, `RETRIEVAL_URL`, `BUSINESS_URL`, `PROMPT_URL`, optional `CAL_URL`.

## Guardrails

- Always run C_CollectNameEmail once; reuse `FirstName` and `CustomerEmail` later (don’t re-prompt).
- Clear quiz counts at the entry of Teach & Quiz Orchestrator.

# Voiceflow Deterministic MVP Kit

Open these side-by-side with Voiceflow:

- `vf-wiring/globals.map.md` → create global vars first
- `vf-wiring/components.map.md` → build components in order
- `vf-wiring/workflows.map.md` → wire Welcome, Teach&Quiz, KB, Book, Ticket
- `prompts/*.md` → copy into AI→Set blocks
- `http-tests/*.http` or `scripts/*.ps1` → quick API checks

Tip: Tell Copilot: “Use voiceflow-kit to help me wire C_TeachAndQuiz now.”
