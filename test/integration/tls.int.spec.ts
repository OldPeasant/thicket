import { MongoClient } from 'mongodb';
import { afterEach, describe, expect, inject, it } from 'vitest';

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

  it('rejects a plain connection', async () => {
    const c = client(mongo[name].uri);
    await expect(c.db('admin').command({ ping: 1 })).rejects.toThrow();
  });

  it('accepts a TLS connection with the test CA', async () => {
    const c = client(mongo[name].uri, { tls: true, tlsCAFile });
    expect((await c.db('admin').command({ ping: 1 }))['ok']).toBe(1);
  });
});
