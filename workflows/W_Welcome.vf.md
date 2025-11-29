# Workflow: W_Welcome (Start)

**Goal**  
Collect identity once, capture the user’s topic/message, offer the 4 main paths.

**Variables Used (read/write)**

- first_name, customer_email, is_valid_email, is_consumer_email
- user_message, topic_label
- tenantId ("default")

**Blocks (sequence)**

0. **Start**

1. **Condition** “Have identity?”

- IF `first_name == "" OR first_name == null OR customer_email == "" OR customer_email == null`  
  → YES: Call Component `C_CollectNameEmail`  
  → NO: continue

2. **Condition** “Email sanity (optional re-check)”

- If you store `is_valid_email` → ensure true; else skip.

3. **Component** `C_IrateGate` (optional pre-screen)

- Input: `user_message` (if empty, it just returns false)
- If `is_irate == "true"` → follow returned choice to Ticket/Book; else continue.

4. **Ask** “Capture question/topic”

- Prompt: “Tell me about your day or ask a business question (1–2 sentences).”
- Chips (optional): “Business Analysis”, “Strategy Consulting”, “Digital Transformation”
- Save to `user_message`
- Optional: If a chip is chosen, set `topic_label` accordingly.

5. **Component** `C_OptimizeQuestion` (optional)

- Input: `user_message`
- Output: overwrite `user_message` with cleaned/optimized version.

6. **Speak** (short confirmation)

   > “Got it. What would you like to do next?”

7. **Choice** (main menu)

- “Teach & Quiz” → Go to `W_TeachQuiz`
- “Ask the Knowledgebase” → Go to `W_QueryKB`
- “Book a Consult” → Go to `W_BookConsult`
- “Submit a Ticket” → Go to `W_SubmitTicket`

**End**
