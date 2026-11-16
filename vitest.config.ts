import { defineConfig } from 'vitest/config';

// `npm run test`: the unit tests of every workspace in one Vitest run.
// Each workspace has its own vitest.config.ts; `npm run coverage` runs per workspace.
export default defineConfig({
  test: {
    projects: ['apps/*', 'packages/*'],
  },
});
