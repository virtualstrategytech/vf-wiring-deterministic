# KB vs Webhook — When to use which?

## Voiceflow Knowledge Base (KB)

- Great for: fast, low-latency answers from uploaded documents and site content.
- Pros: No code, simple; updates instantly when you add content.
- Cons: Limited formatting control; not ideal for creating structured outputs (lessons/quizzes).

**Use KB when:**

- User asks common “what/why/how” about your business strategy topics.
- You want quick citations/snippets from your internal content.

## Webhook (Render)

- Great for: structured generation (lesson outline, quizzes), RAG with external stores, exporting Markdown.
- Pros: Deterministic tools; full control over prompts, parameters, exports.
- Cons: Requires service availability and error handling.

**Use Webhook when:**

- You need `generate_lesson`, `generate_quiz`, `export_lesson`.
- You want consistent structure, counts, and custom formatting.

## Hybrid Tip

- Try KB first for short answers. If `API_Hits == 0` or confidence low, offer a “Generate short lesson” fallback → webhook `generate_lesson`.
