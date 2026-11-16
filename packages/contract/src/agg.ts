import { z } from 'zod';

import {
  collName,
  collTarget,
  count,
  dbName,
  ejsonArray,
  ejsonDocument,
  emptyResult,
  maxTimeMS,
  streamResult,
  writeFields,
} from './common';
import { defineMethods } from './define';
import { docsBatch, queryFields } from './docs';

export const EXPLAIN_VERBOSITIES = ['queryPlanner', 'executionStats', 'allPlansExecution'] as const;

const pipeline = ejsonArray('pipeline');

export const aggMethods = defineMethods({
  'agg.run': {
    summary:
      'Run a pipeline; documents arrive as batches on the returned stream. ' +
      'Pipelines with $out/$merge are writes',
    route: 'backend',
    write: 'conditional',
    params: z.strictObject({
      ...collTarget,
      confirmed: writeFields.confirmed,
      pipeline,
      collation: queryFields.collation,
      hint: queryFields.hint,
      allowDiskUse: z.boolean().optional(),
      batchSize: z.number().int().positive().optional(),
      maxTimeMS,
    }),
    result: streamResult,
    stream: docsBatch,
  },
  'agg.previewStage': {
    summary:
      'Output of a pipeline up to a stage, on a sample of input documents ($out/$merge are refused)',
    route: 'backend',
    params: z.strictObject({
      ...collTarget,
      /** The stages up to and including the previewed one. */
      pipeline,
      /** Input documents sampled before the pipeline (default 100). */
      sampleSize: z.number().int().positive().optional(),
      /** Maximum output documents (default 20). */
      limit: z.number().int().positive().optional(),
      maxTimeMS,
    }),
    result: z.object({ docs: z.array(ejsonDocument('document')) }),
  },
  'agg.explain': {
    summary: 'Explain a find or an aggregate',
    route: 'backend',
    params: z.strictObject({
      ...collTarget,
      target: z.discriminatedUnion('kind', [
        z.strictObject({
          kind: z.literal('find'),
          ...queryFields,
          skip: count.optional(),
          limit: count.optional(),
        }),
        z.strictObject({
          kind: z.literal('aggregate'),
          pipeline,
          collation: queryFields.collation,
          hint: queryFields.hint,
        }),
      ]),
      verbosity: z.enum(EXPLAIN_VERBOSITIES).optional(),
    }),
    result: z.object({ explain: ejsonDocument('explain output') }),
  },
  'agg.createView': {
    summary: 'Create a view from a pipeline',
    route: 'backend',
    write: 'always',
    params: z.strictObject({
      ...writeFields,
      db: dbName,
      /** Name of the new view. */
      view: collName,
      /** Source collection or view. */
      viewOn: collName,
      pipeline,
      collation: queryFields.collation,
    }),
    result: emptyResult,
  },
});
