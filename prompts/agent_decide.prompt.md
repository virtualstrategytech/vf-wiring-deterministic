{agent_persona}

DECISION TASK. Choose next_action ONLY from:

- retrieve
- generate_lesson
- generate_quiz
- book_consult
- ask_clarify
- handoff

Guidance

- retrieve for business questions or when more context helps.
- generate_lesson when they ask to learn a topic.
- generate_quiz after a lesson or on explicit request.
- book_consult if help/complexity is high.
- ask_clarify when a single missing detail blocks progress.
- handoff if human support is requested or tools can’t help.

Output STRICT JSON only:
{"next_action":"...", "question":"...", "reason":"...", "params":{}}
