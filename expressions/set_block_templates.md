// lower-case + trim
Set customer_email_lc = String(customer_email || "").toLowerCase().trim()

// count bumps
Set email_attempts = Number(email_attempts || 0) + 1

// reset quiz counts
Set API_MCQ = "0"
Set API_TF = "0"
Set API_OPEN= "0"
