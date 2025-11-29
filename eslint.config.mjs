// eslint.config.mjs — flat config, single default export
// Avoid importing `eslint/config` to keep compatibility across ESLint minor versions.
import globals from "globals";
import { createRequire } from "module";

// Some plugins ship as CJS; use createRequire so they resolve reliably in ESM.
const require = createRequire(import.meta.url);

const tsPlugin = require("@typescript-eslint/eslint-plugin");
const tsParser = require("@typescript-eslint/parser");
const reactPlugin = require("eslint-plugin-react");
const reactHooksPlugin = require("eslint-plugin-react-hooks");
const jsxA11yPlugin = require("eslint-plugin-jsx-a11y");

export default [
  // Ignored paths (use flat-config "ignores", not .eslintignore)
  {
    ignores: [
      "jest.config.cjs",
      "webhook.legacy/**",
      "node_modules/**",
      "**/package-lock.json",
    ],
  },

  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      parser: tsParser, // works for JS too
      parserOptions: {
        ecmaVersion: 2021,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
      "jsx-a11y": jsxA11yPlugin,
    },
    settings: { react: { version: "detect" } },
    rules: {
      "react/react-in-jsx-scope": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-require-imports": "off",
      "no-useless-escape": "error",
    },
  },

  // Looser rules for tests
  {
    files: ["tests/**"],
    rules: { "@typescript-eslint/no-unused-vars": "off" },
  },

  // TS-only tweaks
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2021,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {},
  },

  // React-only tweaks
  {
    files: ["**/*.{jsx,tsx}"],
    rules: {},
  },
];
