import type { ParsedParamsOf, ResultOf } from '@thicket/contract';
import { BSON, type Document } from 'mongodb';

import { canonical, toNumber } from '../../browse/browse';
import type { ClientLike } from '../../connections/manager';
import { RpcError } from '../../server/rpc';
import { Operation, countDocuments, parseDocument, parseEjson } from '../query/query';

/**
 * Writing documents (`docs.insert/update/replace/delete`, `docs.previewMany`,
 * `docs.updateMany/deleteMany`) with plain `insert`/`update`/`delete` commands on an open client,
 * like the reads in `../query`: EJSON params are parsed canonically (no number promotion), so every
 * BSON type is written as sent, and every command carries an `Operation` comment, so a cancel
 * kills it on the server (the write may already have happened by then).
 *
 * The read-only / production / bulk confirmation rules are not checked here: `startBackend` wraps
 * every write handler with `guardWrites()` (`../../guard`).
 *
 * Conflict detection (SPEC "Editing and saving"): single-document writes match
 * `{$and: [{_id: {$eq: id}}, expected]}`. When that matches nothing, the current server version
 * of the document is read and the write fails with `CONFLICT` and `ConflictDetail`
 * (`{ current }`, `null` when the document is gone).
 */

/** Sample size of `docs.previewMany` when the request names none. */
export const DEFAULT_PREVIEW_SAMPLE = 20;

/** Matches `_id` literally: an id such as `{"$ne": null}` is a value, not a query operator. */
const idFilter = (id: unknown): Document => ({ _id: { $eq: id } });

/** `_id` plus the expected values (a query fragment, possibly with `$expr`); `$and` keeps both intact. */
function conflictFilter(id: unknown, expected: Document | undefined): Document {
  if (expected === undefined || Object.keys(expected).length === 0) return idFilter(id);
  return { $and: [idFilter(id), expected] };
}

const isOperator = (key: string): boolean => key.startsWith('$');

/** An update document must consist of update operators only (otherwise it would replace). */
function operatorUpdate(text: string): Document {
  const update = parseDocument(text, 'update');
  const keys = Object.keys(update);
  if (keys.length === 0) throw new RpcError('INVALID_PARAMS', 'update must not be empty');
  const plain = keys.filter((k) => !isOperator(k));
  if (plain.length > 0) {
    throw new RpcError(
      'INVALID_PARAMS',
      `update must contain only update operators such as $set; found ${plain.join(', ')}`,
    );
  }
  return update;
}

/** An update for `updateMany`: an operator document or an update pipeline (array of stages). */
function manyUpdate(text: string): Document | Document[] {
  const parsed = parseEjson(text, 'update');
  if (!Array.isArray(parsed)) return operatorUpdate(text);
  if (parsed.length === 0)
    throw new RpcError('INVALID_PARAMS', 'update pipeline must not be empty');
  for (const stage of parsed as unknown[]) {
    if (typeof stage !== 'object' || stage === null || Array.isArray(stage)) {
      throw new RpcError('INVALID_PARAMS', 'every stage of an update pipeline must be a document');
    }
  }
  return parsed as Document[];
}

/** A replacement document must not contain update operators (the server would apply them). */
function replacementDocument(text: string): Document {
  const doc = parseDocument(text, 'replacement');
  const dollar = Object.keys(doc).filter(isOperator);
  if (dollar.length > 0) {
    throw new RpcError(
      'INVALID_PARAMS',
      `replacement field names must not start with $: ${dollar.join(', ')}`,
    );
  }
  return doc;
}

