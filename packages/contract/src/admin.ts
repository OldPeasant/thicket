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
  'admin.serverStatus': {
    summary: 'serverStatus output',
    route: 'backend',
    params: z.strictObject({ profileId }),
    result: z.object({ status: ejsonDocument('serverStatus output') }),
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
