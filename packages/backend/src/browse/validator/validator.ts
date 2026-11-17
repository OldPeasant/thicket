import { MAX_VALIDATOR_CHECK_IDS, type ResultOf } from '@thicket/contract';

import { BSON, type Document } from 'mongodb';

import type { ClientLike } from '../../connections/manager';
import { RpcError } from '../../server/rpc';
import { canonical, runCommand, runCursor } from '../browse';

/**
 * The collection validator (`coll.validator.*`, SPEC M3 "Collection validator"): read from the
 * `listCollections` entry, changed with `collMod`, and checked on the server: the documents that
 * fail are the ones `{ _id: { $in: ids }, $nor: [validator] }` finds, so a `$jsonSchema` (or any
 * query-operator validator) is evaluated exactly as the server evaluates it on writes, never by a
 * client-side reimplementation.
 */

type ValidationLevel = ResultOf<'coll.validator.get'>['validationLevel'];
type ValidationAction = ResultOf<'coll.validator.get'>['validationAction'];

const LEVELS: readonly string[] = ['off', 'strict', 'moderate'];
const ACTIONS: readonly string[] = ['error', 'warn', 'errorAndLog'];

function parseEJson(text: string, what: string): unknown {
  try {
    return BSON.EJSON.parse(text, { relaxed: false });
  } catch (error) {
    throw new RpcError(
      'INVALID_PARAMS',
      `${what} is not valid EJSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** A plain document (not an EJSON value wrapper such as `{"$oid": ...}`). */
function isPlainDocument(value: unknown): value is Document {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype &&
    !('_bsontype' in value)
  );
}

/** Parses the canonical EJSON text of a validator (`INVALID_PARAMS` when it isn't a document). */
export function parseValidator(text: string): Document {
  const parsed = parseEJson(text, 'validator');
  if (!isPlainDocument(parsed))
    throw new RpcError('INVALID_PARAMS', 'validator must be an EJSON document');
  return parsed;
}

/** Parses the `_id` list of a check (`INVALID_PARAMS` when it isn't an array or too long). */
export function parseIds(text: string): unknown[] {
  const parsed = parseEJson(text, 'ids');
  if (!Array.isArray(parsed)) throw new RpcError('INVALID_PARAMS', 'ids must be an EJSON array');
  if (parsed.length > MAX_VALIDATOR_CHECK_IDS) {
    throw new RpcError(
      'INVALID_PARAMS',
      `ids has ${parsed.length} values; at most ${MAX_VALIDATOR_CHECK_IDS} can be checked at once`,
    );
  }
  return parsed;
}

/** The `listCollections` entry of one collection; `NOT_FOUND` when there is none. */
async function collectionEntry(
  client: ClientLike,
  db: string,
  coll: string,
  signal?: AbortSignal,
): Promise<Document> {
  const [entry] = await runCursor(
    client,
    db,
    { listCollections: 1, filter: { name: coll }, cursor: {} },
    '$cmd.listCollections',
    signal,
  );
  if (!entry) throw new RpcError('NOT_FOUND', `Collection ${db}.${coll} does not exist`);
  return entry;
}

/** The stored validator; an empty document (what `collMod` with `validator: {}` leaves) is none. */
function storedValidator(entry: Document): Document | null {
  const validator = (entry['options'] as Document | undefined)?.['validator'];
  if (!isPlainDocument(validator) || Object.keys(validator).length === 0) return null;
  return validator;
}

/** `coll.validator.get`: validator, level and action (the server's defaults when not set). */
export async function getValidator(
  client: ClientLike,
  db: string,
  coll: string,
  signal?: AbortSignal,
): Promise<ResultOf<'coll.validator.get'>> {
  const entry = await collectionEntry(client, db, coll, signal);
  const options = (entry['options'] as Document | undefined) ?? {};
  const level = options['validationLevel'];
  const action = options['validationAction'];
  const validator = storedValidator(entry);
  return {
    validator: validator === null ? null : canonical(validator),
    validationLevel: (typeof level === 'string' && LEVELS.includes(level)
      ? level
      : 'strict') as ValidationLevel,
    validationAction: (typeof action === 'string' && ACTIONS.includes(action)
      ? action
      : 'error') as ValidationAction,
  };
}

/** `coll.validator.set`: one `collMod`; a `null` validator removes it (`validator: {}`). */
export async function setValidator(
  client: ClientLike,
  db: string,
  coll: string,
  validatorText: string | null,
  validationLevel: ValidationLevel,
  validationAction: ValidationAction,
): Promise<ResultOf<'coll.validator.set'>> {
  const validator = validatorText === null ? {} : parseValidator(validatorText);
  await runCommand(client, db, { collMod: coll, validator, validationLevel, validationAction });
  return {};
}

/**
 * `coll.validator.check`: the `_id`s among `ids` whose documents fail `validatorText`, or the
 * collection's own validator when none is given. Documents that no longer exist are not listed.
 * The validation level and action don't matter here: the question is whether a document matches.
 */
export async function checkValidator(
  client: ClientLike,
  db: string,
  coll: string,
  idsText: string,
  validatorText: string | undefined,
  signal?: AbortSignal,
): Promise<ResultOf<'coll.validator.check'>> {
  const ids = parseIds(idsText);
  let validator: Document | null;
  if (validatorText !== undefined) {
    validator = parseValidator(validatorText);
    if (Object.keys(validator).length === 0) validator = null;
  } else {
    validator = storedValidator(await collectionEntry(client, db, coll, signal));
  }
  if (validator === null) return { invalid: '[]', hasValidator: false };
  if (ids.length === 0) return { invalid: '[]', hasValidator: true };
  const failing = await runCursor(
    client,
    db,
    { find: coll, filter: { _id: { $in: ids }, $nor: [validator] }, projection: { _id: 1 } },
    coll,
    signal,
  );
  const invalid = failing.map((doc) => doc['_id'] as unknown);
  return {
    invalid: BSON.EJSON.stringify(invalid, { relaxed: false }),
    hasValidator: true,
  };
}
