import { z } from 'zod';

import {
  collName,
  collTarget,
  count,
  dbName,
  ejsonArray,
  ejsonDocument,
  ejsonDocumentOrArray,
  ejsonValue,
  maxTimeMS,
  streamResult,
  writeFields,
} from './common';
import { defineMethods } from './define';

/** Query parts entered in the query bar, each as EJSON text. */
export const queryFields = {
  filter: ejsonDocument('filter'),
  projection: ejsonDocument('projection').optional(),
  sort: ejsonDocument('sort').optional(),
  collation: ejsonDocument('collation').optional(),
  hint: ejsonValue('hint').optional(),
  maxTimeMS,
};

/** One page of documents on a `docs.find` / `agg.run` stream. */
export const docsBatch = z.object({ docs: z.array(ejsonDocument('document')) });

export type DocsBatch = z.infer<typeof docsBatch>;

/** An array inside a document that was loaded only partly (large documents). */
export const slicedArray = z.object({
  /** Dotted path of the array, e.g. `items` or `a.b`. */
  path: z.string().min(1),
  /** Total length on the server. */
  total: count,
  /** Number of leading items included in the document. */
  loaded: count,
});

export type SlicedArray = z.infer<typeof slicedArray>;

const collWrite = { ...writeFields, db: dbName, coll: collName };

/** `_id` of the target document. */
const id = ejsonValue('_id');

