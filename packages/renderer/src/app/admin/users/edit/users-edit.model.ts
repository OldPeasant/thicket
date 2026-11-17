import { stringifyEJson, type BsonValue } from '@thicket/core/bson';
import { parseShellSyntax } from '@thicket/core/shellsyntax';

import { roleKey, type RoleRef } from '../users-roles.model';

/**
 * Pure helpers of the user and role editor (SPEC M6 "Could"): reading what the user typed (role
 * names, privileges and custom data in shell syntax) into what the `admin.*` writes send.
 */

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** Built-in roles every database has. */
export const DATABASE_ROLES: readonly string[] = [
  'read',
  'readWrite',
  'dbAdmin',
  'dbOwner',
  'userAdmin',
];

/** Built-in roles that exist only in `admin`. */
export const ADMIN_ROLES: readonly string[] = [
  'backup',
  'clusterAdmin',
  'clusterManager',
  'clusterMonitor',
  'dbAdminAnyDatabase',
  'hostManager',
  'readAnyDatabase',
  'readWriteAnyDatabase',
  'restore',
  'root',
  'userAdminAnyDatabase',
];

/**
 * A role as typed: `name` (a role of `db`) or `name@other` (a role of another database, e.g.
 * `readAnyDatabase@admin`). The last `@` separates the database, so role names with `@` need it.
 */
export function parseRoleRef(text: string, db: string): Parsed<RoleRef> {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, error: 'Type a role name' };
  const at = trimmed.lastIndexOf('@');
  const role = (at === -1 ? trimmed : trimmed.slice(0, at)).trim();
  const roleDb = (at === -1 ? db : trimmed.slice(at + 1)).trim();
  if (role === '') return { ok: false, error: 'The role name is missing before "@"' };
  if (roleDb === '') return { ok: false, error: 'The database is missing after "@"' };
  return { ok: true, value: { role, db: roleDb } };
}

/** How a role is shown in the role field: `name` for roles of `db`, else `name@db`. */
export function roleText(ref: RoleRef, db: string): string {
  return ref.db === db ? ref.role : roleKey(ref);
}

/**
 * Role suggestions for the role field: the roles of `db` named in `known`, built-in roles.
 * `forRole` is set where a custom role gets the roles (its "Inherits from" list, a grant to it):
 * a role of a database other than `admin` can only inherit roles of its own database, so the
 * `admin` roles are not offered there.
 */
export function roleSuggestions(known: readonly string[], db: string, forRole = false): string[] {
  const local = new Set([...known, ...DATABASE_ROLES]);
  const names = [...local].sort((a, b) => a.localeCompare(b));
  if (db !== 'admin') {
    return forRole ? names : [...names, ...ADMIN_ROLES.map((r) => `${r}@admin`)];
  }
  return [...new Set([...names, ...ADMIN_ROLES])].sort((a, b) => a.localeCompare(b));
}

/** `list` with `ref` added (unchanged when it is already there). */
export function withRole(list: readonly RoleRef[], ref: RoleRef): RoleRef[] {
  return list.some((r) => roleKey(r) === roleKey(ref)) ? [...list] : [...list, ref];
}

/** `list` without `ref`. */
export function withoutRole(list: readonly RoleRef[], ref: RoleRef): RoleRef[] {
  return list.filter((r) => roleKey(r) !== roleKey(ref));
}

/** Whether two role lists hold the same roles (order ignored). */
export function sameRoles(a: readonly RoleRef[], b: readonly RoleRef[]): boolean {
  const keys = new Set(a.map(roleKey));
  return a.length === b.length && b.every((r) => keys.has(roleKey(r)));
}

function parse(text: string): Parsed<BsonValue> {
  try {
    return { ok: true, value: parseShellSyntax(text) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Privileges typed in shell syntax, `[{ resource: { db, collection }, actions: [...] }, …]`, as
 * the canonical EJSON text `admin.createRole` / `admin.updateRole` send. Empty text is no
 * privileges. Each entry must be a document with a `resource` document and an `actions` array.
 */
export function parsePrivileges(text: string): Parsed<string> {
  if (text.trim() === '') return { ok: true, value: '[]' };
  const parsed = parse(text);
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  if (value.type !== 'array') {
    return { ok: false, error: 'Privileges are a list: [{ resource: { … }, actions: [ … ] }]' };
  }
  for (const [n, item] of value.items.entries()) {
    const where = `Privilege ${n + 1}`;
    if (item.type !== 'object') return { ok: false, error: `${where} is not a document` };
    const resource = item.fields.find((f) => f.key === 'resource');
    const actions = item.fields.find((f) => f.key === 'actions');
    if (resource?.value.type !== 'object') {
      return { ok: false, error: `${where} needs a resource, e.g. { db: "shop", collection: "" }` };
    }
    if (actions?.value.type !== 'array') {
      return { ok: false, error: `${where} needs actions, e.g. ["find"]` };
    }
  }
  return { ok: true, value: stringifyEJson(value) };
}

/**
 * Custom data typed in shell syntax as canonical EJSON text; empty text is `null` (none).
 */
export function parseCustomData(text: string): Parsed<string | null> {
  if (text.trim() === '') return { ok: true, value: null };
  const parsed = parse(text);
  if (!parsed.ok) return parsed;
  if (parsed.value.type !== 'object') {
    return { ok: false, error: 'Custom data is a document: { team: "sales" }' };
  }
  return { ok: true, value: stringifyEJson(parsed.value) };
}
