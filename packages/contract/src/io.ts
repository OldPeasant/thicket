import { z } from 'zod';

import {
  collName,
  collTarget,
  count,
  dbName,
  ejsonArray,
  ejsonDocument,
  streamResult,
  writeFields,
} from './common';
import { defineMethods } from './define';
import { errorSummary } from './errors';
import { queryFields } from './docs';

/**
 * Import and export. They run in the backend (which reads and writes the files, streams the
 * progress and is guarded like every write); the backend asks `main` over its privileged port to
 * show the native file dialog (`dialog.saveFile` / `dialog.openFile`). The renderer never sends
 * file paths: an import names its file by the opaque `fileToken` of `io.previewImport`.
 */

export const EXPORT_FORMATS = ['json', 'jsonl', 'csv', 'bson'] as const;
export const IMPORT_FORMATS = ['json', 'jsonl', 'csv', 'bson'] as const;

/** Progress of an import or export stream. */
export const ioProgress = z.object({
  /** Documents written to the file (export) or read from the file (import) so far. */
  processed: count,
  /** Documents that could not be imported (parse or write errors). */
  failed: count,
  /**
   * Per-document failures; only the first ones are reported. `index` is the 1-based line of the
   * file where the failed document starts.
   */
  errors: z.array(z.object({ index: count, error: errorSummary })),
});

export type IoProgress = z.infer<typeof ioProgress>;

export const ioMethods = defineMethods({
  'io.export': {
    summary: 'Export query or pipeline results to a file chosen with a save dialog',
    route: 'backend',
    params: z.strictObject({
      ...collTarget,
      source: z.discriminatedUnion('kind', [
        z.strictObject({
          kind: z.literal('find'),
          ...queryFields,
          skip: count.optional(),
          limit: count.optional(),
        }),
        z.strictObject({ kind: z.literal('aggregate'), pipeline: ejsonArray('pipeline') }),
      ]),
      format: z.enum(EXPORT_FORMATS),
      /** EJSON mode for json/jsonl. */
      ejsonMode: z.enum(['relaxed', 'canonical']).optional(),
      /** CSV only: dotted field paths to write as columns, in order. */
      csvFields: z.array(z.string().min(1)).optional(),
    }),
    /** `streamId` is `null` when the dialog was cancelled. */
    result: z.object({ streamId: z.string().min(1).nullable(), path: z.string().nullable() }),
    stream: ioProgress,
  },
  'io.previewImport': {
    summary: 'Choose a file with an open dialog and parse its first documents',
    route: 'backend',
    params: z.strictObject({
      format: z.enum(IMPORT_FORMATS),
      sampleSize: z.number().int().positive().max(1000).optional(),
    }),
    /** `null` when the dialog was cancelled. */
    result: z
      .object({
        /** Opaque handle of the chosen file, passed to `io.import`. */
        fileToken: z.string().min(1),
        fileName: z.string(),
        sizeBytes: count,
        sample: z.array(ejsonDocument('document')),
        /** CSV only: header columns. */
        csvColumns: z.array(z.string()).optional(),
      })
      .nullable(),
  },
  'io.import': {
    summary: 'Import a previewed file into a collection',
    route: 'backend',
    write: 'always',
    params: z.strictObject({
      ...writeFields,
      db: dbName,
      coll: collName,
      fileToken: z.string().min(1),
      ordered: z.boolean().optional(),
      stopOnError: z.boolean().optional(),
      /** CSV only: column → { field path, BSON type }. */
      csvMapping: z
        .array(
          z.strictObject({
            column: z.string(),
            path: z.string().min(1),
            bsonType: z.string().min(1),
          }),
        )
        .optional(),
    }),
    result: streamResult,
    stream: ioProgress,
  },
});
