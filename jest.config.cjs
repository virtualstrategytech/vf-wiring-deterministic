// jest.config.cjs
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  setupFilesAfterEnv: ["<rootDir>/tests/jest.setup.js"],
  globalSetup: "<rootDir>/tests/globalSetup.js",
  globalTeardown: "<rootDir>/tests/globalTeardown.js",
  testTimeout: Number(process.env.JEST_TIMEOUT || 10000),
  // ignore legacy package to avoid haste-map name collision
  modulePathIgnorePatterns: ["<rootDir>/webhook.legacy/"],
  collectCoverage: false,
};
