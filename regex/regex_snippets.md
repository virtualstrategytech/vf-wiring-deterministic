# Common Set expressions

customer*email_lc = String(temp_email || '').trim().toLowerCase()
email_domain = (customer_email_lc.split('@')[1] || '')
is_valid_email = Boolean(/^[a-z0-9.*%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(customer_email_lc))

# Trim generic string

clean_text = String(some_var || '').trim()
