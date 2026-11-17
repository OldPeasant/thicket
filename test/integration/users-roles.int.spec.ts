import { randomBytes } from 'node:crypto';

import { BSON, MongoClient, type Document } from 'mongodb';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { ConnectionManager, RpcClient, RpcError, serve, usersHandlers } from '@thicket/backend';
import { methods, type MethodName, type Profile, type ResultOf } from '@thicket/contract';

import { portPair } from '../../packages/backend/src/server/testing';

// admin.users / admin.roles (task users-roles-view) against the 8.x standalone fixture with
// custom roles (one inheriting from another custom role and a built-in role) and users holding
// them, served like the backend serves them (contract validation of params and results).

const mongo = inject('mongo');
const fixture = mongo.mongo8;

const PROFILE: Profile = {
  id: 'users-p',
  name: 'Users',
  connectionString: fixture.uri,
  readOnly: true,
  production: false,
  serverSelectionTimeoutMS: 10_000,
};

const DB = `users_${randomBytes(3).toString('hex')}`;
const OTHER_DB = `${DB}_other`;

let direct: MongoClient;
let manager: ConnectionManager;
let rpc: RpcClient;
let stop: () => void;

const call = <M extends MethodName>(method: M, params: unknown) =>
  rpc.call(method, params) as Promise<ResultOf<M>>;

const parse = (text: string) => BSON.EJSON.parse(text, { relaxed: false }) as Document;

async function failure(promise: Promise<unknown>): Promise<RpcError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RpcError) return error;
    throw new Error(`expected an RpcError, got ${String(error)}`, { cause: error });
  }
  throw new Error('expected a failure');
}

beforeAll(async () => {
  direct = await MongoClient.connect(fixture.uri);
  const db = direct.db(DB);
  await db.command({
    createRole: 'orderReader',
    privileges: [{ resource: { db: DB, collection: 'orders' }, actions: ['find'] }],
    roles: [],
  });
  await db.command({
    createRole: 'orderClerk',
    privileges: [{ resource: { db: DB, collection: 'orders' }, actions: ['insert', 'update'] }],
    roles: [
      { role: 'orderReader', db: DB },
      { role: 'read', db: DB },
    ],
  });
  await db.command({
    createUser: 'alice',
    pwd: randomBytes(12).toString('hex'),
    roles: [{ role: 'orderClerk', db: DB }],
    customData: { team: 'sales' },
  });
  await db.command({
    createUser: 'bob',
    pwd: randomBytes(12).toString('hex'),
    roles: [
      { role: 'orderReader', db: DB },
      { role: 'read', db: OTHER_DB },
    ],
  });

  manager = new ConnectionManager({
    loadProfile: (id) =>
      id === PROFILE.id
        ? Promise.resolve(PROFILE)
        : Promise.reject(new RpcError('NOT_FOUND', `No profile with id ${id}`)),
    loadSecrets: () => Promise.resolve(null),
  });
  await manager.open(PROFILE.id, undefined);
  const [serverPort, clientPort] = portPair();
  stop = serve(serverPort, { table: methods, route: 'backend', handlers: usersHandlers(manager) });
  rpc = new RpcClient(clientPort);
}, 60_000);

afterAll(async () => {
  rpc.close();
  stop();
  await manager.closeAll();
  const db = direct.db(DB);
  await db.command({ dropAllUsersFromDatabase: 1 }).catch(() => undefined);
  await db.command({ dropAllRolesFromDatabase: 1 }).catch(() => undefined);
  await direct.close();
});

describe('admin.users', () => {
  it('lists the users of the database with roles, inherited roles and privileges', async () => {
    const { users } = await call('admin.users', { profileId: PROFILE.id, db: DB });
    const docs = users.map(parse);
    expect(docs.map((u) => u['user'])).toEqual(['alice', 'bob']);

    const alice = docs[0] as Document;
    expect(alice['db']).toBe(DB);
    expect(alice['roles']).toEqual([{ role: 'orderClerk', db: DB }]);
    expect(alice['customData']).toEqual({ team: 'sales' });
    // Inherited through orderClerk: orderReader and the built-in read.
    const inherited = (alice['inheritedRoles'] as Document[]).map((r) => `${r['role']}@${r['db']}`);
    expect(inherited.sort()).toEqual([`orderClerk@${DB}`, `orderReader@${DB}`, `read@${DB}`]);
    const actions = (alice['inheritedPrivileges'] as Document[])
      .filter((p) => (p['resource'] as Document)['collection'] === 'orders')
      .flatMap((p) => p['actions'] as string[]);
    expect(actions).toEqual(expect.arrayContaining(['find', 'insert', 'update']));

    const bob = docs[1] as Document;
    expect(bob['roles']).toEqual(
      expect.arrayContaining([
        { role: 'orderReader', db: DB },
        { role: 'read', db: OTHER_DB },
      ]),
    );
  });

  it('never sends credentials to the renderer', async () => {
    const { users } = await call('admin.users', { profileId: PROFILE.id, db: DB });
    for (const text of users) {
      expect(parse(text)).not.toHaveProperty('credentials');
      expect(text).not.toMatch(/storedKey|serverKey|SCRAM-SHA-256"\s*:\s*\{/);
    }
  });

  it('answers an empty list for a database without users', async () => {
    await expect(call('admin.users', { profileId: PROFILE.id, db: OTHER_DB })).resolves.toEqual({
      users: [],
    });
  });
});

describe('admin.roles', () => {
  it('lists the custom roles with privileges and inherited roles', async () => {
    const { roles } = await call('admin.roles', { profileId: PROFILE.id, db: DB });
    const docs = roles.map(parse);
    expect(docs.map((r) => r['role'])).toEqual(['orderClerk', 'orderReader']);

    const clerk = docs[0] as Document;
    expect(clerk['isBuiltin']).toBe(false);
    expect(clerk['roles']).toEqual(
      expect.arrayContaining([
        { role: 'orderReader', db: DB },
        { role: 'read', db: DB },
      ]),
    );
    expect(clerk['privileges']).toEqual([
      { resource: { db: DB, collection: 'orders' }, actions: ['insert', 'update'] },
    ]);
    const inherited = (clerk['inheritedRoles'] as Document[]).map((r) => `${r['role']}@${r['db']}`);
    expect(inherited.sort()).toEqual([`orderReader@${DB}`, `read@${DB}`]);
    const inheritedActions = (clerk['inheritedPrivileges'] as Document[]).flatMap(
      (p) => p['actions'] as string[],
    );
    expect(inheritedActions).toEqual(expect.arrayContaining(['find', 'insert', 'listCollections']));

    const reader = docs[1] as Document;
    expect(reader['roles']).toEqual([]);
    expect(reader['inheritedRoles']).toEqual([]);
  });

  it('adds the built-in roles on request', async () => {
    const { roles } = await call('admin.roles', { profileId: PROFILE.id, db: DB, builtin: true });
    const docs = roles.map(parse);
    const names = docs.map((r) => r['role'] as string);
    expect(names).toEqual(expect.arrayContaining(['orderClerk', 'orderReader', 'read', 'dbOwner']));
    expect(names).toEqual([...names].sort());
    expect(docs.find((r) => r['role'] === 'read')?.['isBuiltin']).toBe(true);
  });

  it('answers NOT_CONNECTED for a profile without an open connection', async () => {
    const error = await failure(call('admin.roles', { profileId: 'other', db: DB }));
    expect(error.code).toBe('NOT_CONNECTED');
  });
});
