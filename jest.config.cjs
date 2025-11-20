/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  testTimeout: 30000,
  detectOpenHandles: true,

  // Keep these so the child-process server tests wire up correctly
  globalSetup: "./tests/globalSetup.js",
  globalTeardown: "./tests/globalTeardown.js",

  // Usual hygiene
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
  transform: {},
  verbose: false,
  forceExit: false,
};
