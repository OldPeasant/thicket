import { describe, expect, it } from 'vitest';

import {
  ADMIN_ROLES,
  DATABASE_ROLES,
  parseCustomData,
  parsePrivileges,
  parseRoleRef,
  roleSuggestions,
  roleText,
  sameRoles,
  withRole,
  withoutRole,
} from './users-edit.model';

const READ = { role: 'read', db: 'shop' };
const CLERK = { role: 'clerk', db: 'shop' };
const ANY = { role: 'readAnyDatabase', db: 'admin' };

describe('parseRoleRef', () => {
  it('a plain name is a role of the database', () => {
    expect(parseRoleRef('clerk', 'shop')).toEqual({ ok: true, value: CLERK });
    expect(parseRoleRef('  clerk  ', 'shop')).toEqual({ ok: true, value: CLERK });
  });

  it('name@db names a role of another database', () => {
    expect(parseRoleRef('readAnyDatabase@admin', 'shop')).toEqual({ ok: true, value: ANY });
    expect(parseRoleRef(' read @ reports ', 'shop')).toEqual({
      ok: true,
      value: { role: 'read', db: 'reports' },
    });
  });

  it('the last @ separates the database, so role names may hold @', () => {
    expect(parseRoleRef('team@eu@shop', 'other')).toEqual({
      ok: true,
      value: { role: 'team@eu', db: 'shop' },
    });
  });

  it.each([
    ['', 'Type a role name'],
    ['   ', 'Type a role name'],
    ['@admin', 'The role name is missing before "@"'],
    [' @admin', 'The role name is missing before "@"'],
    ['read@', 'The database is missing after "@"'],
    ['read@  ', 'The database is missing after "@"'],
  ])('refuses %j', (text, error) => {
    expect(parseRoleRef(text, 'shop')).toEqual({ ok: false, error });
  });
});

describe('roleText', () => {
  it('shows roles of the database by name, others as name@db', () => {
    expect(roleText(CLERK, 'shop')).toBe('clerk');
    expect(roleText(ANY, 'shop')).toBe('readAnyDatabase@admin');
    expect(roleText(ANY, 'admin')).toBe('readAnyDatabase');
  });

  it('round-trips through parseRoleRef', () => {
    // roleText is a label; a local role name holding "@" must be typed as name@db (see above).
    for (const ref of [CLERK, ANY, { role: 'read', db: 'reports' }]) {
      expect(parseRoleRef(roleText(ref, 'shop'), 'shop')).toEqual({ ok: true, value: ref });
    }
  });
});

describe('roleSuggestions', () => {
  it('outside admin: known and database roles sorted, then the admin roles as name@admin', () => {
    const list = roleSuggestions(['clerk', 'auditor'], 'shop');
    const local = [...DATABASE_ROLES, 'clerk', 'auditor'].sort((a, b) => a.localeCompare(b));
    expect(list).toEqual([...local, ...ADMIN_ROLES.map((r) => `${r}@admin`)]);
  });

  it('a known role with the name of a built-in role is suggested once', () => {
    const list = roleSuggestions(['read'], 'shop');
    expect(list.filter((r) => r === 'read')).toHaveLength(1);
  });

  it('in admin: every role by its plain name, sorted, without duplicates', () => {
    const list = roleSuggestions(['root', 'ops'], 'admin');
    expect(list).toEqual(
      [...new Set([...DATABASE_ROLES, ...ADMIN_ROLES, 'ops'])].sort((a, b) => a.localeCompare(b)),
    );
    expect(list.some((r) => r.includes('@'))).toBe(false);
  });

  it('without known roles suggests the built-in ones', () => {
    expect(roleSuggestions([], 'shop')).toEqual([
      ...[...DATABASE_ROLES].sort((a, b) => a.localeCompare(b)),
      ...ADMIN_ROLES.map((r) => `${r}@admin`),
    ]);
  });
});

describe('withRole / withoutRole / sameRoles', () => {
  it('withRole appends a new role and keeps the list when it is there already', () => {
    const list = [READ];
    expect(withRole(list, CLERK)).toEqual([READ, CLERK]);
    const same = withRole(list, { role: 'read', db: 'shop' });
    expect(same).toEqual([READ]);
    expect(same).not.toBe(list);
    expect(list).toEqual([READ]);
  });

  it('a role of the same name in another database is another role', () => {
    expect(withRole([READ], { role: 'read', db: 'reports' })).toHaveLength(2);
  });

  it('withoutRole removes only that role', () => {
    expect(withoutRole([READ, CLERK, ANY], { role: 'clerk', db: 'shop' })).toEqual([READ, ANY]);
    expect(withoutRole([READ], { role: 'read', db: 'reports' })).toEqual([READ]);
    expect(withoutRole([], READ)).toEqual([]);
  });

  it('sameRoles ignores order', () => {
    expect(sameRoles([READ, CLERK], [CLERK, READ])).toBe(true);
    expect(sameRoles([], [])).toBe(true);
  });

  it('sameRoles sees added, removed and replaced roles', () => {
    expect(sameRoles([READ], [READ, CLERK])).toBe(false);
    expect(sameRoles([READ, CLERK], [READ])).toBe(false);
    expect(sameRoles([READ], [{ role: 'read', db: 'reports' }])).toBe(false);
    expect(sameRoles([], [READ])).toBe(false);
  });
});

