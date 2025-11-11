const fs = require('fs');
const path = require('path');

// Central helper to resolve the WEBHOOK_API_KEY for tests.
// Resolution order:
// 1. process.env.WEBHOOK_API_KEY (if provided by CI or developer)
// 2. tests/webhook.secret file (local developer convenience)
// 3. fallback 'test123' for deterministic local runs
// The helper also writes the resolved key into process.env.WEBHOOK_API_KEY
// so modules required later will observe the same value.

function resolveApiKey({ fallback = 'test123' } = {}) {
  if (process.env.WEBHOOK_API_KEY && String(process.env.WEBHOOK_API_KEY).trim()) {
    return String(process.env.WEBHOOK_API_KEY);
  }

  try {
    const secretFile = path.resolve(__dirname, '..', 'webhook.secret');
    if (fs.existsSync(secretFile)) {
      const s = fs.readFileSync(secretFile, 'utf8').trim();
      if (s) {
        process.env.WEBHOOK_API_KEY = s;
        return s;
      }
    }
  } catch (e) {
    // best-effort: ignore file read errors and fall back
  }

  process.env.WEBHOOK_API_KEY = fallback;
  return fallback;
}

module.exports = { resolveApiKey };
