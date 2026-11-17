import type { CsvType } from '@thicket/contract';
import { BSON, Decimal128, Double, Int32, Long, ObjectId, type Document } from 'mongodb';

import { RpcError } from '../../server/rpc';

/**
 * Between documents and CSV cells: the columns of a document (nested documents flattened to
 * dotted paths), a value as cell text, and cell text as a value of a chosen BSON type.
 */

/** A plain (sub)document, not an array or a BSON value class (ObjectId, Long, …). */
export function isPlainDocument(value: unknown): value is Document {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(value instanceof Uint8Array) &&
    !('_bsontype' in value)
  );
}

/**
 * Adds the flattened field paths of `doc` to `paths` (in the order first seen): a nested,
 * non-empty document becomes one path per leaf (`a.b.c`); arrays and every other value are
 * one column.
 */
export function collectPaths(doc: Document, paths: Set<string>, prefix = ''): void {
  for (const [key, value] of Object.entries(doc)) {
    const path = prefix + key;
    if (isPlainDocument(value) && Object.keys(value).length > 0) {
      collectPaths(value, paths, `${path}.`);
    } else {
      paths.add(path);
    }
  }
}

/**
 * The value at a dotted path (`undefined` when missing). A numeric segment also indexes an
 * array (`tags.0`).
 */
export function valueAt(doc: Document, path: string): unknown {
  let current: unknown = doc;
  for (const key of path.split('.')) {
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(key)) return undefined;
      current = current[Number(key)];
    } else if (isPlainDocument(current)) {
      if (!Object.hasOwn(current, key)) return undefined;
      current = current[key];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * A value as cell text: strings as they are, numbers in decimal (Long and Decimal128 exactly),
 * dates as ISO 8601, ObjectIds as hex, booleans as `true`/`false`, `null` and missing as an
 * empty cell; arrays, documents and other types as Extended JSON (`relaxed` or canonical).
 */
export function cellText(value: unknown, relaxed: boolean): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Int32 || value instanceof Double) return String(value.valueOf());
  if (value instanceof Long || value instanceof Decimal128) return value.toString();
  if (value instanceof ObjectId) return value.toHexString();
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return BSON.EJSON.stringify(value, { relaxed });
}

const INTEGER = /^[+-]?\d+$/;
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const SPECIAL_DOUBLES: Record<string, number> = {
  NaN: Number.NaN,
  Infinity: Number.POSITIVE_INFINITY,
  '+Infinity': Number.POSITIVE_INFINITY,
  '-Infinity': Number.NEGATIVE_INFINITY,
};
const INT32_MIN = -(2n ** 31n);
const INT32_MAX = 2n ** 31n - 1n;
const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;
const TRUE = new Set(['true', 'yes', '1']);
const FALSE = new Set(['false', 'no', '0']);

/** Thrown by {@link convertCell} for text that is not a value of the type. */
export class CellError extends Error {}

function integer(text: string, min: bigint, max: bigint, what: string): bigint {
  if (!INTEGER.test(text)) throw new CellError(`is not ${what}`);
  const n = BigInt(text);
  if (n < min || n > max) throw new CellError(`is out of range for ${what}`);
  return n;
}

function double(text: string): Double {
  const special = SPECIAL_DOUBLES[text];
  if (special !== undefined) return new Double(special);
  if (!NUMBER.test(text)) throw new CellError('is not a number');
  return new Double(Number(text));
}

function date(text: string): Date {
  // Digits only: milliseconds since 1970 (what spreadsheets rarely write, but exports may).
  const d = /^-?\d+$/.test(text) ? new Date(Number(text)) : new Date(text);
  if (Number.isNaN(d.getTime())) throw new CellError('is not a date');
  return d;
}

/**
 * Cell text as a value of `type`, or `undefined` for a blank cell (the field is left out),
 * except `string`, which keeps an empty string. Throws `CellError` when the text is no value of
 * the type. Text is trimmed for every type but `string` and `json`.
 */
