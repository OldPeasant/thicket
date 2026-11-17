import { describe, expect, it } from 'vitest';

import { resourceLabel, roleKey, toRoleEntry, toUserEntry } from './users-roles.model';

describe('resourceLabel', () => {
  it('names the cluster and any-resource privileges', () => {
    expect(resourceLabel({ cluster: true })).toBe('cluster');
    expect(resourceLabel({ anyResource: true })).toBe('any resource');
  });

  it('only treats a true flag as cluster or any resource', () => {
    expect(resourceLabel({ cluster: false, db: 'shop', collection: 'orders' })).toBe('shop.orders');
    expect(resourceLabel({ anyResource: 'yes', db: 'shop', collection: '' })).toBe('shop.*');
  });

  it('writes db.collection with * for an empty database or collection', () => {
    expect(resourceLabel({ db: 'shop', collection: 'orders' })).toBe('shop.orders');
    expect(resourceLabel({ db: 'shop', collection: '' })).toBe('shop.*');
    expect(resourceLabel({ db: '', collection: 'orders' })).toBe('*.orders');
    expect(resourceLabel({ db: '', collection: '' })).toBe('*.*');
  });

  it('labels system buckets of time series collections', () => {
    expect(resourceLabel({ db: 'shop', system_buckets: 'ticks' })).toBe(
      'shop.system.buckets.ticks',
    );
    expect(resourceLabel({ db: 'shop', system_buckets: '' })).toBe('shop.system.buckets.*');
    expect(resourceLabel({ db: '', system_buckets: 'ticks' })).toBe('*.system.buckets.ticks');
  });

  it('falls back on malformed resources', () => {
    expect(resourceLabel(null)).toBe('unknown resource');
    expect(resourceLabel(undefined)).toBe('unknown resource');
    expect(resourceLabel('shop.orders')).toBe('unknown resource');
    expect(resourceLabel(42)).toBe('unknown resource');
    // Missing or non-string fields read as wildcards rather than throwing.
    expect(resourceLabel({})).toBe('*.*');
    expect(resourceLabel({ db: 7, collection: ['orders'] })).toBe('*.*');
  });
});

describe('roleKey', () => {
  it('joins role and database', () => {
    expect(roleKey({ role: 'clerk', db: 'shop' })).toBe('clerk@shop');
  });
});

