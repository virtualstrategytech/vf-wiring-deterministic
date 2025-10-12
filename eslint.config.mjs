// ...existing code...
import { defineConfig } from 'eslint/config';
import globals from 'globals';

// plugin modules / parser
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y';

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
