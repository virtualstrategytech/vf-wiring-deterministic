// webhook/server.js
// Minimal Voiceflow webhook with retrieve, generate_lesson, generate_quiz, exports.

const express = require("express");
const cors = require("cors");

const app = express();

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.WEBHOOK_API_KEY || "%%WEBHOOK_API_KEY%%";
const RETRIEVAL_URL = process.env.RETRIEVAL_URL || ""; // e.g. https://.../v1/retrieve
const BUSINESS_URL = process.env.BUSINESS_URL || ""; // e.g. https://... business service
const PROMPT_URL = process.env.PROMPT_URL || ""; // e.g. https://... prompt/quiz service

app.use(cors());
app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => (req.rawBody = buf),
  })
);

app.get("/health", (_req, res) => res.status(200).send("ok"));

function makeMarkdownFromLesson(title, lesson) {
  const head = `# ${title}\n\n`;
  const objectives = (lesson.objectives || []).map((o) => `- ${o}`).join("\n");
  const takeaways = (lesson.keyTakeaways || []).map((t) => `- ${t}`).join("\n");

  let refs = "";
  if (Array.isArray(lesson.references)) {
    refs = lesson.references
      .map((r) => `- [${r.label || r.url}](${r.url || "#"})`)
      .join("\n");
  }

  const content = lesson.content || "";
  const metaQ = lesson.meta?.question
    ? `> **User Question:** ${lesson.meta.question}\n\n`
    : "";

  return [
    head,
    metaQ,
    objectives ? "## Objectives\n" + objectives + "\n\n" : "",
    "## Lesson\n",
    content + "\n\n",
    takeaways ? "## Key Takeaways\n" + takeaways + "\n\n" : "",
    refs ? "## References\n" + refs + "\n" : "",
  ].join("");
}

