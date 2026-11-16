import { z } from 'zod';

import {
  collName,
  collTarget,
  dbName,
  dbTarget,
  ejsonDocument,
  emptyResult,
  writeFields,
} from './common';
import { defineMethods } from './define';

export const COLLECTION_TYPES = ['collection', 'view', 'timeseries'] as const;

export const collectionInfo = z.object({
  name: z.string(),
  type: z.enum(COLLECTION_TYPES),
  /** For views: the source collection. */
  viewOn: z.string().optional(),
  /** `listCollections` entry (options, info), for the details view. */
  raw: ejsonDocument('listCollections entry'),
});

export type CollectionInfo = z.infer<typeof collectionInfo>;

export const VALIDATION_LEVELS = ['off', 'strict', 'moderate'] as const;
export const VALIDATION_ACTIONS = ['error', 'warn', 'errorAndLog'] as const;

const validatorFields = {
  /** The validator document (usually `{"$jsonSchema": ...}`); `null` when there is none. */
  validator: ejsonDocument('validator').nullable(),
  validationLevel: z.enum(VALIDATION_LEVELS),
  validationAction: z.enum(VALIDATION_ACTIONS),
};

const collWrite = { ...writeFields, db: dbName, coll: collName };

export const collMethods = defineMethods({
  'coll.list': {
    summary: 'List collections, views and time series of a database',
    route: 'backend',
    params: z.strictObject({ ...dbTarget }),
    result: z.object({ collections: z.array(collectionInfo) }),
  },
  'coll.create': {
    summary: 'Create a collection (options: capped, timeseries, validator, collation, ...)',
    route: 'backend',
    write: 'always',
    params: z.strictObject({ ...collWrite, options: ejsonDocument('create options').optional() }),
    result: emptyResult,
  },
  'coll.drop': {
    summary: 'Drop a collection or view',
    route: 'backend',
    write: 'always',
    params: z.strictObject({ ...collWrite }),
    result: emptyResult,
  },
  'coll.rename': {
    summary: 'Rename a collection within its database',
    route: 'backend',
    write: 'always',
    params: z.strictObject({
      ...collWrite,
      newName: collName,
      dropTarget: z.boolean().optional(),
    }),
    result: emptyResult,
  },
  'coll.stats': {
    summary: 'Document count and sizes of a collection',
    route: 'backend',
    params: z.strictObject({ ...collTarget }),
    result: z.object({
      count: z.number().nonnegative(),
      size: z.number().nonnegative(),
      storageSize: z.number().nonnegative(),
      totalIndexSize: z.number().nonnegative(),
      nindexes: z.number().int().nonnegative(),
      raw: ejsonDocument('collection stats'),
    }),
  },
  'coll.validator.get': {
    summary: 'Validator, validation level and action of a collection',
    route: 'backend',
    params: z.strictObject({ ...collTarget }),
    result: z.object(validatorFields),
  },
  'coll.validator.set': {
    summary: 'Change validator, validation level and action (collMod)',
    route: 'backend',
    write: 'always',
    params: z.strictObject({ ...collWrite, ...validatorFields }),
    result: emptyResult,
  },
});
