import type { CsvType } from '@thicket/contract';
import { BSON, Decimal128, Double, Int32, Long, ObjectId, Timestamp, type Document } from 'mongodb';

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
 *
 * Field names that contain a dot (legal since MongoDB 5.0) never lose their value:
 * - a top-level one (`"a.b"`) is its own column, named by the key ({@link valueAt} reads the
 *   literal key first), and is never flattened: a document value is one column (as Extended
 *   JSON), not `a.b.c`;
 * - a top-level document that such a key would collide with in the same document (`a` next to
 *   `"a.b"`) is not flattened: it is one column (`a`, as Extended JSON);
 * - a nested document with such a key (`{x: {"a.b": 1}}`) is not flattened: it is one column
 *   (`x`, as Extended JSON).
 */
export function collectPaths(doc: Document, paths: Set<string>, prefix = ''): void {
  const keys = Object.keys(doc);
  const shadowed = new Set(
    prefix === '' ? keys.filter((k) => k.includes('.')).map((k) => k.split('.')[0]) : [],
  );
  for (const [key, value] of Object.entries(doc)) {
    const path = prefix + key;
    if (
      isPlainDocument(value) &&
      Object.keys(value).length > 0 &&
      !key.includes('.') &&
      !shadowed.has(key) &&
      !Object.keys(value).some((k) => k.includes('.'))
    ) {
      collectPaths(value, paths, `${path}.`);
    } else {
      paths.add(path);
    }
  }
}

/**
 * The value at a dotted path (`undefined` when missing): a top-level field named exactly `path`
 * (a key containing a dot) first, else the path's segments one level each. A numeric segment
 * also indexes an array (`tags.0`).
 */
export function valueAt(doc: Document, path: string): unknown {
  if (path.includes('.') && Object.hasOwn(doc, path)) return doc[path];
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
  // A Timestamp is a Long in the driver, but no number: it falls through to Extended JSON.
  if ((value instanceof Long && !(value instanceof Timestamp)) || value instanceof Decimal128) {
    return value.toString();
  }
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

/**
 * ISO 8601 calendar date, optionally with a time (`T`, minutes required, seconds and a fraction
 * optional) and an offset (`Z`, `±hh:mm` or `±hhmm`). The year has 4 digits, or 6 with a sign
 * (`+010000`, `-000001`: the extended form `toISOString()` writes outside the years 0-9999).
 */
const ISO_DATE =
  /^([+-]\d{6}|\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?(?:Z|([+-])(\d{2}):?(\d{2}))?)?$/;

/**
 * A date cell: milliseconds since 1970 (digits only, what exports may write) or ISO 8601 (see
 * {@link ISO_DATE}). A date-time without an offset is UTC, so the result never depends on the
 * time zone of the machine. Anything else (`03/01/2026`, `2026-03-01 10:00`, `2024-02-30`) is
 * no date.
 */
function date(text: string): Date {
  if (/^-?\d+$/.test(text)) {
    const d = new Date(Number(text));
    if (Number.isNaN(d.getTime())) throw new CellError('is not a date');
    return d;
  }
  const m = ISO_DATE.exec(text);
  // ISO 8601 has no year -000000 (year 0 is +000000).
  if (!m || m[1] === '-000000') throw new CellError('is not a date');
  const n = (i: number) => Number(m[i] ?? '0');
  const [year, month, day, hours, minutes, seconds] = [n(1), n(2), n(3), n(4), n(5), n(6)];
  const millis = Number((m[7] ?? '').padEnd(3, '0').slice(0, 3));
  // Refuse out-of-range parts (month 13, February 30, hour 24, second 60, offset +24:00).
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const valid =
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= (monthDays[month - 1] ?? 0) &&
    hours <= 23 &&
    minutes <= 59 &&
    seconds <= 59 &&
    n(9) <= 23 &&
    n(10) <= 59;
  if (!valid) throw new CellError('is not a date');
  // Computed on numbers, not a Date: the wall-clock time may lie outside the Date range when the
  // offset moves the instant back in (`+275760-09-13T01:00+01:00`). Exact: |ms| < 2^53.
  const offsetMinutes = (m[8] === '-' ? -1 : 1) * (n(9) * 60 + n(10));
  const ms =
    daysFromCivil(year, month, day) * 86_400_000 +
    ((hours * 60 + minutes - offsetMinutes) * 60 + seconds) * 1000 +
    millis;
  if (Math.abs(ms) > 8.64e15) throw new CellError('is not a date');
  return new Date(ms);
}

/** Days since 1970-01-01 of a proleptic Gregorian date (month 1-12; H. Hinnant's algorithm). */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
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

/** One entry of `io.import`'s `csvMapping`. */
export interface CsvMappingInput {
  column: string;
  /** 0-based position of the column in the header (needed for a repeated header name). */
  index?: number | undefined;
  path: string;
  bsonType: CsvType;
}

/** Whether two paths are the same or one is the prefix path of the other. */
function overlaps(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);
}

/**
 * The default mapping: every column under its own name as `auto`, except columns that cannot be
 * a field this way, which are left out (the import panel lets the user map them): a blank name,
 * a name with an empty path segment (`a.`, `.a`), and a name that repeats or overlaps the path
 * of an earlier column (`a,a` or `a,a.b`: the first one is taken). Never throws.
 */
export function defaultMapping(header: readonly string[]): CsvColumnMapping[] {
  const taken: string[] = [];
  const columns: CsvColumnMapping[] = [];
  header.forEach((column, index) => {
    if (column.trim() === '') return;
    const path = column.split('.');
    if (path.some((s) => s === '')) return;
    if (taken.some((t) => overlaps(t, column))) return;
    taken.push(column);
    columns.push({ index, column, path, type: 'auto' });
  });
  return columns;
}

/** The header position of a mapping entry's column; `RpcError` INVALID_PARAMS when unclear. */
function columnIndex(header: readonly string[], m: CsvMappingInput): number {
  if (m.index !== undefined) {
    if (header[m.index] !== m.column) {
      throw new RpcError(
        'INVALID_PARAMS',
        `The file has no column ${JSON.stringify(m.column)} at index ${String(m.index)}`,
      );
    }
    return m.index;
  }
  const index = header.indexOf(m.column);
  if (index < 0) {
    throw new RpcError('INVALID_PARAMS', `The file has no column ${JSON.stringify(m.column)}`);
  }
  if (header.lastIndexOf(m.column) !== index) {
    // By its name alone, the wrong one of the columns could be imported.
    throw new RpcError(
      'INVALID_PARAMS',
      `The file has more than one column ${JSON.stringify(m.column)}: choose one by its index`,
    );
  }
  return index;
}

/**
 * Validates a mapping against the header: every column named must exist (at its `index` when
 * given, which a repeated header name needs), paths have no empty segment, and no path is used
 * twice or is the prefix of another (one would overwrite the other). Without `mapping`, the
 * lenient {@link defaultMapping}.
 */
export function resolveMapping(
  header: readonly string[],
  mapping: readonly CsvMappingInput[] | undefined,
): CsvColumnMapping[] {
  if (mapping === undefined) return defaultMapping(header);
  const seen = new Set<string>();
  const resolved = mapping.map((m) => {
    const index = columnIndex(header, m);
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
