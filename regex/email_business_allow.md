# Business email acceptance (simple & reliable)

1. Lowercase + trim:
   customer_email_lc = String(temp_email || '').trim().toLowerCase()

2. Condition (Match ANY):
   A) /@(gmail\.|yahoo\.|hotmail\.|outlook\.|aol\.|icloud\.|proton\.|live\.|msn\.)/i → free mail → reject
   B) /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i → looks valid → accept
   Else → invalid format

Notes:

- This accepts .com, .ca, .uk, .gov, .edu, etc.
- If you need stricter corporate-only policy, add more free providers in (A).