export function convertCell(raw: string, type: CsvType): unknown {
  if (type === 'string') return raw;
  const text = raw.trim();
  if (text === '') return undefined;
  switch (type) {
    case 'auto': {
      if (INTEGER.test(text)) {
        const n = BigInt(text);
        if (n >= INT32_MIN && n <= INT32_MAX) return new Int32(Number(n));
        if (n >= INT64_MIN && n <= INT64_MAX) return Long.fromBigInt(n);
      }
      if (NUMBER.test(text)) return new Double(Number(text));
      if (text === 'true') return true;
      if (text === 'false') return false;
      return raw;
    }
    case 'int':
      return new Int32(Number(integer(text, INT32_MIN, INT32_MAX, 'a 32-bit integer')));
    case 'long':
      return Long.fromBigInt(integer(text, INT64_MIN, INT64_MAX, 'a 64-bit integer'));
    case 'double':
      return double(text);
    case 'decimal':
      try {
        return Decimal128.fromString(text);
      } catch {
        throw new CellError('is not a decimal number');
      }
    case 'bool': {
      const lower = text.toLowerCase();
      if (TRUE.has(lower)) return true;
      if (FALSE.has(lower)) return false;
      throw new CellError('is not a boolean (true/false)');
    }
    case 'date':
      return date(text);
    case 'objectId':
      if (!/^[0-9a-fA-F]{24}$/.test(text))
        throw new CellError('is not an ObjectId (24 hex digits)');
      return new ObjectId(text);
    case 'json':
      try {
        return BSON.EJSON.parse(text, { relaxed: false });
      } catch {
        throw new CellError('is not valid Extended JSON');
      }
  }
}

/** A column of a CSV file imported as a field. */
export interface CsvColumnMapping {
  /** Index of the column in the header. */
  index: number;
  column: string;
  /** Path segments (`a.b` → `['a', 'b']`). */
  path: string[];
  type: CsvType;
}

/**
 * Validates a mapping against the header: every column named must exist (a repeated header name
 * means its first column), paths have no empty segment, and no path is used twice or is the
 * prefix of another (one would overwrite the other). Without `mapping`, every column with a name
 * is imported under that name as `auto`.
 */
export function resolveMapping(
  header: readonly string[],
  mapping: readonly { column: string; path: string; bsonType: CsvType }[] | undefined,
): CsvColumnMapping[] {
  const entries =
    mapping ??
    header
      .filter((column) => column.trim() !== '')
      .map((column) => ({ column, path: column, bsonType: 'auto' as const }));
  const seen = new Set<string>();
  const resolved = entries.map((m) => {
    const index = header.indexOf(m.column);
    if (index < 0) {
      throw new RpcError('INVALID_PARAMS', `The file has no column ${JSON.stringify(m.column)}`);
    }
    const path = m.path.split('.');
    if (path.some((s) => s === '')) {
      throw new RpcError('INVALID_PARAMS', `Field path ${JSON.stringify(m.path)} is not valid`);
    }
    if (seen.has(m.path)) {
      throw new RpcError('INVALID_PARAMS', `Field path ${JSON.stringify(m.path)} is used twice`);
    }
    seen.add(m.path);
    return { index, column: m.column, path, type: m.bsonType };
  });
  for (const a of seen) {
    for (const b of seen) {
      if (b.startsWith(`${a}.`)) {
        throw new RpcError(
          'INVALID_PARAMS',
          `Field paths ${JSON.stringify(a)} and ${JSON.stringify(b)} overlap`,
        );
      }
    }
  }
  return resolved;
}

/**
 * The document of one CSV record. Missing cells (a short record) are blank; a record with more
 * cells than the header, or a cell that is no value of its column's type, throws `RpcError`
 * naming the line.
 */
export function recordToDocument(
  cells: readonly string[],
  line: number,
  header: readonly string[],
  columns: readonly CsvColumnMapping[],
): Document {
  if (cells.length > header.length) {
    throw new RpcError(
      'INVALID_PARAMS',
      `Line ${String(line)}: ${String(cells.length)} cells, the header has ${String(header.length)}`,
    );
  }
  const doc: Document = {};
  for (const column of columns) {
    let value: unknown;
    const raw = cells[column.index] ?? '';
    try {
      value = convertCell(raw, column.type);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const shown = raw.length > 40 ? `${raw.slice(0, 40)}…` : raw;
      throw new RpcError(
        'INVALID_PARAMS',
        `Line ${String(line)}: column ${JSON.stringify(column.column)}: ${JSON.stringify(shown)} ${reason}`,
      );
    }
    if (value === undefined) continue;
    let target = doc;
    for (const key of column.path.slice(0, -1)) {
      // Paths never overlap (resolveMapping), so an existing value is a document made here.
      const next = Object.hasOwn(target, key) ? (target[key] as Document) : undefined;
      target = next ?? setField(target, key, {});
    }
    setField(target, column.path.at(-1) ?? '', value);
  }
  return doc;
}

/** Sets an own field, also one named `__proto__` (an assignment would set the prototype). */
function setField<T>(target: Document, key: string, value: T): T {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return value;
}