describe('toUserEntry', () => {
  it('reduces a usersInfo entry: sorted roles, inherited-only roles, sorted privileges', () => {
    const entry = toUserEntry(
      JSON.stringify({
        _id: 'shop.alice',
        user: 'alice',
        db: 'shop',
        mechanisms: ['SCRAM-SHA-1', 'SCRAM-SHA-256'],
        customData: { team: 'sales' },
        authenticationRestrictions: [{ clientSource: ['192.0.2.1'] }, { serverAddress: [] }],
        roles: [
          { role: 'reader', db: 'shop' },
          { role: 'clerk', db: 'shop' },
          { role: 'clerk', db: 'archive' },
        ],
        inheritedRoles: [
          { role: 'reader', db: 'shop' },
          { role: 'read', db: 'shop' },
          { role: 'clerk', db: 'shop' },
          { role: 'clerk', db: 'archive' },
        ],
        inheritedPrivileges: [
          { resource: { db: 'shop', collection: 'orders' }, actions: ['update', 'find'] },
          { resource: { anyResource: true }, actions: ['find'] },
          { resource: { db: 'archive', collection: '' }, actions: ['find'] },
          { resource: { cluster: true }, actions: ['serverStatus'] },
        ],
      }),
    );
    expect(entry.customData).toContain('team: "sales"');
    expect({ ...entry, customData: null }).toEqual({
      name: 'alice',
      db: 'shop',
      roles: [
        { role: 'clerk', db: 'archive' },
        { role: 'clerk', db: 'shop' },
        { role: 'reader', db: 'shop' },
      ],
      inheritedRoles: [{ role: 'read', db: 'shop' }],
      privileges: [
        { resource: 'cluster', actions: ['serverStatus'] },
        { resource: 'any resource', actions: ['find'] },
        { resource: 'archive.*', actions: ['find'] },
        { resource: 'shop.orders', actions: ['find', 'update'] },
      ],
      mechanisms: ['SCRAM-SHA-1', 'SCRAM-SHA-256'],
      customData: null,
      restrictions: 2,
    });
  });

  it('gives empty values for missing fields', () => {
    expect(toUserEntry('{}')).toEqual({
      name: '',
      db: '',
      roles: [],
      inheritedRoles: [],
      privileges: [],
      mechanisms: [],
      customData: null,
      restrictions: 0,
    });
  });

  it('ignores malformed entries inside lists', () => {
    const entry = toUserEntry(
      JSON.stringify({
        user: 'bob',
        db: 'shop',
        roles: [null, 'read', ['x'], { db: 'shop' }, { role: 'reader', db: 3 }],
        mechanisms: ['SCRAM-SHA-256', 5, null],
        inheritedPrivileges: [
          { resource: null, actions: ['find', 1] },
          { resource: { db: 'shop', collection: 'orders' } },
          'oops',
        ],
        authenticationRestrictions: 'none',
        customData: ['not', 'an', 'object'],
      }),
    );
    expect(entry.roles).toEqual([{ role: 'reader', db: '' }]);
    expect(entry.mechanisms).toEqual(['SCRAM-SHA-256']);
    expect(entry.privileges).toEqual([
      { resource: 'shop.orders', actions: [] },
      { resource: 'unknown resource', actions: ['find'] },
    ]);
    expect(entry.restrictions).toBe(0);
    expect(entry.customData).toBeNull();
  });

  it('reads a JSON value that is not an object as an empty entry', () => {
    for (const text of ['null', '[1,2]', '"alice"', '3']) {
      expect(toUserEntry(text).name).toBe('');
    }
  });

  it('throws on text that is not JSON', () => {
    expect(() => toUserEntry('{not json')).toThrow();
  });

  it('prints EJSON custom data in shell syntax', () => {
    const entry = toUserEntry(
      JSON.stringify({ user: 'carol', db: 'shop', customData: { level: { $numberInt: '3' } } }),
    );
    expect(entry.customData).toContain('level: 3');
  });

  it('gives no custom data when it is not valid EJSON', () => {
    const entry = toUserEntry(
      JSON.stringify({ user: 'carol', db: 'shop', customData: { since: { $date: 'never' } } }),
    );
    expect(entry.customData).toBeNull();
  });
});

describe('toRoleEntry', () => {
  it('reduces a rolesInfo entry: own and all privileges, inherited-only roles', () => {
    const entry = toRoleEntry(
      JSON.stringify({
        role: 'clerk',
        db: 'shop',
        isBuiltin: false,
        roles: [
          { role: 'reader', db: 'shop' },
          { role: 'read', db: 'shop' },
        ],
        inheritedRoles: [
          { role: 'reader', db: 'shop' },
          { role: 'read', db: 'shop' },
          { role: 'base', db: 'shop' },
        ],
        privileges: [
          { resource: { db: 'shop', collection: 'orders' }, actions: ['update', 'insert'] },
        ],
        inheritedPrivileges: [
          { resource: { db: 'shop', collection: 'orders' }, actions: ['update', 'insert', 'find'] },
          { resource: { db: 'shop', system_buckets: 'ticks' }, actions: ['find'] },
          { resource: { db: 'shop', collection: '' }, actions: ['listCollections'] },
        ],
      }),
    );
    expect(entry).toEqual({
      name: 'clerk',
      db: 'shop',
      builtin: false,
      roles: [
        { role: 'read', db: 'shop' },
        { role: 'reader', db: 'shop' },
      ],
      inheritedRoles: [{ role: 'base', db: 'shop' }],
      privileges: [{ resource: 'shop.orders', actions: ['insert', 'update'] }],
      allPrivileges: [
        { resource: 'shop.*', actions: ['listCollections'] },
        { resource: 'shop.orders', actions: ['find', 'insert', 'update'] },
        { resource: 'shop.system.buckets.ticks', actions: ['find'] },
      ],
    });
  });

  it('marks only isBuiltin: true as built-in', () => {
    expect(toRoleEntry(JSON.stringify({ role: 'read', db: 'shop', isBuiltin: true })).builtin).toBe(
      true,
    );
    expect(
      toRoleEntry(JSON.stringify({ role: 'read', db: 'shop', isBuiltin: 'true' })).builtin,
    ).toBe(false);
  });

  it('gives empty values for missing fields', () => {
    expect(toRoleEntry('{}')).toEqual({
      name: '',
      db: '',
      builtin: false,
      roles: [],
      inheritedRoles: [],
      privileges: [],
      allPrivileges: [],
    });
  });
});
