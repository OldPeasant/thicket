import { randomBytes } from 'node:crypto';

import { MongoClient, type Document } from 'mongodb';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  ConnectionManager,
  guardWrites,
  RpcClient,
  RpcError,
  serve,
  usersEditHandlers,
  usersHandlers,
} from '@thicket/backend';
import { methods, type MethodName, type Profile, type ResultOf } from '@thicket/contract';

import { portPair } from '../../packages/backend/src/server/testing';

// The user and role changes of task users-roles-edit (admin.createUser … admin.revokeRoles)
// against the 8.x standalone fixture, served like the backend serves them: contract validation
// and the write guard. Each operation is checked with a direct client (usersInfo / rolesInfo) and
// new passwords by signing in with them (SCRAM runs even without --auth).

const fixture = inject('mongo').mongo8;

const base = { connectionString: fixture.uri, serverSelectionTimeoutMS: 10_000 };
const PROFILES: Record<string, Profile> = {
  plain: { id: 'edit-p', name: 'Edit', readOnly: false, production: false, ...base },
  prod: { id: 'edit-prod', name: 'Prod', readOnly: false, production: true, ...base },
  ro: { id: 'edit-ro', name: 'RO', readOnly: true, production: false, ...base },
};
const P = PROFILES['plain']?.id ?? '';

const DB = `uedit_${randomBytes(3).toString('hex')}`;

let direct: MongoClient;
let manager: ConnectionManager;
let rpc: RpcClient;
let stop: () => void;

const call = <M extends MethodName>(method: M, params: unknown) =>
  rpc.call(method, params) as Promise<ResultOf<M>>;

const secret = () => randomBytes(12).toString('hex');

async function failure(promise: Promise<unknown>): Promise<RpcError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RpcError) return error;
    throw new Error(`expected an RpcError, got ${String(error)}`, { cause: error });
  }
  throw new Error('expected a failure');
}

async function userInfo(user: string): Promise<Document | undefined> {
  const answer = await direct.db(DB).command({ usersInfo: user });
  return (answer['users'] as Document[])[0];
}

async function roleInfo(role: string): Promise<Document | undefined> {
  const answer = await direct.db(DB).command({ rolesInfo: role, showPrivileges: true });
  return (answer['roles'] as Document[])[0];
}

/** Signs in as `user` with `password` and runs `ping` (throws on a wrong password). */
async function signIn(user: string, password: string): Promise<void> {
  const client = new MongoClient(fixture.uri, {
    auth: { username: user, password },
    authSource: DB,
    serverSelectionTimeoutMS: 10_000,
  });
  try {
    await client.db(DB).command({ ping: 1 });
  } finally {
    await client.close();
  }
}

const sorted = (roles: unknown) =>
  (roles as Document[]).map((r) => `${String(r['role'])}@${String(r['db'])}`).sort();

beforeAll(async () => {
  direct = await MongoClient.connect(fixture.uri);
  manager = new ConnectionManager({
    loadProfile: (id) => {
      const profile = Object.values(PROFILES).find((p) => p.id === id);
      return profile
        ? Promise.resolve(profile)
        : Promise.reject(new RpcError('NOT_FOUND', `No profile with id ${id}`));
    },
    loadSecrets: () => Promise.resolve(null),
  });
  for (const profile of Object.values(PROFILES)) await manager.open(profile.id, undefined);
  const lookup = (id: string) => {
    const profile = Object.values(PROFILES).find((p) => p.id === id);
    if (!profile) throw new RpcError('NOT_FOUND', id);
    return Promise.resolve(profile);
  };
  const handlers = guardWrites(
    { ...usersHandlers(manager), ...usersEditHandlers(manager) },
    lookup,
  );
  const [serverPort, clientPort] = portPair();
  stop = serve(serverPort, { table: methods, route: 'backend', handlers });
  rpc = new RpcClient(clientPort);
}, 60_000);

afterAll(async () => {
  rpc.close();
  stop();
  await manager.closeAll();
  const db = direct.db(DB);
  await db.command({ dropAllUsersFromDatabase: 1 }).catch(() => undefined);
  await db.command({ dropAllRolesFromDatabase: 1 }).catch(() => undefined);
  await db.dropDatabase().catch(() => undefined);
  await direct.close();
});

