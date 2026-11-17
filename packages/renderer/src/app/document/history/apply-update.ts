import type { BsonDocument, BsonField, BsonValue } from '@thicket/core/bson';
import type { UpdateOp } from '@thicket/core/diff';

/**
 * `doc` after the update `ops` as MongoDB applies them: `$set` of an existing path keeps its
 * place, of a new path appends it to its parent; `$unset` removes; `$push` appends items. Paths are
 * dotted document keys (as the diff builds them). MongoDB (5.0 and later) applies an update's
 * fields in field-name order, not in the order they were sent: names compared byte by byte, two
 * numeric names in numeric order. So several fields added to one parent are appended in that
 * order. Used to see whether an update would restore a document with its field order, or whether
 * only a replace can.
 */
export function applyUpdate(doc: BsonDocument, ops: readonly UpdateOp[]): BsonDocument {
  const sorted = ops
    .map((op) => ({ op, path: op.path.split('.') }))
    .sort((a, b) => comparePaths(a.path, b.path));
  let result = doc;
  for (const { op, path } of sorted) result = applyAt(result, path, op);
  return result;
}

/** MongoDB's update order of two dotted paths, compared part by part (see `compareNames`). */
function comparePaths(a: readonly string[], b: readonly string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const order = compareNames(a[i] as string, b[i] as string);
    if (order !== 0) return order;
  }
  return a.length - b.length;
}

/**
 * MongoDB's order of field names in an update: two numeric names of different length by length
 * (numeric order), otherwise by code point, which is the order of their UTF-8 bytes.
 */
function compareNames(a: string, b: string): number {
  if (a.length !== b.length && NUMERIC.test(a) && NUMERIC.test(b)) return a.length - b.length;
  const x = Array.from(a, (c) => c.codePointAt(0) ?? 0);
  const y = Array.from(b, (c) => c.codePointAt(0) ?? 0);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const order = (x[i] ?? 0) - (y[i] ?? 0);
    if (order !== 0) return order;
  }
  return x.length - y.length;
}

const NUMERIC = /^[0-9]+$/;

function applyAt(doc: BsonDocument, path: readonly string[], op: UpdateOp): BsonDocument {
  const [key, ...rest] = path;
  if (key === undefined) return doc;
  const at = doc.fields.findIndex((f) => f.key === key);
  const existing = at >= 0 ? doc.fields[at]?.value : undefined;
  let value: BsonValue | undefined;
  if (rest.length > 0) {
    const parent: BsonDocument =
      existing?.type === 'object' ? existing : { type: 'object', fields: [] };
    if (op.op === 'unset' && existing?.type !== 'object') return doc;
    value = applyAt(parent, rest, op);
  } else if (op.op === 'set') {
    value = op.value;
  } else if (op.op === 'push') {
    const items = existing?.type === 'array' ? existing.items : [];
    value = { type: 'array', items: [...items, ...op.items] };
  } else {
    value = undefined;
  }
  const fields: BsonField[] = [...doc.fields];
  if (value === undefined) {
    if (at >= 0) fields.splice(at, 1);
  } else if (at >= 0) {
    fields[at] = { key, value };
  } else {
    fields.push({ key, value });
  }
  return { type: 'object', fields };
}
