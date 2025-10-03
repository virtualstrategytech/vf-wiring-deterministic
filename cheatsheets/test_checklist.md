# Deterministic MVP — Test Checklist

## ✅ Render / Webhook

- [ ] `/health` → returns `ok`
- [ ] `POST /webhook` with `action=ping` → 200
- [ ] `retrieve` returns 200 (or known 400 if `RETRIEVAL_URL` unset)
- [ ] `generate_lesson` returns JSON with `lessonTitle`, `bulletCount`
- [ ] `generate_quiz` returns JSON with `mcqCount`, `tfCount`, `openCount`
- [ ] `export_lesson_file` downloads non-empty `.md`

---

## ✅ Voiceflow (Happy paths)

- [ ] Welcome → Collect name/email once (no double re-prompt)
- [ ] Welcome → Capture question → Teach & Quiz → Lesson → (Quiz yes/no)
- [ ] Welcome → Ask KB → KB hit → Speak summary → Offer lesson/booking
- [ ] Welcome → Book Consult → Opens Cal link with name/email/notes

---

## ✅ Voiceflow (Edge/Failure)

- [ ] Email guard rejects consumer emails; accepts business/edu/gov
- [ ] Quiz counts reset to `0` at TQ entry (avoid stale numbers)
- [ ] Webhook error triggers friendly “retry or skip” path
- [ ] IrateGate fires on hot words/ALLCAPS → routes to De-escalation

---

## ✅ Convocore

- [ ] Widget visible and can start a session
- [ ] Event pings (`pageview`, `CTA`) visible in console/network logs