describe('roles', () => {
  it('admin.createRole creates a role with privileges and inherited roles', async () => {
    await call('admin.createRole', {
      profileId: P,
      db: DB,
      role: 'stockReader',
      privileges: JSON.stringify([
        { resource: { db: DB, collection: 'stock' }, actions: ['find'] },
      ]),
      roles: [],
    });
    await call('admin.createRole', {
      profileId: P,
      db: DB,
      role: 'stockClerk',
      privileges: JSON.stringify([
        { resource: { db: DB, collection: 'stock' }, actions: ['insert'] },
      ]),
      roles: [{ role: 'stockReader', db: DB }],
    });
    const clerk = await roleInfo('stockClerk');
    expect(clerk?.['privileges']).toEqual([
      { resource: { db: DB, collection: 'stock' }, actions: ['insert'] },
    ]);
    expect(sorted(clerk?.['roles'])).toEqual([`stockReader@${DB}`]);
    // admin.roles sees it too.
    const { roles } = await call('admin.roles', { profileId: P, db: DB });
    expect(roles.some((r) => r.includes('"stockClerk"'))).toBe(true);
  });

  it('admin.createRole of an existing role answers SERVER_ERROR', async () => {
    const error = await failure(
      call('admin.createRole', {
        profileId: P,
        db: DB,
        role: 'stockReader',
        privileges: '[]',
        roles: [],
      }),
    );
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.message).toMatch(/already exists/i);
  });

  it('admin.createRole refuses privileges that are not documents (INVALID_PARAMS)', async () => {
    const error = await failure(
      call('admin.createRole', { profileId: P, db: DB, role: 'bad', privileges: '[1]', roles: [] }),
    );
    expect(error.code).toBe('INVALID_PARAMS');
    expect(await roleInfo('bad')).toBeUndefined();
  });

  it('admin.updateRole replaces privileges and inherited roles', async () => {
    await call('admin.updateRole', {
      profileId: P,
      db: DB,
      role: 'stockClerk',
      privileges: JSON.stringify([
        { resource: { db: DB, collection: 'stock' }, actions: ['insert', 'update'] },
      ]),
      roles: [{ role: 'read', db: DB }],
    });
    const clerk = await roleInfo('stockClerk');
    expect(clerk?.['privileges']).toEqual([
      { resource: { db: DB, collection: 'stock' }, actions: ['insert', 'update'] },
    ]);
    expect(sorted(clerk?.['roles'])).toEqual([`read@${DB}`]);
  });

  it('admin.grantRoles / admin.revokeRoles on a role change what it inherits', async () => {
    await call('admin.grantRoles', {
      profileId: P,
      db: DB,
      kind: 'role',
      name: 'stockClerk',
      roles: [{ role: 'stockReader', db: DB }],
    });
    expect(sorted((await roleInfo('stockClerk'))?.['roles'])).toEqual([
      `read@${DB}`,
      `stockReader@${DB}`,
    ]);
    await call('admin.revokeRoles', {
      profileId: P,
      db: DB,
      kind: 'role',
      name: 'stockClerk',
      roles: [{ role: 'read', db: DB }],
    });
    expect(sorted((await roleInfo('stockClerk'))?.['roles'])).toEqual([`stockReader@${DB}`]);
  });
});

