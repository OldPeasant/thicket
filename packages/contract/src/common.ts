import { z } from 'zod';

/**
 * Building blocks shared by all method groups.
 *
 * Documents never cross a process boundary as objects: they travel as canonical EJSON v2 text
 * (SPEC.md section 4). Every schema that carries a document, a query part (filter, sort, ...),
 * a pipeline or a single BSON value is created by one of the `ejson*` helpers below, which
 * registers it in `ejsonSchemas` so tests can prove that no document field is a plain object.
 */

/** Which EJSON shape a string carries. */
export type EJsonKind = 'document' | 'array' | 'documentOrArray' | 'value';

/** Every EJSON-text schema, with the shape it carries (used by the contract tests). */
export const ejsonSchemas = new WeakMap<z.ZodType, EJsonKind>();

/** Canonical EJSON v2 text of a document (`{...}`), e.g. `{"_id":{"$oid":"..."}}`. */
export type EJsonDocument = string;
/** Canonical EJSON v2 text of an array (`[...]`), e.g. a pipeline or a page of array items. */
export type EJsonArray = string;
/** Canonical EJSON v2 text of any BSON value, e.g. an `_id` (`{"$oid":"..."}`, `"abc"`, `{"$numberInt":"1"}`). */
export type EJsonValue = string;

function firstChar(text: string): string {
  return text.trimStart().charAt(0);
}

/** Schema for EJSON text of a document. Only the outer shape is checked: parsing is the receiver's job. */
export function ejsonDocument(description = 'EJSON document'): z.ZodString {
  const schema = z
    .string()
    .refine((text) => firstChar(text) === '{', {
      message: `${description} must be canonical EJSON text of a document (starting with "{")`,
    })
    .describe(description);
  ejsonSchemas.set(schema, 'document');
  return schema;
}

/** Schema for EJSON text of an array (pipelines, array slices). */
export function ejsonArray(description = 'EJSON array'): z.ZodString {
  const schema = z
    .string()
    .refine((text) => firstChar(text) === '[', {
      message: `${description} must be canonical EJSON text of an array (starting with "[")`,
    })
    .describe(description);
  ejsonSchemas.set(schema, 'array');
  return schema;
}

/**
 * Schema for EJSON text of a document (`{...}`) or an array (`[...]`), e.g. an update that may be
 * an update document or an update pipeline. One schema (not a union) so the message stays readable.
 */
export function ejsonDocumentOrArray(description = 'EJSON document or array'): z.ZodString {
  const schema = z
    .string()
    .refine((text) => firstChar(text) === '{' || firstChar(text) === '[', {
      message: `${description} must be canonical EJSON text of a document (starting with "{") or an array (starting with "[")`,
    })
    .describe(description);
  ejsonSchemas.set(schema, 'documentOrArray');
  return schema;
}

/** Schema for EJSON text of a single BSON value (any type). Blank text is rejected. */
export function ejsonValue(description = 'EJSON value'): z.ZodString {
  const schema = z
    .string()
    .refine((text) => text.trim().length > 0, {
      message: `${description} must be non-empty canonical EJSON text`,
    })
    .describe(description);
  ejsonSchemas.set(schema, 'value');
  return schema;
}

/** Id of a connection profile (also the key of its open connection). */
export const profileId = z.string().min(1, { message: 'profileId must be a non-empty string' });

/** Database name. */
export const dbName = z.string().min(1, { message: 'db must be a non-empty database name' });

/** Collection (or view) name. */
export const collName = z.string().min(1, { message: 'coll must be a non-empty collection name' });

/** Id of a result stream; results arrive as `Event`s with this `stream`. */
export const streamId = z.string().min(1);

/** Result of methods that stream their output. */
export const streamResult = z.object({ streamId });

/** Result of methods that return nothing. */
export const emptyResult = z.object({});

/** Params of methods that take nothing. */
export const emptyParams = z.strictObject({});

/** Fields every database-level request carries. */
export const dbTarget = { profileId, db: dbName };

/** Fields every collection-level request carries. */
export const collTarget = { profileId, db: dbName, coll: collName };

/**
 * Fields every write carries. The backend refuses writes on read-only profiles and requires
 * `confirmed: true` for every write on production profiles and for the bulk writes
 * `docs.updateMany` / `docs.deleteMany` on every profile, so a forgotten confirm dialog fails closed.
 */
export const writeFields = {
  profileId,
  confirmed: z.boolean().optional(),
};

/** Server-side time limit for an operation, in milliseconds. */
export const maxTimeMS = z.number().int().positive().optional();

/** Non-negative integer. */
export const count = z.number().int().nonnegative();
