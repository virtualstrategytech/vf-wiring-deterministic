# Workflow: W_QuizRunner

**Purpose**  
Iterate through MCQ → T/F → Open questions from `API_Quiz_JSON`, score MCQ + T/F, collect free-text for Open, and show a summary.

**Requires (Global Text vars unless noted)**

- API_Quiz_JSON (Text; stringified JSON of the quiz from webhook)
- API_LessonTitle (Text)
- API_MCQ, API_TF, API_OPEN (Numbers, but VF “Text” is fine)
- quiz_mcq_idx, quiz_tf_idx, quiz_open_idx (Numbers; default 0)
- quiz_score (Number; default 0)
- quiz_total (Number; default 0)
- quiz_last_correct (Text ‘true’/’false’)
- quiz_answer (Text)
- quiz_feedback (Text)
- quiz_report_json (Text; accumulates a JSON array of answers)

---

## Blocks

0. **Start**

1. **Set** “Init counters (safe defaults)”

- `quiz_mcq_idx = Number(quiz_mcq_idx) || 0`
- `quiz_tf_idx = Number(quiz_tf_idx) || 0`
- `quiz_open_idx = Number(quiz_open_idx) || 0`
- `quiz_score = Number(quiz_score) || 0`
- `quiz_total = Number(quiz_total) || 0`
- `quiz_report_json = quiz_report_json || "[]"`

2. **Code** “Parse quiz counts (idempotent)”

```js
let q = {};
try {
  q = JSON.parse(variables.API_Quiz_JSON || "{}");
} catch (e) {
  q = {};
}
const mcq = Array.isArray(q.mcq) ? q.mcq : [];
const tf = Array.isArray(q.tf) ? q.tf : [];
const op = Array.isArray(q.open) ? q.open : [];
variables.API_MCQ = String(mcq.length);
variables.API_TF = String(tf.length);
variables.API_OPEN = String(op.length);
```
