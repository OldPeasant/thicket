import { defineConfig } from 'vitest/config';

// `npm run test`: the unit tests of every workspace in one Vitest run.
// Each workspace has its own vitest.config.ts; `npm run coverage` runs per workspace.
// The projects list mirrors the `workspaces` list in package.json: keep them in sync.
export default defineConfig({
  test: {
    projects: [
      'apps/desktop/vitest.config.ts',
      'packages/contract/vitest.config.ts',
      'packages/core/vitest.config.ts',
      'packages/backend/vitest.config.ts',
      'packages/renderer/vitest.config.ts',
    ],
  },
});
