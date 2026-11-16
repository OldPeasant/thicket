import {
  BINARY_SUBTYPE_UUID,
  DEPRECATED_TYPES,
  INT32_MAX,
  INT32_MIN,
  stringifyEJson,
  uuidOf,
  type BsonArray,
  type BsonDocument,
  type BsonType,
  type BsonValue,
} from '@thicket/core/bson';

import { objectFromEntries, orderedEntries } from './key-order.util';

// The explorer walks plain JS trees (objects, arrays, strings, numbers,
// booleans, null). A BSON document is shown by turning it into such a tree
// whose containers are plain objects/arrays, whose strings, booleans and nulls
// stay JS values, and whose every other value is a frozen `BsonLeaf` holding
// the model value unchanged. A leaf is a scalar for the explorer (never walked
// into), so Int64, Decimal128 or Date values reach the display untouched and
// are formatted from the model, never through a JS number.

/** A BSON value the explorer shows as one scalar (everything but documents and arrays). */
export type BsonLeafValue = Exclude<BsonValue, BsonDocument | BsonArray>;

export class BsonLeaf {
  constructor(readonly bson: BsonLeafValue) {
    Object.freeze(this);
  }

  /**
   * Canonical EJSON v2, so `JSON.stringify` of an explorer tree (size
   * estimates, equality checks, JSON Lines text) works and stays exact.
   */
  toJSON(): unknown {
    return JSON.parse(stringifyEJson(this.bson));
  }
}

export function isBsonLeaf(value: unknown): value is BsonLeaf {
  return value instanceof BsonLeaf;
}

/** A plain object or array the explorer walks into (not a leaf, not null). */
export function isContainer(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !isBsonLeaf(value);
}

/**
 * The explorer tree for a BSON value. Documents become plain objects that
 * keep their field order (see key-order.util: integer-like keys, which JS
 * objects list first, keep their place through a hidden key list); a
 * repeated key keeps its last value at its first position.
 */
export function toExplorerValue(value: BsonValue): unknown {
  switch (value.type) {
    case 'object':
      return objectFromEntries(value.fields.map((f) => [f.key, toExplorerValue(f.value)]));
    case 'array':
      return value.items.map(toExplorerValue);
    case 'string':
      return value.value;
    case 'bool':
      return value.value;
    case 'null':
      return null;
    default:
      return new BsonLeaf(value);
  }
}

/**
 * The BSON value of an explorer tree. Plain JS numbers (typed in the explorer)
 * become Int32 when they are integers that fit, Double otherwise.
 */
export function fromExplorerValue(value: unknown): BsonValue {
  if (isBsonLeaf(value)) return value.bson;
  if (value === null || value === undefined) return { type: 'null' };
  if (typeof value === 'string') return { type: 'string', value };
  if (typeof value === 'boolean') return { type: 'bool', value };
  if (typeof value === 'number')
    return isInt32(value) ? { type: 'int', value } : { type: 'double', value };
  if (Array.isArray(value)) return { type: 'array', items: value.map(fromExplorerValue) };
  if (typeof value === 'object') {
    return {
      type: 'object',
      fields: orderedEntries(value).map(([key, v]) => ({ key, value: fromExplorerValue(v) })),
    };
  }
  throw new TypeError(`Not an explorer value: ${typeof value}`);
}

function isInt32(n: number): boolean {
  return Number.isInteger(n) && n >= INT32_MIN && n <= INT32_MAX && !Object.is(n, -0);
}

/** The BSON type of any explorer value; plain JS numbers count as Int32 or Double. */
export function bsonTypeOf(value: unknown): BsonType {
  if (isBsonLeaf(value)) return value.bson.type;
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'boolean':
      return 'bool';
    case 'number':
      return isInt32(value) ? 'int' : 'double';
    default:
      return 'object';
  }
}

/** Deprecated types (Undefined, Symbol, DBPointer, Code with scope) are shown, never edited. */
export function isDeprecatedValue(value: unknown): boolean {
  return isBsonLeaf(value) && DEPRECATED_TYPES.includes(value.bson.type);
}

const TYPE_LABELS: Record<BsonType, string> = {
  double: 'Double',
  string: 'String',
  object: 'Object',
  array: 'Array',
  binary: 'Binary',
  undefined: 'Undefined',
  objectId: 'ObjectId',
  bool: 'Boolean',
  date: 'Date',
  null: 'Null',
  regex: 'Regex',
  dbPointer: 'DBPointer',
  javascript: 'Code',
  symbol: 'Symbol',
  javascriptWithScope: 'Code w/ scope',
  int: 'Int32',
  timestamp: 'Timestamp',
  long: 'Int64',
  decimal: 'Decimal128',
  minKey: 'MinKey',
  maxKey: 'MaxKey',
};

export interface Badge {
  /** BSON type; the badge color is the `--bson-<kebab-case type>` token. */
  readonly type: BsonType;
  /** Text on the badge. */
  readonly label: string;
  /** Tooltip. */
  readonly title: string;
}

/** The type badge of an explorer value. Binary shows its subtype; subtype 4 shows as UUID. */
export function badgeOf(value: unknown): Badge {
  const type = bsonTypeOf(value);
  let label = TYPE_LABELS[type];
  let title = label;
  if (isBsonLeaf(value) && value.bson.type === 'binary') {
    const sub = value.bson.subtype;
    const hex = `0x${sub.toString(16).padStart(2, '0')}`;
    if (sub === BINARY_SUBTYPE_UUID && uuidOf(value.bson) !== null) {
      label = 'UUID';
      title = `Binary subtype ${hex} (UUID)`;
    } else {
      label = `Binary ${hex}`;
      title = `Binary subtype ${hex}`;
    }
  }
  if (DEPRECATED_TYPES.includes(type)) title += ' (deprecated BSON type, read-only)';
  return { type, label, title };
}

