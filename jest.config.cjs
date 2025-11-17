module.exports = {
  testEnvironment: "node",
  testTimeout: 15000,
  globalSetup: "./tests/globalSetup.js",
  globalTeardown: "./tests/globalTeardown.js",
  reporters: ["default"],
};
