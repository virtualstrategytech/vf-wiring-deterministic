# Copilot Usage Cheatsheet

_A practical guide for using GitHub Copilot (Claude Sonnet + GPT-4.1/GPT-5) in wiring the deterministic Voiceflow MVP._

---

## 🎯 Goal

Use **GPT** for architecture, wiring order, and testing, and **Claude** for rapid stub completion and inline edits — without losing determinism or context.

---

## 1. Role Split

### GPT (GPT-4.1 / GPT-5)

- **Architect**: Design overall wiring (0 → 10).
- **File Generator**: Produce stubs (`.md`, `.http`, `.ps1`, `.snippet`).
- **Consistency Keeper**: Cross-check `WIRING_MAP.md`, `component-stubs.md`.
- **Debug Mentor**: Run `curl/http/ps1` scripts, ensure env vars are correct.

### Claude Sonnet

- **Inline Editor**: Fill in component stubs quickly (`C_CollectNameEmail.md`).
- **Refactorer**: Restructure prompts, microcopy, and regexes.
- **Docs Writer**: Simplify cheatsheets, voiceflow_gotchas, etc.
- **Fast Filler**: Expand repetitive boilerplate faster than GPT.

---

## 2. Switching Rules

1. **Start with GPT**

   - Generate structure, stubs, or maps.
   - Commit them to repo.

2. **Switch to Claude**

   - Open the specific file in VS Code.
   - Copy the relevant section from `docs/WIRING_MAP.md`.
   - Prompt Claude:
     > "Expand this stub, stick to these inputs/outputs, don’t drift."

3. **Return to GPT**
   - After Claude fills it, ask GPT to validate determinism, run tests, or fix wiring order.

---

## 3. Grounding Files

Keep these always open in VS Code while pairing with Copilot:

- `docs/WIRING_MAP.md` → Master wiring order.
- `copilot-kit/component-stubs.md` → File skeletons.
- `docs/test-plan.md` → Verification steps.

When Claude drifts → paste the relevant WIRING_MAP section to anchor it.  
When GPT continues → ask it to diff against repo structure.

---

## 4. Daily Cycle

- **Morning (Design)** → GPT (plan, stubs, maps).
- **Midday (Build)** → Claude (fill files, prompts, UX text).
- **Afternoon (Test)** → GPT (run smoke tests, webhook checks).
- **Optional polish** → Claude (summarize learnings, clean copy).

---

## 5. Checkpoints

- Enable **Chat: Checkpoints** in VS Code (you already did ✅).
- Before swapping models → save a checkpoint.
- Roll back if Claude drifts or GPT rewrites too much.

---

## 6. Example Commands

- **GPT prompt:**

  > “Generate `C_AgentTurn.md` stub with input/output spec from WIRING_MAP.”

- **Claude prompt:**
  > “Here’s the stub + map context. Expand into a complete Voiceflow component with conditions. Keep variables consistent with vf.variables.json.”

---

## 7. Version Control

- Always work in a feature branch (`feat/wiring-agent`).
- Commit after each _pairing cycle_ (GPT → Claude → GPT).
- PR into `main` once a full wiring step (0→10) is verified.

---

## 8. Quick FAQ

- **Q: Should I ask Claude to wire full flows?**  
  ❌ No. Use Claude only file-by-file. GPT keeps the big picture.

- **Q: Which model writes test scripts best?**  
  ✅ GPT — for deterministic scripts like `webhook-smoke.http`.

- **Q: Can I run both in one file?**  
  ⚠️ Yes, but checkpoint first. Don’t let them overwrite each other’s logic.

---

> ✅ With this split, you’ll stay fast (Claude) but consistent (GPT).  
> This cheatsheet lives in version control — so your future self, or teammates, can follow the same rhythm.
