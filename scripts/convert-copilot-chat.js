const fs = require("fs");
const p = process.argv[2];
if (!p) {
  console.error("Usage: node convert-copilot-chat.js <session.json>");
  process.exit(1);
}
const j = JSON.parse(fs.readFileSync(p, "utf8"));
const out = ["# Copilot Chat Transcript", ""];
(j.requests || []).forEach((req) => {
  let user = "";
  if (req.message?.parts)
    req.message.parts.forEach((pt) => {
      if (pt.text) user += pt.text;
    });
  if (user) {
    out.push("## User", "", user.trim(), "");
  }
  (req.response || []).forEach((r) => {
    if (r.value) {
      out.push("## Copilot", "", r.value.trim(), "");
    } else if (r.kind === "text" && r.content?.value) {
      out.push("## Copilot", "", r.content.value.trim(), "");
    }
  });
});
const md = p.replace(/\.json$/i, ".copilot.md");
fs.writeFileSync(md, out.join("\n\n"), "utf8");
console.log("Wrote", md);
