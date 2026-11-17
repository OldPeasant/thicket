import type { Profile } from '@thicket/contract';
import { BSON, type Document } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { ConnectionManager, type ClientLike } from '../../connections/manager';
import { RpcError, type Handler } from '../../server/rpc';
import { usersHandlers } from './handlers';

const profile: Profile = {
  id: 'p1',
  name: 'Local',
  connectionString: 'mongodb://db.example.test:27017',
  readOnly: false,
  production: false,
};

type Answer = (db: string, command: Document) => Document | Promise<Document>;

const defaultAnswer: Answer = (db, command) => {
  if ('hello' in command) return { isWritablePrimary: true, ok: 1 };
  if ('buildInfo' in command) return { version: '8.2.0', ok: 1 };
  if ('usersInfo' in command) {
    if (command['usersInfo'] === 1) {
      return {
        users: [
          { user: 'zed', db },
          { user: 'amy', db },
        ],
        ok: 1,
      };
    }
    return {
      users: [
        {
          user: 'zed',
          db,
          roles: [{ role: 'read', db }],
          credentials: { 'SCRAM-SHA-256': { storedKey: 'secret' } },
        },
        { user: 'amy', db, roles: [] },
      ],
      ok: 1,
    };
  }
  if ('rolesInfo' in command) {
    return {
      roles: [
        { role: 'writer', db, isBuiltin: false, roles: [] },
        { role: 'auditor', db, isBuiltin: false, roles: [], privileges: [] },
      ],
      ok: 1,
    };
  }
  return { ok: 1 };
};

async function setup(answer: Answer = defaultAnswer) {
  const sent: { db: string; command: Document }[] = [];
  const client: ClientLike = {
    connect: () => Promise.resolve(),
    close: () => Promise.resolve(),
    db: (db) => ({
      command: async (command) => {
        sent.push({ db, command });
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
  const handlers = usersHandlers(manager);
  const call = (method: string, params: unknown, signal = new AbortController().signal) =>
    Promise.resolve((handlers[method] as Handler)(params as never, { signal, requestId: 'r1' }));
  return { handlers, call, sent };
}

const parse = (text: string) => BSON.EJSON.parse(text, { relaxed: false }) as Document;

describe('usersHandlers', () => {
  it('serves exactly admin.users and admin.roles', async () => {
    const { handlers } = await setup();
    expect(Object.keys(handlers).sort()).toEqual(['admin.roles', 'admin.users']);
  });

  it.each(['admin.users', 'admin.roles'])(
    '%s answers NOT_CONNECTED for a profile without an open connection',
    async (method) => {
      const { call, sent } = await setup();
      await expect(call(method, { profileId: 'p2', db: 'shop' })).rejects.toMatchObject({
        code: 'NOT_CONNECTED',
      });
      expect(sent).toEqual([]);
    },
  );

  it('admin.users asks for names, then exact-match details with privileges, sorted by name', async () => {
    const { call, sent } = await setup();
    const { users } = (await call('admin.users', { profileId: 'p1', db: 'shop' })) as {
      users: string[];
    };
    expect(users.map(parse).map((u) => u['user'])).toEqual(['amy', 'zed']);
    expect(sent).toEqual([
      { db: 'shop', command: { usersInfo: 1 } },
      {
        db: 'shop',
        command: {
          usersInfo: [
            { user: 'zed', db: 'shop' },
            { user: 'amy', db: 'shop' },
          ],
          showPrivileges: true,
        },
      },
    ]);
  });

  it('admin.users drops credentials', async () => {
    const { call } = await setup();
    const { users } = (await call('admin.users', { profileId: 'p1', db: 'shop' })) as {
      users: string[];
    };
    for (const text of users) expect(text).not.toContain('credentials');
    expect(users.join()).not.toContain('secret');
  });

  it('admin.users skips the detail query for a database without users', async () => {
    const { call, sent } = await setup((db, command) =>
      'usersInfo' in command ? { users: [], ok: 1 } : defaultAnswer(db, command),
    );
    await expect(call('admin.users', { profileId: 'p1', db: 'shop' })).resolves.toEqual({
      users: [],
    });
    expect(sent).toHaveLength(1);
  });

  it('admin.roles asks for privileges, built-in roles only on request, sorted by name', async () => {
    const { call, sent } = await setup();
    const first = (await call('admin.roles', { profileId: 'p1', db: 'shop' })) as {
      roles: string[];
    };
    expect(first.roles.map(parse).map((r) => r['role'])).toEqual(['auditor', 'writer']);
    await call('admin.roles', { profileId: 'p1', db: 'shop', builtin: true });
    expect(sent.map((s) => s.command)).toEqual([
      { rolesInfo: 1, showPrivileges: true, showBuiltinRoles: false },
      { rolesInfo: 1, showPrivileges: true, showBuiltinRoles: true },
    ]);
  });

  it('a server refusal becomes SERVER_ERROR with the server code', async () => {
    const { call } = await setup((db, command) => {
      if ('rolesInfo' in command) {
        throw Object.assign(new Error('not authorized on shop to execute command'), {
          name: 'MongoServerError',
          code: 13,
          codeName: 'Unauthorized',
        });
      }
      return defaultAnswer(db, command);
    });
    await expect(call('admin.roles', { profileId: 'p1', db: 'shop' })).rejects.toMatchObject({
      code: 'SERVER_ERROR',
      detail: { serverCode: 13, codeName: 'Unauthorized' },
    });
  });

  it('a cancel answers CANCELLED at once while the server command is pending', async () => {
    let release!: () => void;
    const { call } = await setup((db, command) =>
      'rolesInfo' in command
        ? new Promise<Document>((resolve) => {
            release = () => resolve(defaultAnswer(db, command) as Document);
          })
        : defaultAnswer(db, command),
    );
    const controller = new AbortController();
    const pending = call('admin.roles', { profileId: 'p1', db: 'shop' }, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    release();
  });
});
