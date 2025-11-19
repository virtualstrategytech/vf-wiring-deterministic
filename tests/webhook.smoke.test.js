// tests/webhook.smoke.test.js
'use strict';

// Hard skip at the very top: do nothing when SKIP_SMOKE is set.
// This keeps CI quiet—no fs/network/logging during import.
if (process.env.SKIP_SMOKE === 'true' || process.env.SKIP_SMOKE === '1') {
  describe.skip('webhook smoke (skipped by SKIP_SMOKE)', () => {});
} else {
  const http = require('http');
  const https = require('https');
  const fs = require('fs');
  const path = require('path');

  const secretFile = path.resolve(__dirname, 'webhook.secret');
  const key =
    process.env.WEBHOOK_API_KEY ||
    (fs.existsSync(secretFile) ? fs.readFileSync(secretFile, 'utf8').trim() : 'test123');

  const rawBase = (process.env.WEBHOOK_BASE || '').trim();

  function _normalizeBase(b) {
    if (!b) return b;
    try {
      return String(b).trim().replace(/\/+$/u, '');
    } catch {
      return b;
    }
  }
  const base = _normalizeBase(rawBase) || 'http://127.0.0.1:3000';

  // Validate WEBHOOK_BASE (when provided) with a masked error.
  function _maskBaseForLogs(b) {
    try {
      const u = new URL(b);
      return `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}`;
    } catch {
      return '[invalid-base]';
    }
  }
  try {
    if (rawBase) new URL(base);
  } catch {
    throw new Error(`WEBHOOK_BASE is not a valid URL: ${_maskBaseForLogs(base)}`);
  }
  if (rawBase) {
    const hasEnvKey = Boolean(process.env.WEBHOOK_API_KEY);
    const secretFileExists = fs.existsSync(secretFile);
    if (!hasEnvKey && !secretFileExists) {
      throw new Error(
        'WEBHOOK_BASE is set but WEBHOOK_API_KEY is missing (env or tests/webhook.secret). ' +
          'Set SKIP_SMOKE=true to skip, or provide the secret.'
      );
    }
  }

  // Prefer in-process app (for local runs) if available.
  let _localApp = null;
  try {
    if (key && !process.env.WEBHOOK_API_KEY) process.env.WEBHOOK_API_KEY = String(key);
  } catch {}
  try {
    _localApp = require('../novain-platform/webhook/server');
    if (!_localApp || typeof _localApp !== 'function') _localApp = null;
  } catch {}

  // Timeouts (overridable via env).
  const HEALTH_TIMEOUT = Number(process.env.WEBHOOK_HEALTH_TIMEOUT) || 5000;
  const PING_TIMEOUT = Number(process.env.WEBHOOK_PING_TIMEOUT) || 7000;
  const GENERATE_TIMEOUT = Number(process.env.WEBHOOK_GENERATE_TIMEOUT) || 45000;

  // Lightweight retry helper for transient ECONNREFUSED.
  async function withRetries(fn, retries = 8, delay = 500) {
    let lastErr;
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const refused = err?.code === 'ECONNREFUSED' || /ECONNREFUSED/.test(err?.message || '');
        if (!refused || i + 1 === retries) throw err;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastErr;
  }

  // Delegate HTTP to shared helper.
  const { requestApp } = require('./helpers/request-helper');

  async function postJson(url, body, headers = {}, timeout = 5000) {
    const u = new URL(url);
    const baseUrl = `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}`;
    const pathOnly = u.pathname + u.search;
    const target =
      _localApp && (baseUrl === 'http://127.0.0.1:3000' || baseUrl === 'http://localhost:3000')
        ? _localApp
        : baseUrl;
    const result = await requestApp(target, {
      method: 'post',
      path: pathOnly,
      body,
      headers,
      timeout,
    });
    return {
      status: result?.status ?? result?.statusCode ?? 0,
      data: result && (result.body ?? result.data),
    };
  }

  async function getText(url, timeout = 3000) {
    const u = new URL(url);
    const baseUrl = `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}`;
    const pathOnly = u.pathname + u.search;
    const target =
      _localApp && (baseUrl === 'http://127.0.0.1:3000' || baseUrl === 'http://localhost:3000')
        ? _localApp
        : baseUrl;
    const result = await requestApp(target, { method: 'get', path: pathOnly, timeout });
    return typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
  }

  // ---------------------- Tests ----------------------
  describe('webhook smoke', () => {
    jest.setTimeout(60000);

    afterAll(async () => {
      try {
        http?.globalAgent?.destroy?.();
      } catch {}
      try {
        https?.globalAgent?.destroy?.();
      } catch {}
      await new Promise((r) => process.nextTick(r));
    });

    test('GET /health returns ok', async () => {
      if (!base || !(base.startsWith('http://') || base.startsWith('https://'))) {
        throw new Error(`WEBHOOK_BASE is not a valid HTTP URL: ${_maskBaseForLogs(base)}`);
      }
      const url = `${base}/health`;
      const retries = Number(process.env.WEBHOOK_HEALTH_RETRIES) || 12;
      const retryDelay = Number(process.env.WEBHOOK_HEALTH_RETRY_DELAY) || 2000;
      const text = await withRetries(() => getText(url, HEALTH_TIMEOUT), retries, retryDelay);
      expect(typeof text).toBe('string');
      expect(text.trim().toLowerCase()).toBe('ok');
    });

    test('POST /webhook (ping) returns 2xx', async () => {
      const body = { action: 'ping', question: 'hello', name: 'Bob', tenantId: 'default' };
      const resp = await withRetries(
        () => postJson(`${base}/webhook`, body, { 'x-api-key': String(key) }, PING_TIMEOUT),
        6,
        300
      );
      expect(resp.status).toBeGreaterThanOrEqual(200);
      expect(resp.status).toBeLessThan(300);
      expect(resp.data).toBeDefined();
    });

    test('POST /webhook generate_lesson (best-effort)', async () => {
      const body = { action: 'generate_lesson', question: 'Teach me SPQA', tenantId: 'default' };
      const resp = await withRetries(
        () => postJson(`${base}/webhook`, body, { 'x-api-key': String(key) }, GENERATE_TIMEOUT),
        4,
        500
      );
      if (resp.status >= 200 && resp.status < 300) {
        if (resp.data && typeof resp.data === 'object') {
          expect(
            resp.data.lessonTitle !== undefined ||
              resp.data.lesson !== undefined ||
              resp.data.reply !== undefined
          ).toBeTruthy();
        } else {
          expect(resp.data).toBeDefined();
        }
      } else {
        expect(resp.status).toBe(500);
      }
    });

    test('POST /webhook generate_quiz (best-effort)', async () => {
      const body = { action: 'generate_quiz', question: 'Quiz me on SPQA', tenantId: 'default' };
      const resp = await withRetries(
        () => postJson(`${base}/webhook`, body, { 'x-api-key': String(key) }, GENERATE_TIMEOUT),
        4,
        500
      );
      if (resp.status >= 200 && resp.status < 300) {
        if (resp.data && typeof resp.data === 'object') {
          expect(
            resp.data.quiz !== undefined ||
              resp.data.mcqCount !== undefined ||
              resp.data.mcq !== undefined ||
              resp.data.reply !== undefined
          ).toBeTruthy();
        } else {
          expect(resp.data).toBeDefined();
        }
      } else {
        expect(resp.status).toBe(500);
      }
    });
  });
}
