import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'tests/**',
      '**/*.test.tsx',
      '**/*.test.ts',
      'src/__smoke__/**',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      // Catch TDZ: const foo used before declaration (#2279 postmortem)
      // functions: false — avoids false positives for function hoisting (intentional)
      // classes: false — class hoisting is intentional
      'no-use-before-define': ['error', { variables: true, functions: false, classes: false }],
      // React hooks must be called at top level, not inside conditions/loops
      'react-hooks/rules-of-hooks': 'error',
      // Exhaustive deps — warn only, not error (don't block intern PRs over this)
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
