# Voiceflow Gotchas (Read before wiring)

1. **Value vs Expression**

   - “Set” block: ensure functions (toLowerCase, trim, regex) are in **Expression** mode.
   - If you see outputs becoming `0` or `true/false` strings unexpectedly, you probably used Value mode.

2. **Regex in Conditions**

   - Prefer simple **Contains** checks or a single **Regex Match** per condition.
   - If you need multi-match logic, use multiple rules with “Match ANY” rather than huge regex.

3. **Stale Variables**

   - Reset counters (`APL_MCQ/Tf/Open=0`) before generating quiz.
   - Clear temp vars on workflow entry when you rely on them for branching.

4. **Global vs Local variables**

   - Use globals for identity + API outputs that you reference across workflows.
   - Keep transient strings local inside components if you never use them elsewhere.

5. **Agent (Global) vs Scripted**

   - For deterministic MVP, set Agent to **Scripted only**.
   - Do not leave global agent on — it will interject and break linear flows.

6. **Button URL templates**

   - Test interpolation by echoing the computed link in a temporary Speak block first.
   - Common pitfall: uppercase/lowercase variables or spaces not URL-encoded.

7. **API Failure Paths**

   - Always wire failure to a human message with **Retry** and **Skip** branches.
   - Log minimal details to a debug var if needed (e.g., `last_error`).

8. **Preview Variable Reset**

   - Use Debugger → Reset Variables before each test run.
   - Verify identity vars are actually set _before_ routing to tools.

9. **Components return**

   - Ensure each component has a clean return (no dangling transitions).
   - When a component can branch to another workflow (e.g., IrateGate to Ticket), document it.

10. **Order matters**

- Welcome → Identity → Capture → Optimize → Route.
- Teach&Quiz → Reset quiz counts → Lesson → Ask → (Quiz) → End.
