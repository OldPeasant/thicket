import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MongoClient } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { generateTestCertificates } from './fixtures/certs.ts';

const clients: MongoClient[] = [];
function client(uri: string, options: ConstructorParameters<typeof MongoClient>[1] = {}) {
  const c = new MongoClient(uri, { serverSelectionTimeoutMS: 2_000, ...options });
  clients.push(c);
  return c;
}
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

describe.each(['mongo8tls', 'mongo7tls'] as const)('TLS fixture %s', (name) => {
  const mongo = inject('mongo');
  const tlsCAFile = inject('tlsCaFile');
  it('rejects a TLS connection without the test CA', async () => {
    const c = client(mongo[name].uri, { tls: true });
    // Node's verification error for a chain ending in an unknown CA.
    await expect(c.db('admin').command({ ping: 1 })).rejects.toThrow(/certificate/i);
  });

  // Same CA name and the same hosts, but another key: only the per-run CA may be trusted.
  describe('with an unrelated CA', () => {
    let dir = '';
    let otherCaFile = '';
    beforeAll(async () => {
      dir = await mkdtemp(join(tmpdir(), 'thicket-int-otherca-'));
      otherCaFile = join(dir, 'ca.pem');
      await writeFile(otherCaFile, generateTestCertificates(['localhost']).caCert);
    });
    afterAll(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('rejects a TLS connection that trusts a different CA', async () => {
      const c = client(mongo[name].uri, { tls: true, tlsCAFile: otherCaFile });
      await expect(c.db('admin').command({ ping: 1 })).rejects.toThrow(/certificate|signature/i);
    });
  });

  it('rejects a plain connection', async () => {
    const c = client(mongo[name].uri);
    await expect(c.db('admin').command({ ping: 1 })).rejects.toThrow();
  });

  it('accepts a TLS connection with the test CA', async () => {
    const c = client(mongo[name].uri, { tls: true, tlsCAFile });
    expect((await c.db('admin').command({ ping: 1 }))['ok']).toBe(1);
  });
});