function count(value: unknown): number {
  const n = toNumber(value);
  return n !== undefined && Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

interface WriteError {
  index: number;
  code?: number;
  codeName?: string;
  errmsg: string;
}

function writeErrors(reply: Document): WriteError[] {
  const list = reply['writeErrors'];
  if (!Array.isArray(list)) return [];
  return (list as Document[]).map((e) => ({
    index: count(e['index']),
    ...(toNumber(e['code']) !== undefined ? { code: toNumber(e['code']) } : {}),
    ...(typeof e['codeName'] === 'string' ? { codeName: e['codeName'] } : {}),
    errmsg: typeof e['errmsg'] === 'string' ? e['errmsg'] : 'write error',
  }));
}

function serverError(message: string, error: { code?: number; codeName?: string }): RpcError {
  const detail: { serverCode?: number; codeName?: string } = {};
  if (error.code !== undefined) detail.serverCode = error.code;
  if (error.codeName !== undefined) detail.codeName = error.codeName;
  return new RpcError('SERVER_ERROR', message, detail);
}

/**
 * Throws `SERVER_ERROR` for write errors and write concern errors in a write command's reply (the
 * command itself answers `ok: 1` for them). `done` describes what did succeed, for the message.
 */
function checkReply(reply: Document, what: string, done?: string): void {
  const errors = writeErrors(reply);
  const [first] = errors;
  if (first) {
    const more = errors.length > 1 ? ` (and ${errors.length - 1} more write errors)` : '';
    const prefix = done ? `${done}; ` : '';
    throw serverError(`${prefix}${what} failed: ${first.errmsg}${more}`, first);
  }
  const wce = reply['writeConcernError'] as Document | undefined;
  if (wce) {
    const code = toNumber(wce['code']);
    throw serverError(
      `${what}: write concern error: ${typeof wce['errmsg'] === 'string' ? wce['errmsg'] : 'unknown'}`,
      {
        ...(code !== undefined ? { code } : {}),
        ...(typeof wce['codeName'] === 'string' ? { codeName: wce['codeName'] } : {}),
      },
    );
  }
}

/** Runs one write command as a cancellable operation. */
async function runWrite(
  client: ClientLike,
  db: string,
  coll: string,
  cmd: Document,
  signal: AbortSignal | undefined,
): Promise<Document> {
  const op = new Operation(client, db, coll, signal);
  try {
    return await op.run(cmd);
  } finally {
    await op.close();
  }
}

/** The current server version of a document as canonical EJSON (`null` when it is gone). */
async function currentDocument(
  client: ClientLike,
  db: string,
  coll: string,
  id: unknown,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  const op = new Operation(client, db, coll, signal);
  try {
    const [doc] = await op.open({
      find: coll,
      filter: idFilter(id),
      limit: 1,
      singleBatch: true,
    });
    return doc ? canonical(doc) : null;
  } finally {
    await op.close();
  }
}

async function conflict(
  client: ClientLike,
  p: { db: string; coll: string },
  id: unknown,
  signal: AbortSignal | undefined,
): Promise<RpcError> {
  const current = await currentDocument(client, p.db, p.coll, id, signal);
  return new RpcError(
    'CONFLICT',
    current === null
      ? 'The document was deleted on the server meanwhile'
      : 'The document was changed on the server meanwhile',
    { current },
  );
}

/**
 * `docs.insert`: inserts the documents. Documents without `_id` get a new ObjectId (first field,
 * as the driver does), so every inserted id can be returned. A write error (e.g. a duplicate key)
 * fails the request with `SERVER_ERROR`; with `ordered: false` the other documents are still
 * inserted, and the message says how many were.
 */
export async function insertDocuments(
  client: ClientLike,
  p: ParsedParamsOf<'docs.insert'>,
  signal?: AbortSignal,
): Promise<ResultOf<'docs.insert'>> {
  const documents = p.docs.map((text, i) => {
    const doc = parseDocument(text, `docs[${i}]`);
    return '_id' in doc ? doc : { _id: new BSON.ObjectId(), ...doc };
  });
  const cmd: Document = { insert: p.coll, documents, ordered: p.ordered ?? true };
  const reply = await runWrite(client, p.db, p.coll, cmd, signal);
  const n = count(reply['n']);
  checkReply(
    reply,
    'insert',
    `${n} of ${documents.length} document${documents.length === 1 ? '' : 's'} inserted`,
  );
  return { insertedIds: documents.map((d) => BSON.EJSON.stringify(d['_id'], { relaxed: false })) };
}

/** `update` command with one statement; answers the reply's `n` / `nModified`. */
async function updateOne(
  client: ClientLike,
  p: { db: string; coll: string },
  filter: Document,
  update: Document | Document[],
  signal: AbortSignal | undefined,
): Promise<{ matched: number; modified: number }> {
  const cmd: Document = {
    update: p.coll,
    updates: [{ q: filter, u: update, multi: false, upsert: false }],
    ordered: true,
  };
  const reply = await runWrite(client, p.db, p.coll, cmd, signal);
  checkReply(reply, 'update');
  return { matched: count(reply['n']), modified: count(reply['nModified']) };
}

/**
 * `docs.update`: applies the operator update to the document with `_id` = `id` whose top-level
 * fields still have the `expected` values. Matched nothing → `CONFLICT` with the server version.
 */
export async function updateDocument(
  client: ClientLike,
  p: ParsedParamsOf<'docs.update'>,
  signal?: AbortSignal,
): Promise<ResultOf<'docs.update'>> {
  const id = parseEjson(p.id, 'id');
  const update = operatorUpdate(p.update);
  const expected = parseDocument(p.expected, 'expected');
  const result = await updateOne(client, p, conflictFilter(id, expected), update, signal);
  if (result.matched === 0) throw await conflict(client, p, id, signal);
  return { modified: result.modified > 0 };
}

/** `docs.replace`: like `docs.update` with a replacement document (`expected` optional). */
export async function replaceDocument(
  client: ClientLike,
  p: ParsedParamsOf<'docs.replace'>,
  signal?: AbortSignal,
): Promise<ResultOf<'docs.replace'>> {
  const id = parseEjson(p.id, 'id');
  const replacement = replacementDocument(p.doc);
  const expected = p.expected === undefined ? undefined : parseDocument(p.expected, 'expected');
  const result = await updateOne(client, p, conflictFilter(id, expected), replacement, signal);
  if (result.matched === 0) throw await conflict(client, p, id, signal);
  return { modified: result.modified > 0 };
}

/**
 * `docs.delete`: deletes the document with `_id` = `id` (and the `expected` values, if given).
 * A document that is already gone answers `deleted: false`; one that exists but no longer has the
 * expected values fails with `CONFLICT` and its server version.
 */
export async function deleteDocument(
  client: ClientLike,
  p: ParsedParamsOf<'docs.delete'>,
  signal?: AbortSignal,
): Promise<ResultOf<'docs.delete'>> {
  const id = parseEjson(p.id, 'id');
  const expected = p.expected === undefined ? undefined : parseDocument(p.expected, 'expected');
  const cmd: Document = {
    delete: p.coll,
    deletes: [{ q: conflictFilter(id, expected), limit: 1 }],
    ordered: true,
  };
  const reply = await runWrite(client, p.db, p.coll, cmd, signal);
  checkReply(reply, 'delete');
  if (count(reply['n']) > 0) return { deleted: true };
  if (expected !== undefined && Object.keys(expected).length > 0) {
    const error = await conflict(client, p, id, signal);
    if ((error.detail as { current: string | null }).current !== null) throw error;
  }
  return { deleted: false };
}

/**
 * `docs.previewMany`: the number of documents a filter matches now and a sample of them (the
 * first `sampleSize`, default {@link DEFAULT_PREVIEW_SAMPLE}, in natural order).
 */
export async function previewMany(
  client: ClientLike,
  p: ParsedParamsOf<'docs.previewMany'>,
  signal?: AbortSignal,
): Promise<ResultOf<'docs.previewMany'>> {
  const filter = parseDocument(p.filter, 'filter');
  const collation =
    p.collation === undefined ? undefined : parseDocument(p.collation, 'collation', true);
  const limit = p.sampleSize ?? DEFAULT_PREVIEW_SAMPLE;
  const { count: matched } = await countDocuments(
    client,
    {
      profileId: p.profileId,
      db: p.db,
      coll: p.coll,
      filter: p.filter,
      ...(p.collation !== undefined ? { collation: p.collation } : {}),
      ...(p.maxTimeMS !== undefined ? { maxTimeMS: p.maxTimeMS } : {}),
    },
    signal,
  );
  const cmd: Document = { find: p.coll, filter, limit, batchSize: limit, singleBatch: true };
  if (collation !== undefined) cmd['collation'] = collation;
  if (p.maxTimeMS !== undefined) cmd['maxTimeMS'] = p.maxTimeMS;
  const op = new Operation(client, p.db, p.coll, signal);
  try {
    const docs = matched === 0 ? [] : await op.open(cmd);
    return { matched, sample: docs.map(canonical) };
  } finally {
    await op.close();
  }
}

/**
 * With `expectedCount` (the count the user confirmed in the preview): refuses with `CONFLICT`
 * when more documents match now than were confirmed. Fewer is allowed (documents the user saw
 * were changed or removed meanwhile; nothing unconfirmed is touched by that).
 */
async function checkExpectedCount(
  client: ClientLike,
  p: { profileId: string; db: string; coll: string; filter: string; collation?: string },
  expectedCount: number | undefined,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (expectedCount === undefined) return;
  const { count: now } = await countDocuments(
    client,
    {
      profileId: p.profileId,
      db: p.db,
      coll: p.coll,
      filter: p.filter,
      ...(p.collation !== undefined ? { collation: p.collation } : {}),
    },
    signal,
  );
  if (now > expectedCount) {
    throw new RpcError(
      'CONFLICT',
      `${now} documents match now, but the preview showed ${expectedCount}; preview again`,
    );
  }
}

/** `docs.updateMany`: one multi-update; answers the server's matched and modified counts. */
export async function updateMany(
  client: ClientLike,
  p: ParsedParamsOf<'docs.updateMany'>,
  signal?: AbortSignal,
): Promise<ResultOf<'docs.updateMany'>> {
  const filter = parseDocument(p.filter, 'filter');
  const update = manyUpdate(p.update);
  const statement: Document = { q: filter, u: update, multi: true, upsert: false };
  if (p.collation !== undefined)
    statement['collation'] = parseDocument(p.collation, 'collation', true);
  await checkExpectedCount(client, p, p.expectedCount, signal);
  const reply = await runWrite(
    client,
    p.db,
    p.coll,
    { update: p.coll, updates: [statement], ordered: true },
    signal,
  );
  const matched = count(reply['n']);
  const modified = count(reply['nModified']);
  checkReply(reply, 'updateMany', `${modified} documents modified`);
  return { matched, modified };
}

/** `docs.deleteMany`: one multi-delete; answers the number of deleted documents. */
export async function deleteMany(
  client: ClientLike,
  p: ParsedParamsOf<'docs.deleteMany'>,
  signal?: AbortSignal,
): Promise<ResultOf<'docs.deleteMany'>> {
  const filter = parseDocument(p.filter, 'filter');
  const statement: Document = { q: filter, limit: 0 };
  if (p.collation !== undefined)
    statement['collation'] = parseDocument(p.collation, 'collation', true);
  await checkExpectedCount(client, p, p.expectedCount, signal);
  const reply = await runWrite(
    client,
    p.db,
    p.coll,
    { delete: p.coll, deletes: [statement], ordered: true },
    signal,
  );
  const deleted = count(reply['n']);
  checkReply(reply, 'deleteMany', `${deleted} documents deleted`);
  return { deleted };
}