export const docsMethods = defineMethods({
  'docs.find': {
    summary: 'Run a query; documents arrive as batches on the returned stream',
    route: 'backend',
    /**
     * Paging is either `skip`/`limit` or range paging with one of `after`/`before` (+ `limit`), or
     * `fromEnd` for the last page. Batches arrive in display order (the backend reverses what it
     * reads backwards). With a sort of plain directions, the projection is widened so that every
     * sort key is in the returned documents (`projectionWithSortKeys`), as range paging needs.
     */
    params: z
      .strictObject({
        ...collTarget,
        ...queryFields,
        skip: count.optional(),
        limit: count.optional(),
        /**
         * Range paging: the sort-key values of the last row of the previous page (EJSON document,
         * e.g. `{"_id":{"$oid":"..."}}`); the backend continues after them in sort order.
         */
        after: ejsonDocument('range start').optional(),
        /**
         * Range paging backwards: continue before these sort-key values. Needs a `limit` > 0
         * (the backend refuses it otherwise with `INVALID_PARAMS`: it reads backwards and must
         * buffer the page to send it in display order).
         */
        before: ejsonDocument('range end').optional(),
        /**
         * Read the last `limit` documents of the sorted result (with the reversed sort, no deep
         * skip). Needs a sort of plain directions (an empty sort means `{_id: 1}`) and a `limit`
         * > 0 (refused with `INVALID_PARAMS` otherwise, like `before`).
         */
        fromEnd: z.boolean().optional(),
        batchSize: z.number().int().positive().optional(),
      })
      .refine((p) => p.after === undefined || p.before === undefined, {
        message: 'docs.find takes at most one of after or before',
      })
      .refine((p) => p.skip === undefined || (p.after === undefined && p.before === undefined), {
        message: 'docs.find takes skip or range paging (after/before), not both',
      })
      .refine(
        (p) =>
          p.fromEnd !== true ||
          (p.skip === undefined && p.after === undefined && p.before === undefined),
        { message: 'docs.find takes fromEnd without skip, after or before' },
      ),
    result: streamResult,
    stream: docsBatch,
  },
  'docs.count': {
    summary: 'Exact count of documents matching a filter',
    route: 'backend',
    params: z.strictObject({
      ...collTarget,
      filter: queryFields.filter,
      collation: queryFields.collation,
      hint: queryFields.hint,
      limit: count.optional(),
      maxTimeMS,
    }),
    result: z.object({ count }),
  },
  'docs.estimatedCount': {
    summary: 'Estimated document count of a collection (metadata)',
    route: 'backend',
    params: z.strictObject({ ...collTarget, maxTimeMS }),
    result: z.object({ count }),
  },
  'docs.get': {
    summary: 'Load one document; arrays above `sliceAbove` items come back sliced',
    route: 'backend',
    params: z.strictObject({
      ...collTarget,
      id,
      projection: queryFields.projection,
      /** Arrays longer than this are loaded with `$slice` (only for large documents). */
      sliceAbove: z.number().int().positive().optional(),
    }),
    /** `doc` is `null` when no document has this `_id`. */
    result: z.object({
      doc: ejsonDocument('document').nullable(),
      sliced: z.array(slicedArray),
    }),
  },
  'docs.getSlice': {
    summary: 'Load a range of items of an array inside a document',
    route: 'backend',
    params: z.strictObject({
      ...collTarget,
      id,
      path: z.string().min(1),
      skip: count,
      limit: z.number().int().positive(),
    }),
    result: z.object({ items: ejsonArray('array items'), total: count }),
  },
  'docs.insert': {
    summary: 'Insert one or more documents',
    route: 'backend',
    write: 'always',
    params: z.strictObject({
      ...collWrite,
      docs: z
        .array(ejsonDocument('document'))
        .min(1, { message: 'docs must contain at least one document' }),
      ordered: z.boolean().optional(),
    }),
    result: z.object({ insertedIds: z.array(ejsonValue('_id')) }),
  },
  'docs.update': {
    summary:
      'Apply an update (minimal $set/$unset/$push diff) to one document; ' +
      'fails with CONFLICT when the expected values no longer match',
    route: 'backend',
    write: 'always',
    params: z.strictObject({
      ...collWrite,
      id,
      /** Update document with operators, e.g. `{"$set":{...},"$unset":{...}}`. */
      update: ejsonDocument('update'),
      /** Original values of every changed top-level field, ANDed to the `_id` filter. */
      expected: ejsonDocument('expected values'),
    }),
    result: z.object({ modified: z.boolean() }),
  },
  'docs.replace': {
    summary: 'Replace one document; fails with CONFLICT when `expected` no longer matches',
    route: 'backend',
    write: 'always',
    params: z.strictObject({
      ...collWrite,
      id,
      doc: ejsonDocument('replacement'),
      expected: ejsonDocument('expected values').optional(),
    }),
    result: z.object({ modified: z.boolean() }),
  },
  'docs.delete': {
    summary: 'Delete one document; fails with CONFLICT when `expected` no longer matches',
    route: 'backend',
    write: 'always',
    params: z.strictObject({
      ...collWrite,
      id,
      expected: ejsonDocument('expected values').optional(),
    }),
    result: z.object({ deleted: z.boolean() }),
  },
  'docs.previewMany': {
    summary: 'Preview step of updateMany/deleteMany: matched count and a sample',
    route: 'backend',
    params: z.strictObject({
      ...collTarget,
      filter: queryFields.filter,
      collation: queryFields.collation,
      sampleSize: z.number().int().positive().max(1000).optional(),
      maxTimeMS,
    }),
    result: z.object({ matched: count, sample: z.array(ejsonDocument('document')) }),
  },
  'docs.updateMany': {
    summary: 'Update all matching documents (after docs.previewMany and confirmation)',
    route: 'backend',
    write: 'always',
    params: z.strictObject({
      ...collWrite,
      filter: queryFields.filter,
      /** Update document, or an update pipeline as an EJSON array. */
      update: ejsonDocumentOrArray('update'),
      collation: queryFields.collation,
      /** Matched count shown in the preview; the backend may refuse when it changed a lot. */
      expectedCount: count.optional(),
    }),
    result: z.object({ matched: count, modified: count }),
  },
  'docs.deleteMany': {
    summary: 'Delete all matching documents (after docs.previewMany and confirmation)',
    route: 'backend',
    write: 'always',
    params: z.strictObject({
      ...collWrite,
      filter: queryFields.filter,
      collation: queryFields.collation,
      expectedCount: count.optional(),
    }),
    result: z.object({ deleted: count }),
  },
});
