import {
  BsonModelError,
  arr,
  doc,
  str,
  type BsonArray,
  type BsonDocument,
  type BsonField,
  type BsonValue,
} from '../bson/model';
import { bsonEquals } from './equals';

/**
 * Edited document → minimal update operations and conflict filter (SPEC "Documents": Save sends
 * one `updateOne` with the minimal `$set`/`$unset` diff, `$push` for pure appends; the filter is
 * `_id` plus the original values of every changed top-level field).
 *
 * Rules:
 * - A changed scalar, a type change or a new field → `$set` of its dotted path; a removed field
 *   → `$unset`; a rename is an `$unset` of the old plus a `$set` of the new name.
 * - Documents present on both sides are compared field by field. MongoDB appends new fields at
 *   the end of their document, so the result of applying the update equals the edited document
 *   except that fields that did not exist in the original end up last in their parent.
 * - If the fields both sides share are in a different order (reorder), or a changed field
 *   cannot be addressed by a dotted path (empty, contains `.`, starts with `$`, or the document
 *   has repeated keys), the whole parent document is `$set`. At the top level that is not
 *   possible: the result is then a `replace` of the whole document. MongoDB rejects a
 *   replacement with a top-level field name starting with `$`, so such an edit throws a
 *   `BsonModelError` instead of returning a `replace` that cannot be saved.
 * - Arrays are not merged: when only items were appended (the original is an unchanged prefix)
 *   the new items are `$push`ed with `$each`, otherwise the whole array is `$set`.
 * - `_id` cannot change (MongoDB rejects it), the diff throws instead.
 */

/** A single update operation on a dotted path. */
export type UpdateOp =
  | { readonly op: 'set'; readonly path: string; readonly value: BsonValue }
  | { readonly op: 'unset'; readonly path: string }
  | { readonly op: 'push'; readonly path: string; readonly items: readonly BsonValue[] };

interface DiffBase {
  /**
   * Query fragment checking the original values of every changed top-level field (ANDed to the
   * `_id` filter; this is `docs.update`'s `expected`). A field that was absent is checked with
   * `$exists: false`, an original `null` or `undefined` with `$type` (`$eq: null` would also
   * match a missing field, `$eq: undefined` is rejected by the server), any other value with
   * `$eq`. Fields whose names cannot be used as a query path use `$expr`/`$getField`.
   */
  readonly expected: BsonDocument;
  /** `{ _id: <original _id>, ...expected }`: the full `updateOne`/`replaceOne` filter. */
  readonly filter: BsonDocument;
  /** Changed top-level field names, in original order followed by new fields. */
  readonly changedFields: readonly string[];
}

export type DocumentDiff =
  | { readonly kind: 'none' }
  | (DiffBase & {
      readonly kind: 'update';
      readonly ops: readonly UpdateOp[];
      /** `{ $set: {...}, $unset: {...}, $push: {...} }` (only the non-empty operators). */
      readonly update: BsonDocument;
    })
  | (DiffBase & {
      readonly kind: 'replace';
      /**
       * The edited document, for `replaceOne` (top-level reorder or unaddressable fields). It
       * never has a top-level field name starting with `$` (the diff throws instead).
       */
      readonly replacement: BsonDocument;
    });

/** A field name usable as a segment of a dotted update/query path. */
export function isAddressableKey(key: string): boolean {
  return key !== '' && !key.includes('.') && !key.startsWith('$');
}

/** Computes the update that turns `original` into `edited`, plus its conflict filter. */
export function diffDocuments(original: BsonDocument, edited: BsonDocument): DocumentDiff {
  const id = firstValue(original, '_id');
  if (!id) throw new BsonModelError('The original document has no _id');
  const editedId = firstValue(edited, '_id');
  if (!editedId || !bsonEquals(id, editedId)) {
    throw new BsonModelError('The _id of a document cannot be changed');
  }
  if (bsonEquals(original, edited)) return { kind: 'none' };

  const ops = diffFields(original, edited, '');
  if (ops === 'replace') {
    // MongoDB rejects replacement documents with top-level `$` field names.
    const dollarKeys = uniqueKeys(edited).filter((k) => k.startsWith('$'));
    if (dollarKeys.length > 0) {
      throw new BsonModelError(
        `Top-level field names starting with $ cannot be saved: ${dollarKeys.join(', ')}`,
      );
    }
    const changed = changedTopLevel(original, edited);
    // A pure reorder changes no value: check the whole original instead.
    const fields = changed.length > 0 ? changed : uniqueKeys(original).filter((k) => k !== '_id');
    return { kind: 'replace', replacement: edited, ...conflict(original, id, fields) };
  }
  const fields: string[] = [];
  for (const o of ops) {
    const top = o.path.split('.', 1)[0] as string;
    if (!fields.includes(top)) fields.push(top);
  }
  return { kind: 'update', ops, update: toUpdateDocument(ops), ...conflict(original, id, fields) };
}

/** The update document for a list of operations. */
export function toUpdateDocument(ops: readonly UpdateOp[]): BsonDocument {
  const set: BsonField[] = [];
  const unset: BsonField[] = [];
  const push: BsonField[] = [];
  for (const o of ops) {
    if (o.op === 'set') set.push({ key: o.path, value: o.value });
    else if (o.op === 'unset') unset.push({ key: o.path, value: str('') });
    else push.push({ key: o.path, value: doc([{ key: '$each', value: arr(o.items) }]) });
  }
  const parts: BsonField[] = [];
  if (set.length) parts.push({ key: '$set', value: doc(set) });
  if (unset.length) parts.push({ key: '$unset', value: doc(unset) });
  if (push.length) parts.push({ key: '$push', value: doc(push) });
  return doc(parts);
}