describe('users', () => {
  const password = secret();

  it('admin.createUser creates a user who can sign in with the password', async () => {
    await call('admin.createUser', {
      profileId: P,
      db: DB,
      user: 'dana',
      password,
      roles: [{ role: 'stockReader', db: DB }],
      customData: JSON.stringify({ team: { $numberInt: '7' } }),
    });
    const dana = await userInfo('dana');
    expect(sorted(dana?.['roles'])).toEqual([`stockReader@${DB}`]);
    expect(dana?.['customData']).toEqual({ team: 7 });
    await signIn('dana', password);
    await expect(signIn('dana', `${password}x`)).rejects.toThrow(/Authentication failed/i);
  });

  it('admin.createUser without a password is INVALID_PARAMS and creates nothing', async () => {
    const error = await failure(
      call('admin.createUser', { profileId: P, db: DB, user: 'nopw', roles: [] }),
    );
    expect(error.code).toBe('INVALID_PARAMS');
    expect(await userInfo('nopw')).toBeUndefined();
  });

  it('a failed admin.createUser never echoes the password', async () => {
    const other = secret();
    const error = await failure(
      call('admin.createUser', { profileId: P, db: DB, user: 'dana', password: other, roles: [] }),
    );
    expect(error.code).toBe('SERVER_ERROR');
    expect(JSON.stringify({ message: error.message, detail: error.detail })).not.toContain(other);
  });

  it('admin.grantRoles / admin.revokeRoles on a user', async () => {
    await call('admin.grantRoles', {
      profileId: P,
      db: DB,
      kind: 'user',
      name: 'dana',
      roles: [
        { role: 'stockClerk', db: DB },
        { role: 'read', db: 'admin' },
      ],
    });
    expect(sorted((await userInfo('dana'))?.['roles'])).toEqual([
      'read@admin',
      `stockClerk@${DB}`,
      `stockReader@${DB}`,
    ]);
    await call('admin.revokeRoles', {
      profileId: P,
      db: DB,
      kind: 'user',
      name: 'dana',
      roles: [{ role: 'read', db: 'admin' }],
    });
    expect(sorted((await userInfo('dana'))?.['roles'])).toEqual([
      `stockClerk@${DB}`,
      `stockReader@${DB}`,
    ]);
  });

  it('admin.grantRoles of an unknown role answers SERVER_ERROR', async () => {
    const error = await failure(
      call('admin.grantRoles', {
        profileId: P,
        db: DB,
        kind: 'user',
        name: 'dana',
        roles: [{ role: 'noSuchRole', db: DB }],
      }),
    );
    expect(error.code).toBe('SERVER_ERROR');
  });

  it('admin.updateUser changes the password, roles and custom data', async () => {
    const next = secret();
    await call('admin.updateUser', {
      profileId: P,
      db: DB,
      user: 'dana',
      password: next,
      roles: [{ role: 'read', db: DB }],
      customData: '{"team":"ops"}',
    });
    const dana = await userInfo('dana');
    expect(sorted(dana?.['roles'])).toEqual([`read@${DB}`]);
    expect(dana?.['customData']).toEqual({ team: 'ops' });
    await signIn('dana', next);
    await expect(signIn('dana', password)).rejects.toThrow(/Authentication failed/i);
  });

  it('admin.updateUser with nothing to change is INVALID_PARAMS', async () => {
    const error = await failure(call('admin.updateUser', { profileId: P, db: DB, user: 'dana' }));
    expect(error.code).toBe('INVALID_PARAMS');
  });

  it('admin.dropUser drops the user; dropping again answers SERVER_ERROR', async () => {
    await call('admin.dropUser', { profileId: P, db: DB, user: 'dana' });
    expect(await userInfo('dana')).toBeUndefined();
    const error = await failure(call('admin.dropUser', { profileId: P, db: DB, user: 'dana' }));
    expect(error.code).toBe('SERVER_ERROR');
  });
});

describe('admin.dropRole', () => {
  it('drops the role', async () => {
    await call('admin.dropRole', { profileId: P, db: DB, role: 'stockClerk' });
    expect(await roleInfo('stockClerk')).toBeUndefined();
  });
});

describe('the write guard', () => {
  it('a read-only profile is refused with READ_ONLY and nothing changes', async () => {
    const error = await failure(
      call('admin.createUser', {
        profileId: PROFILES['ro']?.id,
        db: DB,
        user: 'eve',
        password: secret(),
        roles: [],
        confirmed: true,
      }),
    );
    expect(error.code).toBe('READ_ONLY');
    expect(await userInfo('eve')).toBeUndefined();
  });

  it('a production profile needs confirmed: true', async () => {
    const profileId = PROFILES['prod']?.id;
    const error = await failure(call('admin.dropRole', { profileId, db: DB, role: 'stockReader' }));
    expect(error.code).toBe('CONFIRMATION_REQUIRED');
    expect(await roleInfo('stockReader')).toBeDefined();
    await call('admin.dropRole', { profileId, db: DB, role: 'stockReader', confirmed: true });
    expect(await roleInfo('stockReader')).toBeUndefined();
  });
});
