# KB Search Tuning

topK: 6
minScore: 0.55
tenantID: "default"

Tips:

- ↑ topK to 8 if recall is poor; ↓ to 4 if response gets noisy.
- Raise minScore to 0.6–0.65 to cut weak hits.
- If RAG_MISS → fall back to Teach & Quiz.
