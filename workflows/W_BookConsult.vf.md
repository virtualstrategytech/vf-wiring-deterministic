---

# voiceflow-kit/workflows/W_BookConsult.vf.md

```md
# Workflow: W_BookConsult

**Goal**  
Ensure identity is present, then open Cal.com with prefilled name/email/notes.

**Variables Used**

- Input: `FirstName` (or `first_name`), `CustomerEmail` (or `customer_email_lc`), `user_message`, `CAL_URL`
- Output: none

**Blocks (sequence)**

0. **Start**

1. **Condition** “Have name & email?”

- IF `FirstName == "" OR FirstName == null` OR `CustomerEmail == "" OR CustomerEmail == null`  
  → Call `C_CollectNameEmail`
- ELSE continue

2. **Speak**

   > “I’ll open the booking page with your details. You can pick any time that works.”

3. **Buttons**

- **Open URL**  
  URL template:
```

(Optional) add: `&hide_event_type_details=1&theme=dark`

4. **Speak**
   > “If you booked, would you like me to send a quick summary to **{CustomerEmail}**?”

**Choice**

- “Yes” → (optional: route to ticket/email webhook)
- “No” → End

**End**
