import type { ParsedParamsOf } from '@thicket/contract';
import { BSON, type Document } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { RpcError } from '../../../server/rpc';
import { EDIT_METHODS, EXTERNAL_DB, editCommand, parsePrivileges, type EditMethod } from './edit';

// Fictitious password: never a real credential.
const PW = 'fictitious-Pw-7c1e';
const base = { profileId: 'p1', db: 'shop' };
const READ = { role: 'read', db: 'shop' };
const ANY = { role: 'readAnyDatabase', db: 'admin' };

const command = <M extends EditMethod>(method: M, params: Record<string, unknown>) =>
  editCommand(method, params as ParsedParamsOf<M>);

function invalid(run: () => unknown): RpcError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(RpcError);
    expect((error as RpcError).code).toBe('INVALID_PARAMS');
    return error as RpcError;
  }
  throw new Error('expected INVALID_PARAMS');
}

describe('editCommand', () => {
  it('lists the eight user and role changes', () => {
    expect([...EDIT_METHODS].sort()).toEqual([
      'admin.createRole',
      'admin.createUser',
      'admin.dropRole',
      'admin.dropUser',
      'admin.grantRoles',
      'admin.revokeRoles',
      'admin.updateRole',
      'admin.updateUser',
    ]);
    expect(EXTERNAL_DB).toBe('$external');
  });

  describe('admin.createUser', () => {
    it('sends createUser first, the password as pwd, roles and custom data', () => {
      const cmd = command('admin.createUser', {
        ...base,
        user: 'carl',
        password: PW,
        roles: [READ, ANY],
        customData: '{"team":"sales","level":{"$numberInt":"3"}}',
      });
      expect(Object.keys(cmd)[0]).toBe('createUser');
      expect(cmd).toEqual({
        createUser: 'carl',
        pwd: PW,
        roles: [READ, ANY],
        customData: { team: 'sales', level: new BSON.Int32(3) },
      });
    });

    it('leaves out customData when not given and sends an empty role list', () => {
      expect(
        command('admin.createUser', { ...base, user: 'carl', password: PW, roles: [] }),
      ).toEqual({ createUser: 'carl', pwd: PW, roles: [] });
    });

    it('copies only role and db of each role', () => {
      const cmd = command('admin.createUser', {
        ...base,
        user: 'carl',
        password: PW,
        roles: [{ role: 'read', db: 'shop', extra: 'x' }],
      });
      expect(cmd['roles']).toEqual([READ]);
    });

    it('refuses a new user outside $external without a password', () => {
      const error = invalid(() =>
        command('admin.createUser', { ...base, user: 'carl', roles: [READ] }),
      );
      expect(error.message).toBe('a new user needs a password');
    });

    it('creates a $external user without a password', () => {
      expect(
        command('admin.createUser', {
          profileId: 'p1',
          db: '$external',
          user: 'CN=carl,OU=Fictitious,O=Example',
          roles: [READ],
        }),
      ).toEqual({ createUser: 'CN=carl,OU=Fictitious,O=Example', roles: [READ] });
    });

    it('refuses a password for a $external user and never names the password', () => {
      const error = invalid(() =>
        command('admin.createUser', {
          profileId: 'p1',
          db: '$external',
          user: 'carl',
          password: PW,
          roles: [],
        }),
      );
      expect(error.message).toBe('users of $external have no password');
      expect(JSON.stringify({ m: error.message, d: error.detail })).not.toContain(PW);
    });

    it.each([
      ['an array', '[1]', /customData must be an EJSON document/],
      ['a value wrapper', '{"$oid":"64b7f0c2a1b2c3d4e5f60718"}', /must be an EJSON document/],
      ['invalid EJSON', '{"team":', /customData is not valid EJSON/],
    ])('refuses custom data that is %s', (_what, customData, message) => {
      const error = invalid(() =>
        command('admin.createUser', { ...base, user: 'carl', password: PW, roles: [], customData }),
      );
      expect(error.message).toMatch(message);
      expect(error.message).not.toContain(PW);
    });
  });

  describe('admin.updateUser', () => {
    it('sends only what is given', () => {
      expect(command('admin.updateUser', { ...base, user: 'alice', password: PW })).toEqual({
        updateUser: 'alice',
        pwd: PW,
      });
      expect(command('admin.updateUser', { ...base, user: 'alice', roles: [] })).toEqual({
        updateUser: 'alice',
        roles: [],
      });
      expect(command('admin.updateUser', { ...base, user: 'alice', customData: '{}' })).toEqual({
        updateUser: 'alice',
        customData: {},
      });
    });

    it('sends password, roles and custom data together, updateUser first', () => {
      const cmd = command('admin.updateUser', {
        ...base,
        user: 'alice',
        password: PW,
        roles: [ANY],
        customData: '{"team":"ops"}',
      });
      expect(Object.keys(cmd)).toEqual(['updateUser', 'pwd', 'roles', 'customData']);
      expect(cmd).toEqual({
        updateUser: 'alice',
        pwd: PW,
        roles: [ANY],
        customData: { team: 'ops' },
      });
    });

    it('refuses an update that changes nothing', () => {
      const error = invalid(() => command('admin.updateUser', { ...base, user: 'alice' }));
      expect(error.message).toMatch(/^nothing to change/);
    });

    it('refuses a new password for a $external user and never names the password', () => {
      const error = invalid(() =>
        command('admin.updateUser', { profileId: 'p1', db: '$external', user: 'x', password: PW }),
      );
      expect(error.message).not.toContain(PW);
    });

    it('changes roles of a $external user', () => {
      expect(
        command('admin.updateUser', { profileId: 'p1', db: '$external', user: 'x', roles: [ANY] }),
      ).toEqual({ updateUser: 'x', roles: [ANY] });
    });

    it('refuses custom data that is not a document', () => {
      invalid(() => command('admin.updateUser', { ...base, user: 'alice', customData: '[]' }));
    });
  });

  it('admin.dropUser and admin.dropRole name only the user or role', () => {
    expect(command('admin.dropUser', { ...base, user: 'alice' })).toEqual({ dropUser: 'alice' });
    expect(command('admin.dropRole', { ...base, role: 'clerk' })).toEqual({ dropRole: 'clerk' });
  });

  describe('admin.createRole', () => {
    it('sends createRole first, parsed privileges and parent roles', () => {
      const cmd = command('admin.createRole', {
        ...base,
        role: 'clerk',
        privileges:
          '[{"resource":{"db":"shop","collection":"orders"},"actions":["find","insert"]}]',
        roles: [READ],
      });
      expect(Object.keys(cmd)).toEqual(['createRole', 'privileges', 'roles']);
      expect(cmd).toEqual({
        createRole: 'clerk',
        privileges: [
          { resource: { db: 'shop', collection: 'orders' }, actions: ['find', 'insert'] },
        ],
        roles: [READ],
      });
    });

    it('accepts no privileges and no parent roles', () => {
      expect(
        command('admin.createRole', { ...base, role: 'empty', privileges: '[]', roles: [] }),
      ).toEqual({ createRole: 'empty', privileges: [], roles: [] });
    });

    it('refuses privileges that are not documents', () => {
      invalid(() =>
        command('admin.createRole', { ...base, role: 'clerk', privileges: '[1]', roles: [] }),
      );
    });
  });

  describe('admin.updateRole', () => {
    it('sends only privileges or only roles', () => {
      expect(command('admin.updateRole', { ...base, role: 'clerk', privileges: '[]' })).toEqual({
        updateRole: 'clerk',
        privileges: [],
      });
      expect(command('admin.updateRole', { ...base, role: 'clerk', roles: [READ] })).toEqual({
        updateRole: 'clerk',
        roles: [READ],
      });
    });

    it('sends both, updateRole first', () => {
      const cmd = command('admin.updateRole', {
        ...base,
        role: 'clerk',
        privileges: '[{"resource":{"cluster":true},"actions":["serverStatus"]}]',
        roles: [],
      });
      expect(Object.keys(cmd)).toEqual(['updateRole', 'privileges', 'roles']);
      expect(cmd['privileges']).toEqual([
        { resource: { cluster: true }, actions: ['serverStatus'] },
      ]);
    });

    it('refuses an update that changes nothing', () => {
      const error = invalid(() => command('admin.updateRole', { ...base, role: 'clerk' }));
      expect(error.message).toBe('nothing to change: give privileges or roles');
    });

    it('refuses bad privileges', () => {
      invalid(() => command('admin.updateRole', { ...base, role: 'clerk', privileges: '{}' }));
    });
  });

  it.each([
    ['admin.grantRoles', 'user', 'grantRolesToUser'],
    ['admin.grantRoles', 'role', 'grantRolesToRole'],
    ['admin.revokeRoles', 'user', 'revokeRolesFromUser'],
    ['admin.revokeRoles', 'role', 'revokeRolesFromRole'],
  ] as const)('%s to a %s sends %s with the roles', (method, kind, name) => {
    const cmd = command(method, { ...base, kind, name: 'alice', roles: [READ, ANY] });
    expect(Object.keys(cmd)).toEqual([name, 'roles']);
    expect(cmd).toEqual({ [name]: 'alice', roles: [READ, ANY] });
  });
});

