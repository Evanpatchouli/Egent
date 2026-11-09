import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/generated/**',
      '.pnpm-*/**',
      '.cache/**',
      '.tmp/**',
      'output/**',
      '.playwright-cli/**',
      'apps/desktop/build/**',
      'release/**',
      '.local-data/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: { globals: globals.node },
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}', 'apps/web/test/**/*.{js,ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  prettier,
  { files: ['apps/desktop/**/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
);