describe('parsePrivileges', () => {
  it('empty text is no privileges', () => {
    expect(parsePrivileges('')).toEqual({ ok: true, value: '[]' });
    expect(parsePrivileges('  \n ')).toEqual({ ok: true, value: '[]' });
  });

  it('reads shell syntax into canonical EJSON text', () => {
    const parsed = parsePrivileges(
      '[{ resource: { db: "shop", collection: "orders" }, actions: ["find", "insert"] }]',
    );
    if (!parsed.ok) throw new Error(parsed.error);
    expect(JSON.parse(parsed.value)).toEqual([
      { resource: { db: 'shop', collection: 'orders' }, actions: ['find', 'insert'] },
    ]);
  });

  it('keeps cluster resources and BSON types canonical', () => {
    const parsed = parsePrivileges(
      '[{ resource: { cluster: true }, actions: ["serverStatus"], n: 1 }]',
    );
    if (!parsed.ok) throw new Error(parsed.error);
    expect(JSON.parse(parsed.value)).toEqual([
      { resource: { cluster: true }, actions: ['serverStatus'], n: { $numberInt: '1' } },
    ]);
  });

  it('an empty list is fine', () => {
    expect(parsePrivileges('[]')).toEqual({ ok: true, value: '[]' });
  });

  it.each([
    [
      'a document',
      '{ resource: {} }',
      'Privileges are a list: [{ resource: { … }, actions: [ … ] }]',
    ],
    ['a list with a number', '[1]', 'Privilege 1 is not a document'],
    [
      'an entry without resource',
      '[{ resource: { db: "a", collection: "" }, actions: [] }, { actions: ["find"] }]',
      'Privilege 2 needs a resource, e.g. { db: "shop", collection: "" }',
    ],
    [
      'a resource that is not a document',
      '[{ resource: "shop", actions: ["find"] }]',
      'Privilege 1 needs a resource, e.g. { db: "shop", collection: "" }',
    ],
    [
      'an entry without actions',
      '[{ resource: { db: "shop", collection: "" } }]',
      'Privilege 1 needs actions, e.g. ["find"]',
    ],
    [
      'actions that are not a list',
      '[{ resource: { db: "shop", collection: "" }, actions: "find" }]',
      'Privilege 1 needs actions, e.g. ["find"]',
    ],
  ])('refuses %s', (_what, text, error) => {
    expect(parsePrivileges(text)).toEqual({ ok: false, error });
  });

  it('reports a syntax error with its position', () => {
    const parsed = parsePrivileges('[{ resource: ');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/line 1, column \d+/);
  });

  it('refuses code: functions are never evaluated', () => {
    expect(parsePrivileges('[function () { return 1 }]').ok).toBe(false);
  });
});

describe('parseCustomData', () => {
  it('empty text is no custom data', () => {
    expect(parseCustomData('')).toEqual({ ok: true, value: null });
    expect(parseCustomData('   ')).toEqual({ ok: true, value: null });
  });

  it('reads a document in shell syntax into canonical EJSON text', () => {
    const parsed = parseCustomData(
      '{ team: "sales", level: 3, since: ISODate("2025-01-02T00:00:00Z") }',
    );
    if (!parsed.ok) throw new Error(parsed.error);
    expect(JSON.parse(parsed.value ?? '')).toEqual({
      team: 'sales',
      level: { $numberInt: '3' },
      since: { $date: { $numberLong: '1735776000000' } },
    });
  });

  it('an empty document stays a document', () => {
    expect(parseCustomData('{}')).toEqual({ ok: true, value: '{}' });
  });

  it.each([['[1]'], ['"sales"'], ['3']])('refuses %s: not a document', (text) => {
    expect(parseCustomData(text)).toEqual({
      ok: false,
      error: 'Custom data is a document: { team: "sales" }',
    });
  });

  it('reports a syntax error', () => {
    const parsed = parseCustomData('{ team: ');
    expect(parsed.ok).toBe(false);
  });
});
