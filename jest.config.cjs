// jest.config.cjs
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",

  // keep your setup/teardown hooks
  globalSetup: "./tests/globalSetup.js",
  globalTeardown: "./tests/globalTeardown.js",

  // keep any test setup you already use (ok to delete if unused)
  setupFilesAfterEnv: [],

  // IMPORTANT: do not let Jest scan or resolve from legacy copy
  testPathIgnorePatterns: ["/node_modules/", "/webhook.legacy/"],
  modulePathIgnorePatterns: ["<rootDir>/webhook.legacy/"],

  // optional but harmless; we don’t need symlink tricks here
  haste: {
    enableSymlinks: false,
  },

  // keep the default transform for JS (no TS here)
  transform: {},
};
