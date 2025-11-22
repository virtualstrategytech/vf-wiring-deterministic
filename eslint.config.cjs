module.exports = {
  // flat config for ESLint v9+
  languageOptions: {
    globals: {
      console: 'readonly',
      process: 'readonly',
      module: 'readonly',
      require: 'readonly',
      __dirname: 'readonly',
      __filename: 'readonly',
    },
    parserOptions: { ecmaVersion: 2021, sourceType: 'module' },
  },
  rules: {},
};
