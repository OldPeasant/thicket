import { z } from 'zod';

import { count, dbName, dbTarget, ejsonDocument, ejsonValue, writeFields } from './common';
import { defineMethods } from './define';

/**
 * GridFS (SPEC M6 "Could"): buckets of a database, their files, download to a file chosen with a
 * save dialog, upload of a file chosen with an open dialog (both streamed with byte progress) and
 * delete. Like `io.*`, the backend asks `main` for the native dialogs; the renderer never sends
 * file paths.
 */

/** Bucket name: the prefix of its `<name>.files` / `<name>.chunks` collections. */
export const bucketName = z
  .string()
  .min(1, { message: 'bucket must be a non-empty bucket name' })
  .refine((name) => !name.includes('$') && !name.includes('\0'), {
    message: 'bucket must not contain "$" or NUL',
  });

/** Files the backend lists at most per `gridfs.files` call. */
export const MAX_GRIDFS_FILES = 1000;

export const gridfsBucket = z.object({
  name: z.string(),
  /** Documents in `<name>.files` (estimated). */
  files: count,
  /** Whether `<name>.chunks` exists (a bucket without it holds only empty files). */
  hasChunks: z.boolean(),
});

export type GridfsBucket = z.infer<typeof gridfsBucket>;

export const gridfsFile = z.object({
  /** The file's `_id` as canonical EJSON (usually an ObjectId). */
  id: ejsonValue('file id'),
  filename: z.string(),
  /** Size in bytes. */
  length: count,
  chunkSize: count,
  /** ISO date of `uploadDate`; empty when the document has none. */
  uploadDate: z.string(),
  contentType: z.string().optional(),
  metadata: ejsonDocument('metadata').optional(),
});

export type GridfsFile = z.infer<typeof gridfsFile>;

/** Byte progress of an upload or download. */
export const gridfsProgress = z.object({
  /** Bytes transferred so far. */
  bytes: count,
  /** Size of the whole file in bytes. */
  totalBytes: count,
  /** The new file's id (canonical EJSON); only in an upload's last event. */
  fileId: ejsonValue('file id').optional(),
});

export type GridfsProgress = z.infer<typeof gridfsProgress>;

const bucketTarget = { ...dbTarget, bucket: bucketName };

export const gridfsMethods = defineMethods({
  'gridfs.buckets': {
    summary: 'GridFS buckets of a database (collections named <bucket>.files)',
    route: 'backend',
    params: z.strictObject({ ...dbTarget }),
    result: z.object({ buckets: z.array(gridfsBucket) }),
  },
  'gridfs.files': {
    summary: 'Files of a bucket, newest first',
    route: 'backend',
    params: z.strictObject({
      ...bucketTarget,
      /** Only files whose name contains this text (case-insensitive). */
      nameContains: z.string().optional(),
      skip: count.optional(),
      /** Default and maximum {@link MAX_GRIDFS_FILES}. */
      limit: z.number().int().positive().max(MAX_GRIDFS_FILES).optional(),
    }),
    result: z.object({
      files: z.array(gridfsFile),
      /** Files matching `nameContains`, independent of skip/limit. */
      total: count,
    }),
  },
  'gridfs.download': {
    summary: 'Download a file to a path chosen with a save dialog',
    route: 'backend',
    params: z.strictObject({ ...bucketTarget, id: ejsonValue('file id') }),
    /** `streamId` and `path` are `null` when the dialog was cancelled. */
    result: z.object({ streamId: z.string().min(1).nullable(), path: z.string().nullable() }),
    stream: gridfsProgress,
  },
  'gridfs.upload': {
    summary: 'Upload a file chosen with an open dialog into a bucket',
    route: 'backend',
    write: 'always',
    params: z.strictObject({
      ...writeFields,
      db: dbName,
      bucket: bucketName,
      /** Stored as `filename`; defaults to the chosen file's base name. */
      filename: z.string().min(1).optional(),
      contentType: z.string().min(1).optional(),
    }),
    /** `streamId` and `fileName` are `null` when the dialog was cancelled. */
    result: z.object({
      streamId: z.string().min(1).nullable(),
      fileName: z.string().nullable(),
      sizeBytes: count.nullable(),
    }),
    stream: gridfsProgress,
  },
  'gridfs.delete': {
    summary: 'Delete a file (its files document and chunks)',
    route: 'backend',
    write: 'always',
    params: z.strictObject({
      ...writeFields,
      db: dbName,
      bucket: bucketName,
      id: ejsonValue('file id'),
    }),
    /** `deleted: false` when no file had that id (its stray chunks are removed anyway). */
    result: z.object({ deleted: z.boolean() }),
  },
});
