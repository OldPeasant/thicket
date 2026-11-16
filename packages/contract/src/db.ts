import { z } from 'zod';

import {
  collName,
  dbTarget,
  ejsonDocument,
  emptyResult,
  profileId,
  writeFields,
  dbName,
} from './common';
import { defineMethods } from './define';

export const databaseInfo = z.object({
  name: z.string(),
  sizeOnDisk: z.number().nonnegative().optional(),
  empty: z.boolean().optional(),
});

export type DatabaseInfo = z.infer<typeof databaseInfo>;

export const dbMethods = defineMethods({
  'db.listDatabases': {
    summary: 'List databases (names only unless `withSizes`)',
    route: 'backend',
    params: z.strictObject({ profileId, withSizes: z.boolean().optional() }),
    result: z.object({ databases: z.array(databaseInfo) }),
  },
  'db.create': {
    summary: 'Create a database by creating its first collection',
    route: 'backend',
    write: 'always',
    params: z.strictObject({ ...writeFields, db: dbName, firstCollection: collName }),
    result: emptyResult,
  },
  'db.drop': {
    summary: 'Drop a database',
    route: 'backend',
    write: 'always',
    params: z.strictObject({ ...writeFields, db: dbName }),
    result: emptyResult,
  },
  'db.stats': {
    summary: 'dbStats of a database',
    route: 'backend',
    params: z.strictObject({ ...dbTarget }),
    result: z.object({
      collections: z.number().int().nonnegative(),
      views: z.number().int().nonnegative(),
      objects: z.number().nonnegative(),
      dataSize: z.number().nonnegative(),
      storageSize: z.number().nonnegative(),
      indexSize: z.number().nonnegative(),
      raw: ejsonDocument('dbStats output'),
    }),
  },
});