app.post("/webhook", async (req, res) => {
  const key = req.get("x-api-key");
  if (key !== API_KEY)
    return res.status(401).json({ ok: false, reply: "unauthorized" });

  const actionRaw = (req.body && req.body.action) ?? "ping";
  const action = String(actionRaw).toLowerCase();

  const name = req.body?.name || req.body?.first_name || "Guest";
  const tenantId = req.body?.tenantId || "default";
  const topK = Number(req.body?.topK) || 6;

  const qRaw = (req.body && (req.body.question ?? req.body.message)) ?? "";
  const question = typeof qRaw === "string" ? qRaw : JSON.stringify(qRaw);

  try {
    if (action === "ping") {
      return res.status(200).json({
        ok: true,
        reply: `Hi ${name}, I received: "${question}".`,
        port: PORT,
      });
    }

    if (action === "retrieve") {
      if (!RETRIEVAL_URL)
        return res
          .status(400)
          .json({ ok: false, reply: "RETRIEVAL_URL not configured" });
      if (!question.trim())
        return res.status(400).json({ ok: false, reply: "Missing `question`" });

      const r = await fetch(RETRIEVAL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: question, topK, tenantId }),
      });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        console.error("retrieve error", r.status, text);
        return res.status(502).json({ ok: false, reply: "retrieval_failed" });
      }
      const data = await r.json().catch(() => ({}));
      const hitCount = Array.isArray(data?.hits) ? data.hits.length : 0;
      const reply = data?.reply || `Found ${hitCount} passages.`;
      return res.status(200).json({ ok: true, reply, hitCount, tenantId });
    }

    if (action === "generate_lesson") {
      if (!question.trim())
        return res.status(400).json({ ok: false, reply: "Missing `question`" });

      // If BUSINESS_URL exists, call it; else return a stub lesson for MVP.
      if (BUSINESS_URL) {
        const r = await fetch(`${BUSINESS_URL}/v1/lessons/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, tenantId }),
        });
        if (!r.ok) {
          const text = await r.text().catch(() => "");
          console.error("business generate error:", r.status, text);
          return res
            .status(502)
            .json({ ok: false, reply: "business_generate_failed" });
        }
        const data = await r.json().catch(() => ({}));
        const lesson = data.lesson || {};
        const bulletCount = Array.isArray(lesson.keyTakeaways)
          ? lesson.keyTakeaways.length
          : 0;
        return res.status(200).json({
          ok: true,
          reply: "Lesson ready.",
          lessonTitle: lesson.title || "",
          bulletCount,
          lesson,
        });
      } else {
        const lesson = {
          meta: { question },
          title: "Clarify Ambiguity with the SPQA Frame",
          objectives: [
            "Separate symptoms from root problems",
            "Define success criteria",
            "Identify next best action",
          ],
          content:
            "Use SPQA: Situation → Problem → Questions → Actions. Start by restating the situation in plain language, isolate one measurable problem, list the 3 top clarifying questions, and choose one 48-hour action.",
          keyTakeaways: [
            "Answer the right questions",
            "Tie actions to metrics",
            "Iterate quickly",
          ],
          references: [{ label: "SPQA Primer", url: "https://example.com" }],
        };
        return res.status(200).json({
          ok: true,
          reply: "Lesson ready.",
          lessonTitle: lesson.title,
          bulletCount: lesson.keyTakeaways.length,
          lesson,
        });
      }
    }

    if (action === "generate_quiz") {
      // If PROMPT_URL exists, call it; else return a stub quiz for MVP.
      if (PROMPT_URL) {
        const r = await fetch(`${PROMPT_URL}/v1/quiz/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, tenantId }),
        });
        if (!r.ok) {
          const text = await r.text().catch(() => "");
          console.error("prompt quiz error:", r.status, text);
          return res
            .status(502)
            .json({ ok: false, reply: "quiz_generate_failed" });
        }
        const data = await r.json().catch(() => ({}));
        return res
          .status(200)
          .json({ ok: true, reply: "Quiz ready.", ...data });
      } else {
        const quiz = {
          mcq: [
            {
              q: "In SPQA, which step defines clarity?",
              choices: ["Situation", "Problem", "Questions", "Actions"],
              answer: "C",
              explain: "Listing questions surfaces unknowns.",
            },
          ],
          tf: [
            {
              q: "SPQA starts with Situation.",
              answer: true,
              explain: "Correct.",
            },
          ],
          open: [
            {
              q: "Rewrite your business question using SPQA and propose one 48-hour action.",
            },
          ],
        };
        return res.status(200).json({
          ok: true,
          reply: "Quiz ready.",
          lessonTitle: "Clarify Ambiguity with the SPQA Frame",
          mcqCount: quiz.mcq.length,
          tfCount: quiz.tf.length,
          openCount: quiz.open.length,
          quiz,
        });
      }
    }

    if (action === "export_lesson") {
      const title = String(req.body?.title || "Lesson");
      const raw = req.body?.lesson || "{}";
      let lesson = {};
      try {
        lesson = typeof raw === "string" ? JSON.parse(raw) : raw;
      } catch {
        lesson = {};
      }
      const md = makeMarkdownFromLesson(title, lesson);
      const b64 = Buffer.from(md, "utf8").toString("base64");
      const url = `data:text/markdown;base64,${b64}`;
      return res.status(200).json({ ok: true, reply: "Export ready.", url });
    }

    return res
      .status(400)
      .json({ ok: false, reply: `Unknown action: ${action}` });
  } catch (err) {
    console.error("webhook error", err);
    return res.status(500).json({ ok: false, reply: "internal_error" });
  }
});

app.post("/export_lesson_file", async (req, res) => {
  try {
    const title = String(req.body?.title || "Lesson");
    const raw = req.body?.lesson || "{}";
    let lesson = {};
    try {
      lesson = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      lesson = {};
    }
    const md = makeMarkdownFromLesson(title, lesson);
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${title.replace(/[^\w\-]+/g, "_")}.md"`
    );
    return res.status(200).send(md);
  } catch (e) {
    console.error("export_lesson_file error", e);
    return res.status(500).json({ ok: false, reply: "export_failed" });
  }
});

app.listen(PORT, () => console.log(`Webhook listening on :${PORT}`));

