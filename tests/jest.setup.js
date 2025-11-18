/* tests/jest.setup.js */
/* eslint-disable no-console */

const original = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

// CI toggles
const LOOSE_WARN = process.env.CI_LOOSE_WARN === "1"; // relax warns (for noisy child-process job)
const FAIL_ON_WARN = process.env.CI_FAIL_ON_WARN === "1"; // opt-in locally to fail on warn

console.warn = (...args) => {
  if (LOOSE_WARN) {
    // In the child-process CI job, warnings are informational only
    original.log(...args);
    return;
  }
  if (FAIL_ON_WARN) {
    original.warn(...args);
    // mark run as failed but let Jest exit cleanly
    process.exitCode = 1;
    return;
  }
  original.warn(...args);
};

// Reasonable default for CI
jest.setTimeout(Number(process.env.JEST_TIMEOUT || 10000));
