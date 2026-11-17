import type { Profile } from '@thicket/contract';
import type { Document } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { ConnectionManager, type ClientLike } from '../../../connections/manager';
import { RpcError, type Handler } from '../../../server/rpc';
import { usersEditHandlers } from './handlers';

// Fictitious connection and password: never real credentials.
const PW = 'fictitious-Pw-41b9';
const profile: Profile = {
  id: 'p1',
  name: 'Local',
  connectionString: 'mongodb://db.example.test:27017',
  readOnly: false,
  production: false,
};

type Answer = (db: string, command: Document) => Document | Promise<Document>;

const defaultAnswer: Answer = (_db, command) => {
  if ('hello' in command) return { isWritablePrimary: true, ok: 1 };
  if ('buildInfo' in command) return { version: '8.2.0', ok: 1 };
  return { ok: 1 };
};

async function setup(answer: Answer = defaultAnswer) {
  const sent: { db: string; command: Document; options: unknown }[] = [];
  const client: ClientLike = {
    connect: () => Promise.resolve(),
    close: () => Promise.resolve(),
    db: (db) => ({
      command: async (command, options) => {
        sent.push({ db, command, options });
        return answer(db, command);
      },
    }),
  };
  const manager = new ConnectionManager({
    loadProfile: (id) =>
      id === 'p1' ? Promise.resolve(profile) : Promise.reject(new RpcError('NOT_FOUND', id)),
    loadSecrets: () => Promise.resolve(null),
    createClient: () => client,
  });
  await manager.open('p1', undefined);
  sent.length = 0;
  const handlers = usersEditHandlers(manager);
  const call = (method: string, params: unknown) =>
    Promise.resolve(
      (handlers[method] as Handler)(params as never, {
        signal: new AbortController().signal,
        requestId: 'r1',
      }),
    );
  return { handlers, call, sent };
}

function serverError(message: string, code: number, codeName: string): Error {
  return Object.assign(new Error(message), { name: 'MongoServerError', code, codeName });
}

const READ = { role: 'read', db: 'shop' };

describe('usersEditHandlers', () => {
  it('serves exactly the eight user and role changes', async () => {
    const { handlers } = await setup();
    expect(Object.keys(handlers).sort()).toEqual([
      'admin.createRole',
      'admin.createUser',
      'admin.dropRole',
      'admin.dropUser',
      'admin.grantRoles',
      'admin.revokeRoles',
      'admin.updateRole',
      'admin.updateUser',
    ]);
  });

  const calls: [string, Record<string, unknown>, Document][] = [
    [
      'admin.createUser',
      { user: 'carl', password: PW, roles: [READ] },
      { createUser: 'carl', pwd: PW, roles: [READ] },
    ],
    ['admin.updateUser', { user: 'carl', roles: [] }, { updateUser: 'carl', roles: [] }],
    ['admin.dropUser', { user: 'carl' }, { dropUser: 'carl' }],
    [
      'admin.createRole',
      { role: 'clerk', privileges: '[]', roles: [READ] },
      { createRole: 'clerk', privileges: [], roles: [READ] },
    ],
    ['admin.updateRole', { role: 'clerk', roles: [] }, { updateRole: 'clerk', roles: [] }],
    ['admin.dropRole', { role: 'clerk' }, { dropRole: 'clerk' }],
    [
      'admin.grantRoles',
      { kind: 'user', name: 'carl', roles: [READ] },
      { grantRolesToUser: 'carl', roles: [READ] },
    ],
    [
      'admin.revokeRoles',
      { kind: 'role', name: 'clerk', roles: [READ] },
      { revokeRolesFromRole: 'clerk', roles: [READ] },
    ],
  ];

  it.each(calls)(
    '%s runs one command in the target database and answers {}',
    async (method, params, expected) => {
      const { call, sent } = await setup();
      await expect(call(method, { profileId: 'p1', db: 'shop', ...params })).resolves.toEqual({});
      expect(sent.map((s) => ({ db: s.db, command: s.command }))).toEqual([
        { db: 'shop', command: expected },
      ]);
      // A write goes to the primary: no read preference in the command options.
      expect(sent[0]?.options).not.toHaveProperty('readPreference');
    },
  );

  it.each(calls)(
    '%s answers NOT_CONNECTED for a profile without an open connection',
    async (method, params) => {
      const { call, sent } = await setup();
      await expect(call(method, { profileId: 'p2', db: 'shop', ...params })).rejects.toMatchObject({
        code: 'NOT_CONNECTED',
      });
      expect(sent).toEqual([]);
    },
  );

  it('invalid params answer INVALID_PARAMS before anything is sent', async () => {
    const { call, sent } = await setup();
    await expect(
      call('admin.createUser', { profileId: 'p1', db: 'shop', user: 'carl', roles: [] }),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    await expect(
      call('admin.updateUser', { profileId: 'p1', db: '$external', user: 'x', password: PW }),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    await expect(
      call('admin.updateRole', { profileId: 'p1', db: 'shop', role: 'clerk' }),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    expect(sent).toEqual([]);
  });

  it('a server refusal becomes SERVER_ERROR with the server code, without the password', async () => {
    const { call } = await setup((db, command) => {
      if ('createUser' in command) {
        throw serverError('User "carl@shop" already exists', 51003, 'Location51003');
      }
      return defaultAnswer(db, command);
    });
    const failure = call('admin.createUser', {
      profileId: 'p1',
      db: 'shop',
      user: 'carl',
      password: PW,
      roles: [],
    });
    await expect(failure).rejects.toMatchObject({
      code: 'SERVER_ERROR',
      message: expect.stringContaining('already exists') as unknown,
      detail: { serverCode: 51003 },
    });
    const error = (await failure.catch((e: unknown) => e)) as RpcError;
    expect(JSON.stringify({ message: error.message, detail: error.detail })).not.toContain(PW);
  });

  it('an unknown role or user becomes SERVER_ERROR (RoleNotFound, UserNotFound)', async () => {
    const { call } = await setup((db, command) => {
      if ('grantRolesToUser' in command) {
        throw serverError('Could not find role: nope@shop', 31, 'RoleNotFound');
      }
      if ('dropUser' in command) throw serverError('User nope@shop not found', 11, 'UserNotFound');
      return defaultAnswer(db, command);
    });
    await expect(
      call('admin.grantRoles', {
        profileId: 'p1',
        db: 'shop',
        kind: 'user',
        name: 'alice',
        roles: [{ role: 'nope', db: 'shop' }],
      }),
    ).rejects.toMatchObject({
      code: 'SERVER_ERROR',
      detail: { serverCode: 31, codeName: 'RoleNotFound' },
    });
    await expect(
      call('admin.dropUser', { profileId: 'p1', db: 'shop', user: 'nope' }),
    ).rejects.toMatchObject({
      code: 'SERVER_ERROR',
      detail: { serverCode: 11, codeName: 'UserNotFound' },
    });
  });
});
