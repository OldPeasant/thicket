import type { ResultOf } from '@thicket/contract';

import type { Document } from 'mongodb';

import { canonical, runCommand } from '../../browse/browse';
import type { ClientLike } from '../../connections/manager';

/**
 * Users and roles of one database (`admin.users`, `admin.roles`), read-only: `usersInfo` and
 * `rolesInfo` with their privileges and inherited roles. Server errors become `toBrowseError`s
 * (a user without `viewUser`/`viewRole` gets `SERVER_ERROR` with the server's `Unauthorized`).
 */

/** Fields never sent to the renderer, even if a server answered with them. */
const SECRET_FIELDS = new Set(['credentials']);

function withoutSecrets(doc: Document): Document {
  const copy: Document = {};
  for (const [key, value] of Object.entries(doc)) {
    if (!SECRET_FIELDS.has(key)) copy[key] = value;
  }
  return copy;
}

function byName(field: string) {
  return (a: Document, b: Document): number => {
    const x = String(a[field] ?? '');
    const y = String(b[field] ?? '');
    return x < y ? -1 : x > y ? 1 : 0;
  };
}

function entries(answer: Document, field: string): Document[] {
  const list = answer[field];
  return Array.isArray(list) ? (list as Document[]) : [];
}

/**
 * `admin.users`: the users defined in `db`, sorted by name, each with its roles, inherited roles
 * and privileges. The server gives privileges only for exact-match queries, so the names come
 * first (`usersInfo: 1`) and the details second (`usersInfo: [{ user, db }, …]` with
 * `showPrivileges` and `showAuthenticationRestrictions`, both off by default). Credentials are
 * never asked for (`showCredentials` stays off) and dropped if present.
 */
export async function listUsers(client: ClientLike, db: string): Promise<ResultOf<'admin.users'>> {
  const names = entries(await runCommand(client, db, { usersInfo: 1 }), 'users')
    .map((u) => u['user'])
    .filter((user): user is string => typeof user === 'string');
  if (names.length === 0) return { users: [] };
  const answer = await runCommand(client, db, {
    usersInfo: names.map((user) => ({ user, db })),
    showPrivileges: true,
    showAuthenticationRestrictions: true,
  });
  const users = entries(answer, 'users').map(withoutSecrets).sort(byName('user'));
  return { users: users.map(canonical) };
}

/**
 * `admin.roles`: the roles defined in `db`, sorted by name, with privileges, the roles they
 * inherit from directly (`roles`) and all inherited roles and privileges. `builtin` adds the
 * database's built-in roles.
 */
export async function listRoles(
  client: ClientLike,
  db: string,
  builtin = false,
): Promise<ResultOf<'admin.roles'>> {
  const answer = await runCommand(client, db, {
    rolesInfo: 1,
    showPrivileges: true,
    showBuiltinRoles: builtin,
  });
  const roles = entries(answer, 'roles').sort(byName('role'));
  return { roles: roles.map(canonical) };
}
