/* tests/jest.setup.js */
const origWarn = console.warn.bind(console);
const origLog = console.log.bind(console);

// Relax warnings only when CI_LOOSE_WARN=1 (the child-process job)
const LOOSE = process.env.CI_LOOSE_WARN === "1";

// If someone wants to force failures on warn locally
const FAIL_ON_WARN = process.env.CI_FAIL_ON_WARN === "1";

console.warn = (...args) => {
  if (LOOSE) {
    origLog(...args); // treat warn as info
    return;
  }
  if (FAIL_ON_WARN) {
    origWarn(...args);
    process.exitCode = 1; // let Jest exit cleanly but mark failure
    return;
  }
  origWarn(...args);
};

// Ensure deterministic timeout
jest.setTimeout(Number(process.env.JEST_TIMEOUT || 10000));
