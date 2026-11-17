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

/**
 * BSON types a CSV column can be imported as (`$type` aliases). `auto`: integers become Int32
 * (Int64 when larger), other numbers Double, `true`/`false` Boolean, the rest String. `json`: the
 * cell is an Extended JSON value (arrays, documents, any type). A blank cell leaves the field out,
 * except for `string` (an empty string).
 */
export const CSV_TYPES = [
  'auto',
  'string',
  'int',
  'long',
  'double',
  'decimal',
  'bool',
  'date',
  'objectId',
  'json',
] as const;

export type CsvType = (typeof CSV_TYPES)[number];

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
      /** EJSON mode for json/jsonl, and for CSV cells holding arrays, documents or other types. */
      ejsonMode: z.enum(['relaxed', 'canonical']).optional(),
      /**
       * CSV only: dotted field paths to write as columns, in order. Without it the columns are
       * the flattened paths (nested documents become `a.b` columns) of the first 1000 documents.
       */
      csvFields: z.array(z.string().min(1)).min(1).optional(),
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
        /**
         * CSV only: header columns. `sample` then holds the first rows imported with the default
         * mapping (every column, `auto` type).
         */
        csvColumns: z.array(z.string()).optional(),
        /** CSV only: the cells of the first rows (after the header), as written in the file. */
        csvRows: z.array(z.array(z.string())).optional(),
        /**
         * BSON only: name of the `mongodump` metadata file found next to the chosen file
         * (`<name>.metadata.json`); its indexes (and options, for a new collection) are applied.
         */
        metadataFile: z.string().optional(),
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
      /**
       * CSV only: column (header name) → { dotted field path, BSON type }. Columns left out are
       * not imported. Without it every column is imported under its own name as `auto`.
       */
      csvMapping: z
        .array(
          z.strictObject({
            column: z.string(),
            path: z.string().min(1),
            bsonType: z.enum(CSV_TYPES),
          }),
        )
        .min(1)
        .optional(),
    }),
    result: streamResult,
    stream: ioProgress,
  },
});