/**
 * `--bson-<type>` token name for a BSON type (`objectId` → `object-id`,
 * `binary` → `bin-data`; Code with scope shares the `javascript` token).
 */
export function badgeColorVar(type: BsonType): string {
  const name =
    type === 'binary'
      ? 'bin-data'
      : type === 'javascriptWithScope'
        ? 'javascript'
        : type.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  return `var(--bson-${name})`;
}

export interface DateDisplay {
  /** Show dates in UTC instead of local time. */
  readonly utc: boolean;
  /** IANA time zone for local time; the system zone when omitted. */
  readonly timeZone?: string;
}

/** Largest |ms| a JS `Date` can hold. */
const DATE_LIMIT_MS = 8_640_000_000_000_000n;

/**
 * The text shown for a value (and searched): exact for every type. Int64 and
 * Decimal128 come from their model text, never from a JS number.
 */
export function displayText(value: unknown, dates: DateDisplay = { utc: false }): string {
  if (!isBsonLeaf(value)) {
    if (typeof value === 'number') return formatDouble(value);
    return value === null || value === undefined ? 'null' : String(value);
  }
  const v = value.bson;
  switch (v.type) {
    case 'double':
      return formatDouble(v.value);
    case 'int':
      return String(v.value);
    case 'long':
      return v.value.toString();
    case 'decimal':
      return v.value;
    case 'objectId':
      return v.hex;
    case 'date':
      return formatDate(v.ms, dates);
    case 'binary':
      return (v.subtype === BINARY_SUBTYPE_UUID ? uuidOf(v) : null) ?? v.base64;
    case 'regex':
      return `/${v.pattern}/${v.options}`;
    case 'timestamp':
      return `Timestamp(${v.t}, ${v.i})`;
    case 'javascript':
      return v.code;
    case 'javascriptWithScope':
      return `${v.code} with scope ${stringifyEJson(v.scope)}`;
    case 'symbol':
      return v.value;
    case 'dbPointer':
      return `DBPointer(${v.ref}, ${v.hex})`;
    case 'undefined':
      return 'undefined';
    case 'minKey':
      return 'MinKey';
    case 'maxKey':
      return 'MaxKey';
    case 'string':
    case 'bool':
      return String(v.value);
    case 'null':
      return 'null';
  }
}

function formatDouble(n: number): string {
  return Object.is(n, -0) ? '-0' : String(n);
}

/**
 * A date as ISO-8601: local time with its UTC offset and the zone name
 * (`2023-11-14T23:13:20.000+01:00 Europe/Zurich`), or UTC (`…Z`). Dates a JS
 * `Date` cannot hold show their milliseconds since the epoch.
 */
export function formatDate(ms: bigint, dates: DateDisplay): string {
  if (ms > DATE_LIMIT_MS || ms < -DATE_LIMIT_MS) return `${ms} ms since 1970 (out of date range)`;
  const t = Number(ms);
  if (dates.utc) return new Date(t).toISOString();
  const zone = dates.timeZone ?? systemTimeZone();
  const offsetMs = zoneOffsetMs(t, zone);
  const local = t + offsetMs;
  // Near the JS date limits the zone's wall clock can lie outside the JS range
  // (the offset is then NaN, or the local time passes the limit): show UTC.
  if (!Number.isFinite(local) || Math.abs(local) > Number(DATE_LIMIT_MS)) {
    return new Date(t).toISOString();
  }
  const iso = new Date(local).toISOString().slice(0, -1);
  return `${iso}${formatOffset(offsetMs)} ${zone}`;
}

let systemZone: string | undefined;

/** The system time zone, resolved once. */
export function systemTimeZone(): string {
  systemZone ??= Intl.DateTimeFormat().resolvedOptions().timeZone;
  return systemZone;
}

/** Wall-clock formatters per time zone: building one is costly, so they are reused. */
const zoneFormats = new Map<string, Intl.DateTimeFormat>();

function zoneFormat(timeZone: string): Intl.DateTimeFormat {
  let format = zoneFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      era: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    zoneFormats.set(timeZone, format);
  }
  return format;
}

/** Offset of `timeZone`'s wall clock from UTC at epoch ms `t` (whole seconds). */
export function zoneOffsetMs(t: number, timeZone: string): number {
  const parts = zoneFormat(timeZone).formatToParts(new Date(t));
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const era = parts.find((p) => p.type === 'era')?.value ?? 'AD';
  const year = era === 'BC' || era === 'B' ? 1 - get('year') : get('year');
  const asUtc = new Date(0);
  asUtc.setUTCFullYear(year, get('month') - 1, get('day'));
  asUtc.setUTCHours(get('hour'), get('minute'), get('second'), 0);
  // The zone's wall clock has whole seconds; compare without the milliseconds.
  return asUtc.getTime() - (t - (((t % 1000) + 1000) % 1000));
}

function formatOffset(offsetMs: number): string {
  const sign = offsetMs < 0 ? '-' : '+';
  let s = Math.round(Math.abs(offsetMs) / 1000);
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${sign}${pad(h)}:${pad(m)}${s ? `:${pad(s)}` : ''}`;
}
