import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/', 'verification/'] },
  js.configs.recommended,
  {
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.webextensions },
    },
  },
  {
    files: ['src/denoise-worklet.js'],
    languageOptions: {
      globals: {
        AudioWorkletProcessor: 'readonly',
        registerProcessor: 'readonly',
        sampleRate: 'readonly',
      },
    },
  },
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.mjs', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['tests/worker.test.mjs'],
    languageOptions: { globals: { chrome: 'readonly' } },
  },
  {
    files: ['scripts/browser-smoke.mjs'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.webextensions },
    },
  },
];
