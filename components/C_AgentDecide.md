# C_AgentDecide (Agentic planner – optional for later)

AI block:

- Instruction: paste file `prompts/agent_decide_instructions.txt`
- User:
  "Context so far:
  first_name={FirstName}
  user_message={user_message}
  api_summary={API_Response}
  lesson_title={API_LessonTitle}
  quiz_counts=MCQ:{API_MCQ}, TF:{API_TF}, OPEN:{API_OPEN}"
- Output → Set → agent_decision

Code block (parse + whitelist):

```js
let d = {};
try {
  d = JSON.parse(variables.agent_decision || "{}");
} catch (e) {
  d = {};
}
const allow = new Set([
  "retrieve",
  "generate_lesson",
  "generate_quiz",
  "book_consult",
  "ask_clarify",
  "handoff",
]);
variables.agent_next_action = allow.has((d.next_action || "").trim())
  ? d.next_action.trim()
  : "ask_clarify";
variables.agent_question = (d.question || "One detail to proceed?").slice(
  0,
  240
);
variables.agent_reason = d.reason || "";
variables.agent_params = JSON.stringify(d.params || {});
```
