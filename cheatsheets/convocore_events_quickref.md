# Convocore Events Quickref

Host → Convocore:

- vf:context:set { first_name, email, tenant }
- vf:quiz:submit { answers }
- vf:lesson:request { topic }

Convocore → Host:

- vf:lesson:ready { title, bullets }
- vf:quiz:ready { counts, json }
- vf:export:url { url }
- vf:error { message, code }
