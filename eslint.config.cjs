module.exports = {
  // flat-format ESLint config with Node globals
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'script',
    globals: {
      require: 'readonly',
      module: 'readonly',
      process: 'readonly',
      console: 'readonly',
      Buffer: 'readonly',
      fetch: 'readonly',
      __dirname: 'readonly',
      __filename: 'readonly',
    },
  },
  rules: {
    // ignore unused function args/vars that begin with "_" (common pattern for intentionally unused)
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-undef': 'error',
    semi: ['error', 'always'],
  },
  ignores: ['node_modules/**'],
};
