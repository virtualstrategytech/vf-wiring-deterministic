module.exports = {
  testEnvironment: 'node',
  globalSetup: '<rootDir>/tests/globalSetup.js',
  globalTeardown: '<rootDir>/tests/globalTeardown.js',
  testMatch: ['**/tests/**/*.test.js'],
  detectOpenHandles: true,
  testTimeout: 30000,
  // ignore folders that contain package.json files with colliding names
  modulePathIgnorePatterns: ['<rootDir>/webhook.legacy', '<rootDir>/novain-platform/webhook'],
};
