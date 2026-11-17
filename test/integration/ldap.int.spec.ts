import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ConnectionManager, RpcError, type ConnectionManagerDeps } from '@thicket/backend';
import type { Profile } from '@thicket/contract';

import { startLdapFixture, type LdapFixture } from './fixtures/ldap.ts';

// LDAP (PLAIN) through the connection manager (task ldap-auth): MongoDB Enterprise checks the
// user's password against an OpenLDAP container.

let ldap: LdapFixture;
beforeAll(async () => {
  ldap = await startLdapFixture();
});
afterAll(async () => {
  await ldap?.stop();
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

function ldapProfile(
  id: string,
  extra: { username?: string; connectionString?: string; secretMode?: 'saved' | 'ask' } = {},
): Profile {
  return {
    id,
    name: `LDAP ${id}`,
    connectionString: extra.connectionString ?? ldap.uri,
    auth: {
      mechanism: 'PLAIN',
      secretMode: extra.secretMode ?? 'saved',
      ...(extra.username !== undefined ? { username: extra.username } : {}),
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

describe('LDAP (PLAIN)', () => {
  it('authenticates an LDAP user with the saved password', async () => {
    const p = ldapProfile('saved', { username: ldap.username });
    const { manager, logs } = setup([p], { [p.id]: { password: ldap.password } });
    await expect(manager.open(p.id, undefined)).resolves.toMatchObject({ state: 'connected' });
    expect(await authenticatedUser(manager, p.id)).toEqual([
      { user: ldap.username, db: '$external' },
    ]);
    // The user may read (readAnyDatabase from its `$external` user).
    const dbs = await manager.client(p.id).db('admin').command({ listDatabases: 1 });
    expect(dbs['ok']).toBe(1);
    expect(logs.join('\n')).not.toContain(ldap.password);
  });

  it('authenticates with the password typed at connect (secretMode ask)', async () => {
    const p = ldapProfile('ask', { username: ldap.username, secretMode: 'ask' });
    const { manager } = setup([p]);
    const result = await manager.test({ profileId: p.id }, ldap.password);
    expect(result.server.topology).toBe('standalone');
  });

  it('takes the user name from the connection string', async () => {
    const url = new URL(ldap.uri);
    url.username = ldap.username;
    const p = ldapProfile('uri-user', { connectionString: url.toString() });
    const { manager } = setup([p], { [p.id]: { password: ldap.password } });
    await manager.open(p.id, undefined);
    expect(await authenticatedUser(manager, p.id)).toEqual([
      { user: ldap.username, db: '$external' },
    ]);
  });

  it('answers AUTH_FAILED for a wrong password, without logging it', async () => {
    const wrong = `${ldap.password}-wrong`;
    const p = ldapProfile('wrong', { username: ldap.username });
    const { manager, logs } = setup([p], { [p.id]: { password: wrong } });
    const error = await failure(manager.open(p.id, undefined));
    expect(error.code).toBe('AUTH_FAILED');
    expect(error.message).not.toContain(wrong);
    expect(logs.join('\n')).not.toContain(wrong);
    expect(manager.statusOf(p.id).state).not.toBe('connected');
  });

  it('answers AUTH_FAILED for a user the directory does not know', async () => {
    const p = ldapProfile('unknown', { username: ldap.unknownUser });
    const { manager } = setup([p], { [p.id]: { password: ldap.password } });
    const error = await failure(manager.test({ profileId: p.id }, undefined));
    expect(error.code).toBe('AUTH_FAILED');
  });

  it('answers AUTH_FAILED without a password, before connecting', async () => {
    const p = ldapProfile('no-password', { username: ldap.username });
    const { manager } = setup([p]);
    const error = await failure(manager.test({ profileId: p.id }, undefined));
    expect(error.code).toBe('AUTH_FAILED');
  });
});
