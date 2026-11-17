// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import { builtinModules } from 'node:module';
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
      '**/release/**',
      '**/coverage/**',
      '**/.angular/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  {
    // Node runs these: the main process, the backend and the config files.
    // packages/core and packages/contract get no runtime globals beyond ES.
    files: [
      'apps/desktop/**/*.ts',
      'packages/backend/**/*.ts',
      '**/*.config.ts',
      '**/*.mjs',
      'vitest.shared.ts',
      'test/integration/**/*.ts',
      'test/e2e/**/*.ts',
    ],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['packages/renderer/**/*.ts'],
    ignores: ['packages/renderer/*.config.ts'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      // Angular components, directives and services may be empty classes: the decorator is the content.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
    },
  },
  {
    // SPEC.md §6: the renderer and core (the shell-syntax parser, the raw editor) never run text
    // as code; only the mongosh host in the backend does. The raw editor's whole import graph,
    // packages included, is checked by packages/renderer/src/app/raw-editor/no-eval.spec.ts.
    // Specs may run generated code on purpose (codegen's tests run the generated programs).
    files: ['packages/renderer/src/**/*.ts', 'packages/core/src/**/*.ts'],
    ignores: ['**/*.spec.ts'],
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    // The contract types both sides of every call: `any` would silently switch that off.
    // (Already an error in tseslint `strict`; pinned here so a preset change can't drop it.)
    files: ['packages/contract/**/*.ts', 'packages/core/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // packages/core runs in the renderer too: no Node or Electron APIs.
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          // Builtins go in `paths` (exact names, subpaths like 'fs/promises' are listed in
          // builtinModules): `patterns` uses gitignore matching, so 'util' would also flag './util'.
          paths: builtinModules.map((name) => ({
            name,
            message: 'packages/core must stay free of Node and Electron APIs',
          })),
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
