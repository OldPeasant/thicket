import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getContainerRuntimeClient } from 'testcontainers';

import { generateTestCertificates } from '../../integration/fixtures/certs.ts';
import {
  FIXTURE_SPECS,
  startFixture,
  type FixtureInfo,
  type FixtureName,
  type FixtureSpec,
} from '../../integration/fixtures/mongo.ts';

export type { FixtureInfo, FixtureName, FixtureSpec };

/** A MongoDB fixture of the integration harness, started for e2e tests. */
export interface E2EMongo extends FixtureInfo {
  /** PEM file of the test CA, for TLS fixtures (`tlsCAFile`). */
  tlsCaFile?: string;
  stop(): Promise<void>;
}

/** Why no container runtime is usable, or `undefined` when Docker/Podman answers. */
export async function containerRuntimeUnavailable(): Promise<string | undefined> {
  try {
    await getContainerRuntimeClient();
    return undefined;
  } catch (error) {
    return `no container runtime (Docker or Podman, see docs/ARCHITECTURE.md): ${String(error)}`;
  }
}

/**
 * Starts the integration fixture `name` (`fixtures/mongo.ts`). TLS fixtures get a fresh test CA
 * whose certificate is written to a temp file that `stop()` deletes.
 */
export async function startMongo(name: FixtureName): Promise<E2EMongo> {
  return startMongoSpec(FIXTURE_SPECS[name]);
}

/**
 * Starts a fixture from its spec, also one the integration global setup doesn't start (e.g. the
 * TLS replica set of the M1 demo suite, `{ version: '8', replicaSet: true, tls: true }`).
 */
export async function startMongoSpec(spec: FixtureSpec): Promise<E2EMongo> {
  // Rootless Podman can't run Ryuk; `stop()` removes the container instead.
  if (process.env['DOCKER_HOST']?.includes('podman'))
    process.env['TESTCONTAINERS_RYUK_DISABLED'] ??= 'true';

  let certDir: string | undefined;
  let tlsCaFile: string | undefined;
  let certs;
  if (spec.tls) {
    certs = generateTestCertificates(['localhost', '127.0.0.1', '::1']);
    certDir = await mkdtemp(join(tmpdir(), 'thicket-e2e-ca-'));
    tlsCaFile = join(certDir, 'ca.pem');
    await writeFile(tlsCaFile, certs.caCert, { mode: 0o600 });
  }
  const removeCerts = async () => {
    if (certDir) await rm(certDir, { recursive: true, force: true });
  };

  let started;
  try {
    started = await startFixture(spec, certs);
  } catch (error) {
    await removeCerts();
    throw error;
  }
  return {
    ...started.info,
    ...(tlsCaFile ? { tlsCaFile } : {}),
    stop: async () => {
      try {
        await started.container.stop();
      } finally {
        await removeCerts();
      }
    },
  };
}
