// ...existing code...
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import { createRequire } from 'module';

// Some ESLint plugins are published as CommonJS. When this file is loaded
// as an ES module (eslint.config.mjs) using static `import` Node might fail
// to resolve them. Use createRequire to load CommonJS plugins reliably.
const require = createRequire(import.meta.url);

// plugin modules / parser (load with require to avoid ERR_MODULE_NOT_FOUND)
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const reactPlugin = require('eslint-plugin-react');
const reactHooksPlugin = require('eslint-plugin-react-hooks');
const jsxA11yPlugin = require('eslint-plugin-jsx-a11y');

export default defineConfig([
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      // use the TypeScript parser (works for JS too)
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2021,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: { ...globals.browser, ...globals.node },
    },

    // register plugin modules explicitly (flat config requires this form)
    plugins: {
      '@typescript-eslint': tsPlugin,
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      'jsx-a11y': jsxA11yPlugin,
    },

    settings: {
      react: { version: 'detect' },
    },

    rules: {
      'react/react-in-jsx-scope': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-require-imports': 'off',
      'no-useless-escape': 'error',
    },
  },

  // TypeScript-specific config (applies to .ts/.tsx)
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2021,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      // add TypeScript-specific rule overrides here
    },
  },

  // React-specific config (applies to .jsx/.tsx)
  {
    files: ['**/*.{jsx,tsx}'],
    rules: {
      // add React-specific rule overrides here
    },
  },
]);
// ...existing code...
