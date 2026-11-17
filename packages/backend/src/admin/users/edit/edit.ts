import type { ParsedParamsOf, ResultOf } from '@thicket/contract';
import type { Document } from 'mongodb';

import { runCommand } from '../../../browse/browse';
import type { ClientLike } from '../../../connections/manager';
import { parseDocument, parseEjson } from '../../../docs/query/query';
import { RpcError } from '../../../server/rpc';

/**
 * Changes to users and roles (SPEC M6 "Could"): create, update and drop users and roles, grant and
 * revoke roles. Each runs one user-management command on the primary in `db`; server errors become
 * `toBrowseError`s (`SERVER_ERROR` with the server's code, e.g. 51003 "User already exists",
 * 11 `UserNotFound`, 31 `RoleNotFound`). The handlers sit behind the write guard. A password goes to
 * the server once and is never returned or put into an error message.
 */

/** The user and role changes. */
export type EditMethod =
  | 'admin.createUser'
  | 'admin.updateUser'
  | 'admin.dropUser'
  | 'admin.createRole'
  | 'admin.updateRole'
  | 'admin.dropRole'
  | 'admin.grantRoles'
  | 'admin.revokeRoles';

/** The methods `editUsers` serves. */
export const EDIT_METHODS: readonly EditMethod[] = [
  'admin.createUser',
  'admin.updateUser',
  'admin.dropUser',
  'admin.createRole',
  'admin.updateRole',
  'admin.dropRole',
  'admin.grantRoles',
  'admin.revokeRoles',
];

/** The database of external users (LDAP, X.509, Kerberos, AWS): they have no password. */
export const EXTERNAL_DB = '$external';

function roleList(roles: readonly { role: string; db: string }[]): Document[] {
  return roles.map(({ role, db }) => ({ role, db }));
}

/** Parses the `privileges` param: canonical EJSON text of an array of `{ resource, actions }`. */
export function parsePrivileges(text: string): Document[] {
  const value = parseEjson(text, 'privileges');
  if (!Array.isArray(value)) throw new RpcError('INVALID_PARAMS', 'privileges must be an array');
  for (const entry of value) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      Array.isArray(entry) ||
      Object.getPrototypeOf(entry) !== Object.prototype
    ) {
      throw new RpcError(
        'INVALID_PARAMS',
        'every privilege must be a document { resource, actions }',
      );
    }
  }
  return value as Document[];
}

function password(command: Document, db: string, value: string | undefined): void {
  if (value === undefined) return;
  if (db === EXTERNAL_DB) {
    throw new RpcError('INVALID_PARAMS', 'users of $external have no password');
  }
  command['pwd'] = value;
}

/**
 * The server command of a user or role change (the params without `profileId`/`confirmed`).
 * Throws `INVALID_PARAMS` for params the server would misread: a new user outside `$external`
 * without a password, a password for `$external`, an update that changes nothing, privileges
 * that are not documents, custom data that is not a document.
 */
export function editCommand<M extends EditMethod>(method: M, params: ParsedParamsOf<M>): Document {
  switch (method as EditMethod) {
    case 'admin.createUser': {
      const p = params as ParsedParamsOf<'admin.createUser'>;
      const command: Document = { createUser: p.user };
      if (p.db !== EXTERNAL_DB && p.password === undefined) {
        throw new RpcError('INVALID_PARAMS', 'a new user needs a password');
      }
      password(command, p.db, p.password);
      command['roles'] = roleList(p.roles);
      if (p.customData !== undefined) {
        command['customData'] = parseDocument(p.customData, 'customData');
      }
      return command;
    }
    case 'admin.updateUser': {
      const p = params as ParsedParamsOf<'admin.updateUser'>;
      const command: Document = { updateUser: p.user };
      password(command, p.db, p.password);
      if (p.roles !== undefined) command['roles'] = roleList(p.roles);
      if (p.customData !== undefined) {
        command['customData'] = parseDocument(p.customData, 'customData');
      }
      if (Object.keys(command).length === 1) {
        throw new RpcError(
          'INVALID_PARAMS',
          'nothing to change: give a password, roles or customData',
        );
      }
      return command;
    }
    case 'admin.dropUser':
      return { dropUser: (params as ParsedParamsOf<'admin.dropUser'>).user };
    case 'admin.createRole': {
      const p = params as ParsedParamsOf<'admin.createRole'>;
      return {
        createRole: p.role,
        privileges: parsePrivileges(p.privileges),
        roles: roleList(p.roles),
      };
    }
    case 'admin.updateRole': {
      const p = params as ParsedParamsOf<'admin.updateRole'>;
      const command: Document = { updateRole: p.role };
      if (p.privileges !== undefined) command['privileges'] = parsePrivileges(p.privileges);
      if (p.roles !== undefined) command['roles'] = roleList(p.roles);
      if (Object.keys(command).length === 1) {
        throw new RpcError('INVALID_PARAMS', 'nothing to change: give privileges or roles');
      }
      return command;
    }
    case 'admin.dropRole':
      return { dropRole: (params as ParsedParamsOf<'admin.dropRole'>).role };
    case 'admin.grantRoles': {
      const p = params as ParsedParamsOf<'admin.grantRoles'>;
      const name = p.kind === 'user' ? 'grantRolesToUser' : 'grantRolesToRole';
      return { [name]: p.name, roles: roleList(p.roles) };
    }
    case 'admin.revokeRoles': {
      const p = params as ParsedParamsOf<'admin.revokeRoles'>;
      const name = p.kind === 'user' ? 'revokeRolesFromUser' : 'revokeRolesFromRole';
      return { [name]: p.name, roles: roleList(p.roles) };
    }
  }
}

/** Runs the change `method` with `params` in `params.db` on `client`. */
export async function editUsers<M extends EditMethod>(
  client: ClientLike,
  method: M,
  params: ParsedParamsOf<M>,
): Promise<ResultOf<M>> {
  await runCommand(client, params.db, editCommand(method, params));
  return {} as ResultOf<M>;
}
