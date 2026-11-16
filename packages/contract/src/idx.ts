import { z } from 'zod';

import {
  collName,
  collTarget,
  count,
  dbName,
  ejsonDocument,
  emptyResult,
  writeFields,
} from './common';
import { defineMethods } from './define';

export const indexInfo = z.object({
  name: z.string(),
  /** Key pattern, e.g. `{"a":1,"b":-1}` or `{"loc":"2dsphere"}`. */
  key: ejsonDocument('index key'),
  unique: z.boolean(),
  sparse: z.boolean(),
  hidden: z.boolean(),
  expireAfterSeconds: z.number().int().nonnegative().optional(),
  partialFilterExpression: ejsonDocument('partial filter').optional(),
  /** Full `listIndexes` entry. */
  raw: ejsonDocument('index spec'),
});

export type IndexInfo = z.infer<typeof indexInfo>;

export const indexStats = z.object({
  name: z.string(),
  sizeBytes: z.number().nonnegative(),
  /** `$indexStats` accesses.ops; absent where `$indexStats` is not allowed. */
  accesses: count.optional(),
  /** ISO date since when accesses are counted. */
  since: z.string().optional(),
});

export type IndexStats = z.infer<typeof indexStats>;

const collWrite = { ...writeFields, db: dbName, coll: collName };

export const idxMethods = defineMethods({
  'idx.list': {
    summary: 'List the indexes of a collection',
    route: 'backend',
    params: z.strictObject({ ...collTarget }),
    result: z.object({ indexes: z.array(indexInfo) }),
  },
  'idx.stats': {
    summary: 'Size and usage of each index',
    route: 'backend',
    params: z.strictObject({ ...collTarget }),
    result: z.object({ indexes: z.array(indexStats) }),
  },
  'idx.create': {
    summary: 'Create an index',
    route: 'backend',
    write: 'always',
    params: z.strictObject({
      ...collWrite,
      key: ejsonDocument('index key'),
      /**
       * createIndexes options: name, unique, sparse, partialFilterExpression,
       * expireAfterSeconds, collation, hidden, weights, default_language, 2dsphereIndexVersion,
       * wildcardProjection, ...
       */
      options: ejsonDocument('index options').optional(),
    }),
    result: z.object({ name: z.string() }),
  },
  'idx.drop': {
    summary: 'Drop an index by name',
    route: 'backend',
    write: 'always',
    params: z.strictObject({ ...collWrite, name: z.string().min(1) }),
    result: emptyResult,
  },
  'idx.hide': {
    summary: 'Hide or unhide an index',
    route: 'backend',
    write: 'always',
    params: z.strictObject({ ...collWrite, name: z.string().min(1), hidden: z.boolean() }),
    result: emptyResult,
  },
});
