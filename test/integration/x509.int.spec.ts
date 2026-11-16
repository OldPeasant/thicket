import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ConnectionManager, RpcError, type ConnectionManagerDeps } from '@thicket/backend';
import type { Profile } from '@thicket/contract';

import { startX509Fixture, type X509Fixture } from './fixtures/x509.ts';

// MONGODB-X509 through the connection manager (task x509-proxy): a server with access control and
// requireTLS, a per-run CA, client certificates as PEM bundle, encrypted bundle and separate files.

let x509: X509Fixture;
beforeAll(async () => {
  x509 = await startX509Fixture();
});
afterAll(async () => {
  await x509?.stop();
});

const managers: ConnectionManager[] = [];
afterEach(async () => {
  await Promise.all(managers.splice(0).map((m) => m.closeAll()));
});

function setup(profiles: Profile[], secrets: Record<string, Record<string, string>> = {}) {
  const logs: string[] = [];
  const deps: ConnectionManagerDeps = {
    loadProfile: (id) => {
      const found = profiles.find((p) => p.id === id);
      return found
        ? Promise.resolve(found)
        : Promise.reject(new RpcError('NOT_FOUND', `No profile with id ${id}`));
    },
    loadSecrets: (id) => Promise.resolve(secrets[id] ?? null),
    log: (message) => logs.push(message),
  };
  const manager = new ConnectionManager(deps);
  managers.push(manager);
  return { manager, logs };
}

function x509Profile(
  id: string,
  certificateKeyFile: string,
  extra: { keyFile?: string; username?: string } = {},
): Profile {
  return {
    id,
    name: `X.509 ${id}`,
    connectionString: x509.uri,
    auth: {
      mechanism: 'MONGODB-X509',
      secretMode: 'none',
      ...(extra.username ? { username: extra.username } : {}),
    },
    tls: {
      enabled: true,
      caFile: x509.caFile,
      certificateKeyFile,
      ...(extra.keyFile ? { keyFile: extra.keyFile } : {}),
    },
    serverSelectionTimeoutMS: 5_000,
    readOnly: false,
    production: false,
  };
}

async function failure(promise: Promise<unknown>): Promise<RpcError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RpcError) return error;
    throw new Error(`expected an RpcError, got ${String(error)}`, { cause: error });
  }
  throw new Error('expected a failure');
}

/** The authenticated user of the open connection, from `connectionStatus`. */
async function authenticatedUser(manager: ConnectionManager, profileId: string) {
  const status = await manager.client(profileId).db('admin').command({ connectionStatus: 1 });
  return (status['authInfo'] as { authenticatedUsers: { user: string; db: string }[] })
    .authenticatedUsers;
}

describe('MONGODB-X509', () => {
  it('authenticates the user named by a generated client certificate (PEM bundle)', async () => {
    const p = x509Profile('bundle', x509.userBundle);
    const { manager } = setup([p]);
    await expect(manager.open(p.id, undefined)).resolves.toMatchObject({ state: 'connected' });
    expect(await authenticatedUser(manager, p.id)).toEqual([
      { user: x509.userSubject, db: '$external' },
    ]);
    // The user may read (readAnyDatabase).
    const dbs = await manager.client(p.id).db('admin').command({ listDatabases: 1 });
    expect(dbs['ok']).toBe(1);
  });

  it('authenticates with an explicit user name (the certificate subject)', async () => {
    const p = x509Profile('named', x509.userBundle, { username: x509.userSubject });
    const { manager } = setup([p]);
    await manager.open(p.id, undefined);
    expect(await authenticatedUser(manager, p.id)).toEqual([
      { user: x509.userSubject, db: '$external' },
    ]);
  });

  it('decrypts an encrypted PEM bundle with the stored passphrase, never logging it', async () => {
    const p = x509Profile('encrypted', x509.encryptedBundle);
    const { manager, logs } = setup([p], { [p.id]: { tlsKeyPassphrase: x509.passphrase } });
    const result = await manager.test({ profileId: p.id }, undefined);
    expect(result.server.topology).toBe('standalone');
    expect(logs.join('\n')).not.toContain(x509.passphrase);
  });

  it('reads separate certificate and encrypted key files', async () => {
    const p = x509Profile('separate', x509.userCert, { keyFile: x509.userKey });
    const { manager } = setup([p], { [p.id]: { tlsKeyPassphrase: x509.passphrase } });
    await manager.open(p.id, undefined);
    expect(await authenticatedUser(manager, p.id)).toEqual([
      { user: x509.userSubject, db: '$external' },
    ]);
  });

  it('a certificate of the same CA without a user is AUTH_FAILED (test and open)', async () => {
    const p = x509Profile('unknown', x509.unknownBundle);
    const { manager } = setup([p]);
    expect((await failure(manager.test({ profileId: p.id }, undefined))).code).toBe('AUTH_FAILED');
    expect((await failure(manager.open(p.id, undefined))).code).toBe('AUTH_FAILED');
    expect(manager.statusOf(p.id)).toMatchObject({
      state: 'error',
      error: { code: 'AUTH_FAILED' },
    });
  });

  it('a user name that differs from the certificate subject is AUTH_FAILED', async () => {
    const p = x509Profile('mismatch', x509.userBundle, {
      username: 'CN=someone-else,OU=ThicketClients,O=Thicket Test',
    });
    const { manager } = setup([p]);
    expect((await failure(manager.test({ profileId: p.id }, undefined))).code).toBe('AUTH_FAILED');
  });

  it('a certificate from an unknown CA is refused by the server', async () => {
    const p = x509Profile('foreign', x509.foreignBundle);
    const { manager } = setup([p]);
    const error = await failure(manager.test({ profileId: p.id }, undefined));
    // mongod rejects the client certificate in the handshake by closing the socket, so the
    // client only sees "connection closed" until server selection gives up: no auth answer.
    expect(error.code).not.toBe('AUTH_FAILED');
    expect(['TLS_ERROR', 'NETWORK_ERROR', 'TIMEOUT']).toContain(error.code);
  });

  it('a wrong passphrase for the encrypted key is TLS_ERROR', async () => {
    const p = x509Profile('wrong-passphrase', x509.encryptedBundle);
    const { manager } = setup([p], { [p.id]: { tlsKeyPassphrase: 'wrong-passphrase' } });
    const error = await failure(manager.test({ profileId: p.id }, undefined));
    expect(error.code).toBe('TLS_ERROR');
    expect(error.message).not.toContain('wrong-passphrase');
  });
});
