---

# voiceflow-kit/components/C_IrateGate.vf.md

```md
# Component: C_IrateGate

**Purpose**  
Detect heated/irate messages and route to a calm de-escalation response with clear options.

**Inputs**

- `user_message` (Text)

**Outputs**

- `is_irate` (Text "true"/"false" or Boolean if you prefer)
- `irate_reason` (Text; optional)

**Blocks (inside component)**

1. **Set**

- `user_message_lc = {user_message}.toLowerCase()`

2. **Condition** “Detect triggers” (match ANY)

- `user_message_lc CONTAINS "refund"`
- `user_message_lc CONTAINS "angry"`
- `user_message_lc CONTAINS "frustrated"`
- `user_message_lc CONTAINS "terrible"`
- REGEX match for ALL CAPS + `!{1,}` (optional heuristic)
  - Expression: `Boolean(/[A-Z]{5,}![!]*$/.test({user_message}))`

True → go to (3)  
False → go to (5)

3. **Set**

- `is_irate = "true"`
- `irate_reason = "triggered_words_or_caps"`

4. **Speak** (calm tone + options)
   > “I’m sorry you’ve had a frustrating experience. I can: (1) summarize what happened and fix it now, (2) log a priority ticket for a human, or (3) book a call. Which would you prefer?”

**Choice**

- “Fix it now” → return to caller (set a flag if needed)
- “Priority ticket” → route to `W_SubmitTicket` (or return a tag)
- “Book a call” → route to `W_BookConsult` (or return a tag)

**(Return)**

5. **Set**

- `is_irate = "false"`
- `irate_reason = ""`

**(Return)**
```
