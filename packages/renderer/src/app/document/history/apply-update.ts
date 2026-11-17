import type { BsonDocument, BsonField, BsonValue } from '@thicket/core/bson';
import type { UpdateOp } from '@thicket/core/diff';

/**
 * `doc` after the update `ops` as MongoDB applies them: `$set` of an existing path keeps its
 * place, of a new path appends it to its parent; `$unset` removes; `$push` appends items. Paths are
 * dotted document keys (as the diff builds them). Used to see whether an update would restore a
 * document with its field order, or whether only a replace can.
 */
export function applyUpdate(doc: BsonDocument, ops: readonly UpdateOp[]): BsonDocument {
  let result = doc;
  for (const op of ops) result = applyAt(result, op.path.split('.'), op);
  return result;
}

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
