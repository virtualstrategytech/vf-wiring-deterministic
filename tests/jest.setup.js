// tests/jest.setup.js
// Global Jest setup loaded via setupFilesAfterEnv.
// Keep this file SAFE: no heavy work, no network calls at import time.

'use strict';

const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');

// ---------------------------------------------------------------------------
// 1) Console warn policy: fail CI on unexpected warnings, allow a few known ones
// ---------------------------------------------------------------------------
const _origConsoleWarn = console.warn.bind(console);
// Keep this list minimal—add only truly benign patterns.
const IGNORE_WARN =
  /(?:SKIP_SMOKE=true|DEBUG test-file loaded|Using lightweight JSON body parser)/i;

console.warn = (...args) => {
  const msg = util.format(...args);
  if (process.env.CI && !IGNORE_WARN.test(msg)) {
    throw new Error(`console.warn in CI: ${msg}`);
  }
  return _origConsoleWarn(...args);
};

// ---------------------------------------------------------------------------
// 2) Mild guardrails to reduce open-handle flakes in CI
// ---------------------------------------------------------------------------

// Relax EventEmitter listener cap in parallel test runs.
try {
  const events = require('events');
  if (events?.EventEmitter) events.EventEmitter.defaultMaxListeners = 50;
} catch {}

// Prefer child-process isolation for ephemeral servers on CI.
try {
  if (process.env.GITHUB_ACTIONS === 'true' || process.env.CI === 'true') {
    process.env.USE_CHILD_PROCESS_SERVER = '1';
  }
} catch {}

// If globalSetup created a prompt mock, propagate its URL so tests can use it.
try {
  const promptInfoPath = path.join(process.cwd(), 'tests', 'prompt-mock.json');
  if (!process.env.PROMPT_URL && fs.existsSync(promptInfoPath)) {
    const info = JSON.parse(fs.readFileSync(promptInfoPath, 'utf8')) || {};
    if (info?.url) process.env.PROMPT_URL = info.url;
  }
} catch {}

// Disable keepAlive on global agents so sockets don’t persist between tests.
try {
  if (http?.globalAgent) http.globalAgent.keepAlive = false;
  if (https?.globalAgent) https.globalAgent.keepAlive = false;
} catch {}

// ---------------------------------------------------------------------------
// 3) Best-effort cleanup after each test file finishes
// ---------------------------------------------------------------------------
afterAll(async () => {
  try {
    http?.globalAgent?.destroy?.();
  } catch {}
  try {
    https?.globalAgent?.destroy?.();
  } catch {}

  // Yield so handles can close.
  await new Promise((r) => process.nextTick(r));
  await new Promise((r) => {
    const t = setTimeout(r, 150);
    try {
      t.unref?.();
    } catch {}
  });

  // If Node fetch/undici is present, close the global dispatcher.
  try {
    const undici = require('undici');
    const gd = typeof undici.getGlobalDispatcher === 'function' && undici.getGlobalDispatcher();
    if (gd && typeof gd.close === 'function') await gd.close();
  } catch {}
});
origin/chore/ci-stabilize-and-clean
feat/wiring-agent