describe('parsePrivileges', () => {
  it('reads canonical EJSON of privilege documents, keeping BSON types', () => {
    const value: Document[] = parsePrivileges(
      '[{"resource":{"db":"shop","collection":""},"actions":["find"],"n":{"$numberLong":"5"}}]',
    );
    expect(value).toEqual([
      { resource: { db: 'shop', collection: '' }, actions: ['find'], n: new BSON.Long(5) },
    ]);
  });

  it.each([
    ['a document', '{"resource":{}}', 'privileges must be an array'],
    ['a string', '"find"', 'privileges must be an array'],
    ['an array with a number', '[1]', 'every privilege must be a document { resource, actions }'],
    ['an array with null', '[null]', 'every privilege must be a document { resource, actions }'],
    ['an array of arrays', '[[]]', 'every privilege must be a document { resource, actions }'],
    [
      'an array with an EJSON value',
      '[{"$numberInt":"1"}]',
      'every privilege must be a document { resource, actions }',
    ],
  ])('refuses %s', (_what, text, message) => {
    expect(invalid(() => parsePrivileges(text)).message).toBe(message);
  });

  it('refuses text that is not EJSON', () => {
    expect(invalid(() => parsePrivileges('[{')).message).toMatch(/^privileges is not valid EJSON/);
  });
});
