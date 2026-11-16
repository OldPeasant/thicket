import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';
import { generateTestCertificates } from './certs.ts';
import {
  FIXTURE_NAMES,
  FIXTURE_SPECS,
  startFixture,
  type FixtureInfo,
  type FixtureName,
} from './mongo.ts';

declare module 'vitest' {
  interface ProvidedContext {
    /** Connection details of every running MongoDB fixture. */
    mongo: Record<FixtureName, FixtureInfo>;
    /** Path of the test CA certificate (PEM) that signed the TLS fixtures' server certificates. */
    tlsCaFile: string;
  }
}

/**
 * Vitest global setup: runs once per `npm run test:int`, starts all fixtures in parallel and shares
 * them with every test file. Containers are stopped in the returned teardown (Ryuk may be off).
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  // SANs assume the container runtime host (started.getHost()) is local. A remote DOCKER_HOST
  // (tcp://<host>) would need that host added here, or the TLS fixtures fail the hostname check.
  const certs = generateTestCertificates(['localhost', '127.0.0.1', '::1']);
  const certDir = await mkdtemp(join(tmpdir(), 'thicket-int-'));
  const tlsCaFile = join(certDir, 'ca.pem');
  try {
    await writeFile(tlsCaFile, certs.caCert, { mode: 0o600 });
  } catch (err) {
    await rm(certDir, { recursive: true, force: true });
    throw err;
  }

  const results = await Promise.allSettled(
    FIXTURE_NAMES.map((name) => startFixture(FIXTURE_SPECS[name], certs)),
  );
  const started = results.flatMap((r, i) =>
    r.status === 'fulfilled' ? [{ name: FIXTURE_NAMES[i], fixture: r.value }] : [],
  );

  const teardown = async (): Promise<void> => {
    await Promise.all(
      started.map(async ({ name, fixture }) => {
        try {
          await fixture.container.stop();
        } catch (err) {
          // Ryuk may be off (Podman), so nothing else removes the container: make the leak visible.
          console.warn(
            `MongoDB fixture ${name} (container ${fixture.container.getId()}) failed to stop: ${String(err)}`,
          );
        }
      }),
    );
    await rm(certDir, { recursive: true, force: true });
  };

  const failures = results.flatMap((r, i) =>
    r.status === 'rejected' ? [`${FIXTURE_NAMES[i]}: ${String(r.reason)}`] : [],
  );
  if (failures.length > 0) {
    await teardown();
    throw new Error(`MongoDB fixtures failed to start:\n${failures.join('\n')}`);
  }

  const mongo = Object.fromEntries(
    started.map(({ name, fixture }) => [name, fixture.info]),
  ) as Record<FixtureName, FixtureInfo>;
  project.provide('mongo', mongo);
  project.provide('tlsCaFile', tlsCaFile);
  return teardown;
}