// ---------------------------------------------------------------------------------------------

function firstValue(d: BsonDocument, key: string): BsonValue | undefined {
  return d.fields.find((f) => f.key === key)?.value;
}

function uniqueKeys(d: BsonDocument): string[] {
  return [...new Set(d.fields.map((f) => f.key))];
}

function hasRepeatedKeys(d: BsonDocument): boolean {
  return new Set(d.fields.map((f) => f.key)).size !== d.fields.length;
}

/** Operations for two documents at `prefix`, or `'replace'` when the parent must be replaced. */
function diffFields(o: BsonDocument, e: BsonDocument, prefix: string): UpdateOp[] | 'replace' {
  if (hasRepeatedKeys(o) || hasRepeatedKeys(e)) return 'replace';
  const origByKey = new Map(o.fields.map((f) => [f.key, f.value]));
  const editByKey = new Map(e.fields.map((f) => [f.key, f.value]));
  const sharedInOriginal = o.fields.filter((f) => editByKey.has(f.key)).map((f) => f.key);
  const sharedInEdited = e.fields.filter((f) => origByKey.has(f.key)).map((f) => f.key);
  if (sharedInOriginal.some((k, i) => k !== sharedInEdited[i])) return 'replace';

  const ops: UpdateOp[] = [];
  for (const { key, value: ov } of o.fields) {
    const ev = editByKey.get(key);
    if (ev && bsonEquals(ov, ev)) continue;
    if (!isAddressableKey(key)) return 'replace';
    const path = prefix + key;
    if (!ev) {
      ops.push({ op: 'unset', path });
    } else if (ov.type === 'object' && ev.type === 'object') {
      const inner = diffFields(ov, ev, path + '.');
      if (inner === 'replace') ops.push({ op: 'set', path, value: ev });
      else ops.push(...inner);
    } else if (ov.type === 'array' && ev.type === 'array') {
      ops.push(diffArray(ov, ev, path));
    } else {
      ops.push({ op: 'set', path, value: ev });
    }
  }
  for (const { key, value } of e.fields) {
    if (origByKey.has(key)) continue;
    if (!isAddressableKey(key)) return 'replace';
    ops.push({ op: 'set', path: prefix + key, value });
  }
  return ops;
}

function diffArray(o: BsonArray, e: BsonArray, path: string): UpdateOp {
  const appendOnly =
    e.items.length > o.items.length &&
    o.items.every((v, i) => bsonEquals(v, e.items[i] as BsonValue));
  return appendOnly
    ? { op: 'push', path, items: e.items.slice(o.items.length) }
    : { op: 'set', path, value: e };
}

/** Top-level keys whose (first) value differs or that exist on one side only. */
function changedTopLevel(o: BsonDocument, e: BsonDocument): string[] {
  const keys = [...new Set([...uniqueKeys(o), ...uniqueKeys(e)])];
  return keys.filter((k) => {
    const ov = firstValue(o, k);
    const ev = firstValue(e, k);
    return !ov || !ev || !bsonEquals(ov, ev);
  });
}

function conflict(original: BsonDocument, id: BsonValue, keys: readonly string[]): DiffBase {
  const expected: BsonField[] = [];
  const exprs: BsonValue[] = [];
  for (const key of keys) {
    const ov = firstValue(original, key);
    if (isAddressableKey(key)) {
      expected.push({ key, value: doc([queryFieldCheck(ov)]) });
    } else {
      exprs.push(exprFieldCheck(key, ov));
    }
  }
  if (exprs.length === 1) expected.push({ key: '$expr', value: exprs[0] as BsonValue });
  if (exprs.length > 1)
    expected.push({ key: '$expr', value: doc([{ key: '$and', value: arr(exprs) }]) });
  const filter = doc([{ key: '_id', value: id }, ...expected]);
  return { expected: doc(expected), filter, changedFields: keys };
}

/**
 * Query operator checking a field against its original value (`undefined`: the field was absent).
 * Null and BSON undefined are checked by type: `$eq: null` also matches a missing field, and the
 * server rejects `$eq: undefined`.
 */
function queryFieldCheck(value: BsonValue | undefined): BsonField {
  if (!value) return { key: '$exists', value: { type: 'bool', value: false } };
  if (value.type === 'null' || value.type === 'undefined') {
    return { key: '$type', value: str(value.type) };
  }
  return { key: '$eq', value };
}

/**
 * `$expr` condition that the top-level field `key` has exactly `value`: works for any name, also
 * one that is not a valid path (`.`, `$`, empty). Aggregation `$eq` compares an array or embedded
 * document as a whole (no match on an array element, unlike query `$eq`). Absent, null and BSON
 * undefined originals compare the field's `$type` ("missing", "null", "undefined"), so a null
 * original never matches a missing field.
 */
export function exprFieldCheck(key: string, value: BsonValue | undefined): BsonValue {
  const literal = (v: BsonValue) => doc([{ key: '$literal', value: v }]);
  const getField = doc([
    {
      key: '$getField',
      value: doc([
        { key: 'field', value: literal(str(key)) },
        { key: 'input', value: str('$$ROOT') },
      ]),
    },
  ]);
  const typeIs = (name: string) => arr([doc([{ key: '$type', value: getField }]), str(name)]);
  let pair: BsonValue;
  if (!value) pair = typeIs('missing');
  else if (value.type === 'null' || value.type === 'undefined') pair = typeIs(value.type);
  else pair = arr([getField, literal(value)]);
  return doc([{ key: '$eq', value: pair }]);
}
