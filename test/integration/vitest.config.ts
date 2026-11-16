import { defineConfig } from 'vitest/config';

// Ryuk (Testcontainers' reaper) does not start on rootless Podman. With DOCKER_HOST pointing at a
// Podman socket, default it off; the global setup's teardown stops the containers itself.
if (process.env['DOCKER_HOST']?.includes('podman')) {
  process.env['TESTCONTAINERS_RYUK_DISABLED'] ??= 'true';
}

// `npm run test:int`: integration tests against MongoDB containers (Testcontainers; Docker or
// Podman, see docs/ARCHITECTURE.md "Install"). Not part of `npm run check`.
export default defineConfig({
  test: {
    name: 'integration',
    root: import.meta.dirname,
    environment: 'node',
    include: ['**/*.int.spec.ts'],
    globalSetup: ['./fixtures/global-setup.ts'],
    // Image pulls on a fresh machine can take minutes; container start itself is seconds.
    hookTimeout: 300_000,
    testTimeout: 60_000,
  },
});
