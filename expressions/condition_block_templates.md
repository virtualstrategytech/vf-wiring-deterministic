// empty name/email
(!FirstName || FirstName.trim()==="")
(!CustomerEmail || CustomerEmail.trim()==="")

// valid business email (allow edu/gov + country TLDs; exclude common free-mail)
Boolean(
/^[a-z0-9._%+\-]+@([a-z0-9\-]+\.)+[a-z]{2,}$/i.test(customer_email_lc) &&
  !/(^|\.)((gmail|yahoo|hotmail|outlook|live|icloud|aol|proton|me|msn)\.com)$/i.test(customer_email_lc)
)

// attempts exceeded
Number(email_attempts||0) >= 3
