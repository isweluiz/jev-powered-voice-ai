import js from '@eslint/js';
import globals from 'globals';
import htmlScripts from './scripts/html-scripts.mjs';

export default [
  { ignores: ['node_modules/**', 'coverage/**', 'dist/**', 'build/**', '.cache/**'] },
  {
    files: ['**/*.{js,mjs}', 'public/**/*.html'],
    ...js.configs.recommended,
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      ...js.configs.recommended.rules,
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  { files: ['**/*.mjs'], languageOptions: { globals: globals.node } },
  { files: ['public/**/*.{js,html}'], languageOptions: { globals: globals.browser } },
  { files: ['public/**/*.html'], processor: htmlScripts },
  { files: ['public/pcm-worklet.js'], languageOptions: { globals: { AudioWorkletProcessor: 'readonly', registerProcessor: 'readonly', sampleRate: 'readonly' } } },
];
