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
  type StartedFixture,
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
  const certDir = await mkdtemp(join(tmpdir(), 'thicket-int-'));
  const certs = generateTestCertificates(['localhost', '127.0.0.1', '::1']);
  const tlsCaFile = join(certDir, 'ca.pem');
  await writeFile(tlsCaFile, certs.caCert, { mode: 0o600 });

  const results = await Promise.allSettled(
    FIXTURE_NAMES.map((name) => startFixture(FIXTURE_SPECS[name], certs)),
  );
  const started = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));

  const teardown = async (): Promise<void> => {
    await Promise.allSettled(started.map((f) => f.container.stop()));
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
    FIXTURE_NAMES.map((name, i) => [name, (started[i] as StartedFixture).info]),
  ) as Record<FixtureName, FixtureInfo>;
  project.provide('mongo', mongo);
  project.provide('tlsCaFile', tlsCaFile);
  return teardown;
}
