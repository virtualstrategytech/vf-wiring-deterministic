// Minimal retrieval mock server
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.status(200).send("ok"));

app.post("/v1/retrieve", (req, res) => {
  const { query = "", topK = 5, tenantId = "default" } = req.body || {};
  // Return a very small mocked response so callers and Render builds succeed
  const hits = Array.from({ length: Math.min(Number(topK) || 0, 5) }).map(
    (_, i) => ({
      id: `mock-${i + 1}`,
      score: 1.0 - i * 0.1,
      text: `Mock passage for "${String(query).slice(0, 80)}" (${i + 1})`,
    })
  );

  return res.json({
    ok: true,
    tenantId,
    query,
    topK,
    hits,
    reply: `Found ${hits.length} passages.`,
  });
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 10000;
app.listen(PORT, () => {
   
  console.log(`vf-retrieval-service listening on ${PORT}`);
});
