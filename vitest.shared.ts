import { defineConfig } from 'vitest/config';

/**
 * Vitest config shared by all workspaces: `*.spec.ts` next to the code under `src/`,
 * V8 coverage into the workspace's own `coverage/` folder.
 */
export function workspaceConfig(name: string) {
  return defineConfig({
    test: {
      name,
      environment: 'node',
      include: ['src/**/*.spec.ts'],
      coverage: {
        provider: 'v8',
        reporter: ['text-summary', 'json-summary', 'lcov'],
        reportsDirectory: 'coverage',
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.spec.ts', 'src/**/*.d.ts'],
      },
    },
  });
}
