import { parseEJson, parseEJsonDocument } from '@thicket/core/bson';
import { printShellSyntax } from '@thicket/core/shellsyntax';

/**
 * Users and roles as the `admin.users` / `admin.roles` answers describe them (canonical EJSON
 * text of `usersInfo` / `rolesInfo` entries), reduced to what the read-only view shows.
 */

/** A role grant: `role` defined in `db`. */
export interface RoleRef {
  readonly role: string;
  readonly db: string;
}

/** One privilege: a resource and the actions allowed on it. */
export interface Privilege {
  /** Readable resource: `cluster`, `any resource`, `shop.orders`, `shop.*`, `*.orders`, `*.*`. */
  readonly resource: string;
  readonly actions: readonly string[];
}

export interface UserEntry {
  readonly name: string;
  readonly db: string;
  /** Roles granted directly. */
  readonly roles: readonly RoleRef[];
  /** Roles held through the direct ones (the direct roles excluded). */
  readonly inheritedRoles: readonly RoleRef[];
  /** Every privilege the user holds (direct and inherited roles together). */
  readonly privileges: readonly Privilege[];
  readonly mechanisms: readonly string[];
  /** `customData` in shell syntax, if set. */
  readonly customData: string | null;
  /** Number of authentication restriction entries. */
  readonly restrictions: number;
}

export interface RoleEntry {
  readonly name: string;
  readonly db: string;
  readonly builtin: boolean;
  /** Roles this role inherits from directly. */
  readonly roles: readonly RoleRef[];
  /** Roles held through the direct ones (the direct roles excluded). */
  readonly inheritedRoles: readonly RoleRef[];
  /** Privileges granted by this role itself. */
  readonly privileges: readonly Privilege[];
  /** Every privilege of the role, its own and inherited ones. */
  readonly allPrivileges: readonly Privilege[];
  /** The role's own privileges as the server lists them, in shell syntax (for editing). */
  readonly privilegesSource: string;
}

type Json = Record<string, unknown>;

function parse(text: string): Json {
  const value: unknown = JSON.parse(text);
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function list(value: unknown): Json[] {
  return Array.isArray(value)
    ? value.filter((v): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v))
    : [];
}

export function roleKey(ref: RoleRef): string {
  return `${ref.role}@${ref.db}`;
}

function compareRefs(a: RoleRef, b: RoleRef): number {
  return a.role.localeCompare(b.role) || a.db.localeCompare(b.db);
}

function roleRefs(value: unknown): RoleRef[] {
  return list(value)
    .map((r) => ({ role: str(r['role']), db: str(r['db']) }))
    .filter((r) => r.role.length > 0);
}

/** Roles of `inherited` that are not in `direct`, sorted. */
function onlyInherited(inherited: RoleRef[], direct: RoleRef[]): RoleRef[] {
  const directKeys = new Set(direct.map(roleKey));
  return inherited.filter((r) => !directKeys.has(roleKey(r))).sort(compareRefs);
}

/** A privilege resource document as readable text. */
export function resourceLabel(resource: unknown): string {
  if (typeof resource !== 'object' || resource === null) return 'unknown resource';
  const r = resource as Json;
  if (r['cluster'] === true) return 'cluster';
  if (r['anyResource'] === true) return 'any resource';
  const db = str(r['db']) || '*';
  if (typeof r['system_buckets'] === 'string') {
    return `${db}.system.buckets.${r['system_buckets'] || '*'}`;
  }
  const coll = str(r['collection']) || '*';
  return `${db}.${coll}`;
}

/** Privileges sorted by resource (cluster first), actions sorted. */
function privileges(value: unknown): Privilege[] {
  const rank = (label: string) => (label === 'cluster' ? 0 : label === 'any resource' ? 1 : 2);
  return list(value)
    .map((p) => ({
      resource: resourceLabel(p['resource']),
      actions: (Array.isArray(p['actions']) ? p['actions'] : [])
        .filter((a): a is string => typeof a === 'string')
        .sort(),
    }))
    .sort((a, b) => rank(a.resource) - rank(b.resource) || a.resource.localeCompare(b.resource));
}

/** The `privileges` array of a role in shell syntax (`[]` when missing). */
function privilegesSource(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return '[]';
  try {
    return printShellSyntax(parseEJson(JSON.stringify(value)), { indent: 2 });
  } catch {
    return '[]';
  }
}

function customData(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  try {
    return printShellSyntax(parseEJsonDocument(JSON.stringify(value)), { indent: 2 });
  } catch {
    return null;
  }
}

/** One `admin.users` entry. */
export function toUserEntry(text: string): UserEntry {
  const doc = parse(text);
  const roles = roleRefs(doc['roles']).sort(compareRefs);
  return {
    name: str(doc['user']),
    db: str(doc['db']),
    roles,
    inheritedRoles: onlyInherited(roleRefs(doc['inheritedRoles']), roles),
    privileges: privileges(doc['inheritedPrivileges']),
    mechanisms: (Array.isArray(doc['mechanisms']) ? doc['mechanisms'] : []).filter(
      (m): m is string => typeof m === 'string',
    ),
    customData: customData(doc['customData']),
    restrictions: list(doc['authenticationRestrictions']).length,
  };
}

/** One `admin.roles` entry. */
export function toRoleEntry(text: string): RoleEntry {
  const doc = parse(text);
  const roles = roleRefs(doc['roles']).sort(compareRefs);
  return {
    name: str(doc['role']),
    db: str(doc['db']),
    builtin: doc['isBuiltin'] === true,
    roles,
    inheritedRoles: onlyInherited(roleRefs(doc['inheritedRoles']), roles),
    privileges: privileges(doc['privileges']),
    allPrivileges: privileges(doc['inheritedPrivileges']),
    privilegesSource: privilegesSource(doc['privileges']),
  };
}
