module.exports = {
  testEnvironment: 'node',
  globalSetup: '<rootDir>/tests/globalSetup.js',
  globalTeardown: '<rootDir>/tests/globalTeardown.js',
  testMatch: ['**/tests/**/*.test.js'],
  // Ignore accidental or backup test folders that may be present in the workspace
  testPathIgnorePatterns: ['<rootDir>/untracked-backup/'],
  detectOpenHandles: true,
  testTimeout: 30000,
  // ignore folders that contain package.json files with colliding names
  modulePathIgnorePatterns: ['<rootDir>/webhook.legacy', '<rootDir>/novain-platform/webhook'],
  // Run early setup files before any modules are loaded. We add
  // `jest.instrumentation.js` first so socket/TLS instrumentation runs
  // before any modules that may open sockets during require-time.
  setupFiles: ['<rootDir>/tests/jest.instrumentation.js', '<rootDir>/tests/jest.netblock.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/jest.setup.js'],
};
