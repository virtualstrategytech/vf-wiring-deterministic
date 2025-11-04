const express = require('express');
const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.send('ok'));
app.post('/v1/lessons/generate', (req, res) => {
  const question = String(req.body?.question ?? '');
  const tenantId = String(req.body?.tenantId ?? 'default');
  const lesson = {
    title: 'Clarify Ambiguity with the SPQA Frame',
    objectives: [
      'Separate symptoms from root problems',
      'Define precise success criteria',
      'Prioritize decisions & risks',
    ],
    content: 'Use SPQA: Situation → Problem → Questions → Actions…',
    keyTakeaways: ['Answer the right questions', 'Tie actions to metrics', 'Take a 48h step'],
    references: [{ label: 'VST Playbook: Discovery', url: 'kb://vst/discovery/spqa' }],
    meta: { question, tenantId, sourcePassages: [] },
  };
  res.json({ ok: true, lesson });
});

const port = process.env.PORT || 3000;
const server = app.listen(port, () => console.log('business up'));

function gracefulShutdown(signal) {
  try {
    console.log(`Received ${signal}; shutting down components server`);
  } catch {}
  try {
    const client = require('../lib/http-client');
    if (client && typeof client.closeAllClients === 'function') client.closeAllClients();
  } catch (e) {}
  try {
    server.close(() => {
      try {
        process.exit(0);
      } catch {}
    });
  } catch (e) {}
  setTimeout(() => {
    try {
      process.exit(1);
    } catch {}
  }, 5000).unref();
}
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
