// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // TFP tooling (own Angular app, Python scripts) and build output are not part of Thicket.
    ignores: [
      'dashboard/**',
      'tasks/**',
      'reviews/**',
      '.claude/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/coverage/**',
      '**/.angular/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // packages/core runs in the renderer too: no Node or Electron APIs.
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'electron', 'electron/*'],
              message: 'packages/core must stay free of Node and Electron APIs',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
