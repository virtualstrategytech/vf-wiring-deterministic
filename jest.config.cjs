/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  testTimeout: Number(process.env.JEST_TIMEOUT || 10000),
  verbose: true,
  globalSetup: "<rootDir>/tests/globalSetup.js",
  globalTeardown: "<rootDir>/tests/globalTeardown.js",
  setupFilesAfterEnv: ["<rootDir>/tests/jest.setup.js"],
  collectCoverage: false,
};
