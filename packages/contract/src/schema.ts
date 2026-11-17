import { z } from 'zod';

import { collTarget, count, ejsonArray, ejsonDocument, maxTimeMS } from './common';
import { defineMethods } from './define';

/** One BSON type seen at a field path. */
export const schemaType = z.object({
  /** BSON type name as in `$type` (`objectId`, `string`, `int`, `array`, ...). */
  bsonType: z.string(),
  /** Share of the path's base (see `schemaField.probability`) having this type (0..1). */
  probability: z.number().min(0).max(1),
  count,
  /** A few example values. */
  examples: ejsonArray('example values'),
});

/**
 * One field path (dotted; array items as `a.[]`, documents in arrays below it: `a.[].b`).
 * Shares are relative to the parent: the sampled documents for a top-level field, the sampled
 * `a` values that are documents for `a.b`, all sampled items for `a.[]` (always 1).
 */
export const schemaField = z.object({
  path: z.string(),
  /** Share of the parent having this field (0..1); missing ratio is `1 - probability`. */
  probability: z.number().min(0).max(1),
  count,
  types: z.array(schemaType),
});

export type SchemaField = z.infer<typeof schemaField>;

export const schemaMethods = defineMethods({
  'schema.analyze': {
    summary: 'Analyze field paths and types on a sample of documents',
    route: 'backend',
    params: z.strictObject({
      ...collTarget,
      filter: ejsonDocument('filter').optional(),
      /** Documents to sample (default 1000). */
      sampleSize: z.number().int().positive().optional(),
      maxTimeMS,
    }),
    result: z.object({ sampled: count, fields: z.array(schemaField) }),
  },
});
