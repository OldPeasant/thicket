import { z } from 'zod';

import {
  collName,
  dbName,
  ejsonArray,
  ejsonDocument,
  ejsonValue,
  emptyResult,
  profileId,
  streamResult,
  writeFields,
} from './common';
import { defineMethods } from './define';

/** A role as the server names it: `{ role, db }`. */
export const roleRef = z.strictObject({
  role: z.string().min(1, { message: 'role must be a non-empty role name' }),
  db: dbName,
});

/** Name of a user or role. */
const principal = z.string().min(1, { message: 'must be a non-empty name' });

/** Where a role is granted or revoked: a user or a role of `db`. */
const grantTarget = {
  ...writeFields,
  db: dbName,
  /** Grant to (revoke from) a user or a role. */
  kind: z.enum(['user', 'role']),
  /** Name of that user or role in `db`. */
  name: principal,
  roles: z.array(roleRef).min(1, { message: 'name at least one role' }),
};

export const adminMethods = defineMethods({
  'admin.currentOp': {
    summary: 'Running operations',
    route: 'backend',
    params: z.strictObject({
      profileId,
      /** Namespace prefix, e.g. `shop` or `shop.orders`. */
      ns: z.string().optional(),
      minSecsRunning: z.number().nonnegative().optional(),
      opType: z.string().optional(),
      /** Include idle connections and system operations. */
      all: z.boolean().optional(),
    }),
    result: z.object({ ops: z.array(ejsonDocument('operation')) }),
  },
  'admin.killOp': {
    summary: 'Kill an operation',
    route: 'backend',
    write: 'always',
    params: z.strictObject({
      ...writeFields,
      /** `opid` as reported by currentOp (number, or `"shard:opid"` string on mongos). */
      opId: ejsonValue('opid'),
    }),
    result: emptyResult,
  },
  'admin.users': {
    summary: 'Users of a database (usersInfo), with privileges',
    route: 'backend',
    params: z.strictObject({ profileId, db: dbName }),
    result: z.object({ users: z.array(ejsonDocument('user')) }),
  },
  'admin.roles': {
    summary: 'Roles of a database (rolesInfo), with privileges and inherited roles',
    route: 'backend',
    params: z.strictObject({ profileId, db: dbName, builtin: z.boolean().optional() }),
    result: z.object({ roles: z.array(ejsonDocument('role')) }),
  },
  'admin.createUser': {
    summary: 'Create a user (createUser)',
    route: 'backend',
    write: 'always',
    params: z.strictObject({
      ...writeFields,
      db: dbName,
      user: principal,
      /** The new user's password; not needed for users of `$external`. */
      password: z.string().min(1).optional(),
      roles: z.array(roleRef),
      customData: ejsonDocument('customData').optional(),
    }),
    result: emptyResult,
  },
  'admin.updateUser': {
    summary: 'Change a user: password, roles (replaced), custom data (updateUser)',
    route: 'backend',
    write: 'always',
    params: z.strictObject({
      ...writeFields,
      db: dbName,
      user: principal,
      password: z.string().min(1).optional(),
      roles: z.array(roleRef).optional(),
      customData: ejsonDocument('customData').optional(),
    }),
    result: emptyResult,
  },
  'admin.dropUser': {
    summary: 'Drop a user (dropUser)',
    route: 'backend',
    write: 'always',
    params: z.strictObject({ ...writeFields, db: dbName, user: principal }),
    result: emptyResult,
  },
  'admin.createRole': {
    summary: 'Create a role (createRole)',
    route: 'backend',
    write: 'always',
    params: z.strictObject({
      ...writeFields,
      db: dbName,
      role: principal,
      /** `[{ resource, actions }, …]`. */
      privileges: ejsonArray('privileges'),
      roles: z.array(roleRef),
    }),
    result: emptyResult,
  },
  'admin.updateRole': {
    summary: 'Change a role: privileges and inherited roles, each replaced (updateRole)',
    route: 'backend',
    write: 'always',
    params: z.strictObject({
      ...writeFields,
      db: dbName,
      role: principal,
      privileges: ejsonArray('privileges').optional(),
      roles: z.array(roleRef).optional(),
    }),
    result: emptyResult,
  },
  'admin.dropRole': {
    summary: 'Drop a role (dropRole)',
    route: 'backend',
    write: 'always',
    params: z.strictObject({ ...writeFields, db: dbName, role: principal }),
    result: emptyResult,
  },
  'admin.grantRoles': {
    summary: 'Grant roles to a user or role (grantRolesToUser / grantRolesToRole)',
    route: 'backend',
    write: 'always',
    params: z.strictObject(grantTarget),
    result: emptyResult,
  },
  'admin.revokeRoles': {
    summary: 'Revoke roles from a user or role (revokeRolesFromUser / revokeRolesFromRole)',
    route: 'backend',
    write: 'always',
    params: z.strictObject(grantTarget),
    result: emptyResult,
  },
  'admin.serverStatus': {
    summary: 'serverStatus output',
    route: 'backend',
    params: z.strictObject({ profileId }),
    result: z.object({ status: ejsonDocument('serverStatus output') }),
  },
  'admin.replSetStatus': {
    summary: 'replSetGetStatus output; null when the server is not a replica set member',
    route: 'backend',
    params: z.strictObject({ profileId }),
    result: z.object({ status: ejsonDocument('replSetGetStatus output').nullable() }),
  },
  'admin.watch': {
    summary: 'Watch a deployment, database or collection; change events arrive on the stream',
    route: 'backend',
    params: z.strictObject({
      profileId,
      db: dbName.optional(),
      coll: collName.optional(),
      pipeline: ejsonArray('pipeline').optional(),
      fullDocument: z.enum(['default', 'updateLookup', 'whenAvailable', 'required']).optional(),
    }),
    result: streamResult,
    stream: z.object({ event: ejsonDocument('change event') }),
  },
});
