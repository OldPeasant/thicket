import { BsonLeaf, isBsonLeaf } from './bson-value.util';
import { blankBson } from './bson-input.util';
import { objectFromEntries, orderedKeys } from './key-order.util';

// 'bson': a BSON value other than a string, boolean, null, document or array
// (see bson-value.util), shown as one scalar.
export type JsonType = 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object' | 'bson';

export function typeOf(value: unknown): JsonType {
  if (value === null) return 'null';
  if (isBsonLeaf(value)) return 'bson';
  if (Array.isArray(value)) return 'array';
  return typeof value as JsonType;
}

export function defaultForType(type: JsonType): unknown {
  switch (type) {
    case 'null':
    case 'bson':
      return null;
    case 'boolean':
      return false;
    case 'number':
      return 0;
    case 'string':
      return '';
    case 'array':
      return [];
    case 'object':
      return {};
  }
}

// Recursively rebuilds a value's shape (object keys, array length) with
// every leaf reset to its type's default (BSON values keep their type) — used to give the user a
// ready-to-fill starting point that matches what a given column looks like
// elsewhere, without literally copying another row's data.
export function blankLike(value: unknown): unknown {
  const type = typeOf(value);
  if (type === 'object') {
    const src = value as Record<string, unknown>;
    return objectFromEntries(orderedKeys(src).map((k) => [k, blankLike(src[k])]));
  }
  if (type === 'array') {
    return (value as unknown[]).map(blankLike);
  }
  // A BSON value keeps its type: an Int64 column gets an Int64 0, not null.
  if (isBsonLeaf(value)) return new BsonLeaf(blankBson(value.bson));
  return defaultForType(type);
}

// A starting value for a new item appended to `arr` when no schema says what
// its items look like: shaped like the items already there. In an array of
// records that is a record with every key any record has (in column order,
// each blanked like the first record that has it) — not a bare '' with no
// keys of its own, which would sit in the table's synthetic "value" column
// and take whatever is typed as a string. An array of plain values gets
// one more of the same type; an empty array gets ''.
export function blankItemLike(arr: unknown[]): unknown {
  const records = arr.filter((item): item is Record<string, unknown> => typeOf(item) === 'object');
  if (records.length > 0) {
    const out: Record<string, unknown> = {};
    for (const record of records) {
      for (const key of Object.keys(record)) {
        if (!Object.prototype.hasOwnProperty.call(out, key)) out[key] = blankLike(record[key]);
      }
    }
    return out;
  }
  return arr.length > 0 ? blankLike(arr[arr.length - 1]) : '';
}

export { moveEntry, withEntry, withoutEntry } from './key-order.util';

export function withItem(arr: unknown[], index: number, value: unknown): unknown[] {
  const copy = arr.slice();
  copy[index] = value;
  return copy;
}

export function withoutItemAt(arr: unknown[], index: number): unknown[] {
  const copy = arr.slice();
  copy.splice(index, 1);
  return copy;
}

export function withAppended(arr: unknown[], value: unknown): unknown[] {
  return [...arr, value];
}
