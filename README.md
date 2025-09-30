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

# vf-wiring-deterministic

Deterministic Voiceflow wiring kit for the **NovAIn Teach & Quiz MVP**.  
This repo organizes docs, prompts, and API smoke tests so you can wire a stable, testable MVP without the global agent interfering.

## What this includes

- **docs/**: wiring map, variables, and a step-by-step test plan
- **copilot-kit/**: Copilot prompts + snippets you can paste into VS Code to stay fast and consistent
- **scripts/curl/**: one-file HTTP smoke tests for your Render webhook
- **env/.example.env**: sample environment names you’ll mirror in Render

## Quick start

1. Clone this repo and open in VS Code.
2. Duplicate `env/.example.env` locally to `.env` **(do not commit)** and set your values.
3. Deploy/verify webhook (Render): run the requests in `scripts/curl/webhook-smoke.http`.
4. In Voiceflow, wire components in this order:
   - `C_CollectNameEmail` → `C_CaptureQuestion` → `C_OptimizeQuestion`
   - `C_KB_Retrieve` / `C_GenerateLesson` / `C_GenerateQuiz`
   - `C_TeachQuiz_Orchestrator` → `W_QuizRunner` (optional)
5. Follow `docs/test-plan.md` to validate each path.

## Conventions

- Global variables use **TitleCase** (e.g., `FirstName`, `CustomerEmail`).
- API outputs use `API_*` (e.g., `API_Response`, `API_LessonTitle`).
- Counters/flags use lowercase snake when local (e.g., `quiz_mcq_idx`).

## Where to put Voiceflow files

- Export flows/components into `voiceflow/exports/` (keep the folder in Git with `.gitkeep`).
- Drop reference screenshots into `voiceflow/screenshots/`.

## Troubleshooting

- **Agent keeps jumping in?** Project → Agent → Behavior → set to **Scripted** and route **Fallback** to **End in current flow**.
- **Email regex refuses business domains?** See `copilot-kit/templates/outcome-guards.snippet`.
- **Webhook returns 400/502?** Use `copilot-kit/templates/webhook-error-handler.snippet` and re-run `webhook-smoke.http`.

Licensed MIT. © Virtual Strategy Tech.
