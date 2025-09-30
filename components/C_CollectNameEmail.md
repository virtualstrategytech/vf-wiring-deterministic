# C_CollectNameEmail

1. Ask (name)

   - Prompt: “What’s your first name?”
   - Capture → FirstName

2. Ask (email)

   - Prompt: “What’s your business email?”
   - Capture → temp_email

3. Set (normalize)

   - customer_email_lc = String(temp_email || '').trim().toLowerCase()
   - email_domain = customer_email_lc.split('@')[1] || ''

4. Condition (reject free mail)

   - Rules: Match ANY
     - /@(gmail\.|yahoo\.|hotmail\.|outlook\.|aol\.|icloud\.|proton\.|live\.|msn\.)/i → path: Reject_Free
     - /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i → path: Looks_Valid
   - Else → Invalid_Format

5. Looks_Valid → Set

   - CustomerEmail = customer_email_lc
   - Speak: “Thanks {FirstName}. Got your business email.”
   - End (return)

6. Reject_Free → Speak

   - “Please use a company email (not Gmail/Outlook/etc.).”
   - Go back to Ask (email)

7. Invalid_Format → Speak
   - “That doesn’t look like a valid email. Try again?”
   - Go back to Ask (email)
