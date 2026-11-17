import { z } from 'zod';

import { collName, dbName, ejsonDocument, emptyResult, profileId } from './common';
import { defineMethods } from './define';

/**
 * Saved aggregation pipelines (SPEC M3 "save pipelines"): served by `main`, stored in
 * `userData/pipelines.json`. A pipeline is saved under a name per collection (profile, database
 * and collection, like the query favorites); its stages are canonical EJSON, disabled ones
 * included.
 */

/** Id of a saved pipeline (assigned by `main`). */
export const pipelineId = z
  .string()
  .min(1, { message: 'pipelineId must be a non-empty string' });

/** Name of a saved pipeline: 1–200 characters after trimming. */
export const pipelineName = z
  .string()
  .trim()
  .min(1, { message: 'name must not be empty' })
  .max(200, { message: 'name must be at most 200 characters' });

/** One stage of a saved pipeline: the stage document and whether it is enabled. */
export const savedStage = z.object({
  /** The stage as canonical EJSON text of a one-key document (`{"$match":{...}}`). */
  stage: ejsonDocument('stage'),
  enabled: z.boolean(),
});

export type SavedStage = z.infer<typeof savedStage>;

/** The collection a pipeline is saved for. */
export const pipelineNamespace = { profileId, db: dbName, coll: collName };

export const savedPipeline = z.object({
  pipelineId,
  name: pipelineName,
  ...pipelineNamespace,
  stages: z.array(savedStage),
  /** When it was last saved or renamed (ISO 8601). */
  updatedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, {
      message: 'updatedAt must be an ISO 8601 UTC time',
    }),
});

export type SavedPipeline = z.infer<typeof savedPipeline>;

export const pipelinesMethods = defineMethods({
  'pipelines.list': {
    summary: 'Saved pipelines of a collection, sorted by name',
    route: 'main',
    params: z.strictObject(pipelineNamespace),
    result: z.object({ pipelines: z.array(savedPipeline) }),
  },
  'pipelines.save': {
    summary:
      'Save a pipeline under a name for a collection; an existing pipeline of that collection ' +
      'with the same name (ignoring case) is replaced',
    route: 'main',
    params: z.strictObject({
      ...pipelineNamespace,
      name: pipelineName,
      stages: z.array(z.strictObject(savedStage.shape)),
    }),
    result: z.object({ saved: savedPipeline }),
  },
  'pipelines.rename': {
    summary:
      'Rename a saved pipeline; refused (CONFLICT) when another pipeline of its collection ' +
      'has that name',
    route: 'main',
    params: z.strictObject({ pipelineId, name: pipelineName }),
    result: z.object({ saved: savedPipeline }),
  },
  'pipelines.delete': {
    summary: 'Delete a saved pipeline',
    route: 'main',
    params: z.strictObject({ pipelineId }),
    result: emptyResult,
  },
});
