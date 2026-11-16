import {
  BINARY_SUBTYPE_UUID,
  ConversionError,
  INT32_MAX,
  INT32_MIN,
  INT64_MAX,
  INT64_MIN,
  UINT32_MAX,
  convert,
  parseIsoDate,
  uuidOf,
  type BsonValue,
  type ConversionTarget,
} from '@thicket/core/bson';

import {
  BsonLeaf,
  type BsonLeafValue,
  type DateDisplay,
  bsonTypeOf,
  formatDate,
  fromExplorerValue,
  isBsonLeaf,
  isContainer,
  systemTimeZone,
  toExplorerValue,
  zoneOffsetMs,
} from './bson-value.util';

// Parsing and checking what is typed into the typed BSON inputs, the type
// dropdown's conversions (bson-model's `convert`) and new-value defaults.
// Every parser either returns a value of exactly the type it is for or an
// error message: an edit never changes a value's type.

export type Parsed<T extends BsonLeafValue = BsonLeafValue> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

const ok = <T extends BsonLeafValue>(value: T): Parsed<T> => ({ ok: true, value });
const err = (error: string): Parsed<never> => ({ ok: false, error });

const INT_TEXT = /^[+-]?\d+$/;
const NUMBER_TEXT = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const HEX24 = /^[0-9a-fA-F]{24}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
/** Regex options MongoDB accepts. */
export const REGEX_OPTIONS = 'ilmsux';

export function parseInt32(text: string): Parsed<{ type: 'int'; value: number }> {
  const t = text.trim();
  if (!INT_TEXT.test(t)) return err(`"${text}" is not an integer`);
  const n = BigInt(t);
  if (n < BigInt(INT32_MIN) || n > BigInt(INT32_MAX)) {
    return err(`${t} overflows Int32 (${INT32_MIN} … ${INT32_MAX})`);
  }
  return ok({ type: 'int', value: Number(n) });
}

export function parseInt64(text: string): Parsed<{ type: 'long'; value: bigint }> {
  const t = text.trim();
  if (!INT_TEXT.test(t)) return err(`"${text}" is not an integer`);
  const n = BigInt(t);
  if (n < INT64_MIN || n > INT64_MAX)
    return err(`${t} overflows Int64 (${INT64_MIN} … ${INT64_MAX})`);
  return ok({ type: 'long', value: n });
}

/** A Double: any number text, `Infinity`, `-Infinity`, `NaN`; overflow to ±Infinity is an error. */
export function parseDouble(text: string): Parsed<{ type: 'double'; value: number }> {
  const t = text.trim();
  if (/^(?:[+-]?Infinity|NaN)$/.test(t)) return ok({ type: 'double', value: Number(t) });
  if (!NUMBER_TEXT.test(t)) return err(`"${text}" is not a number`);
  const n = Number(t);
  if (!Number.isFinite(n)) return err(`${t} overflows Double`);
  return ok({ type: 'double', value: n });
}

export function parseDecimal(text: string): Parsed<{ type: 'decimal'; value: string }> {
  return viaConvert(text.trim() === '' ? ' ' : text, 'decimal', 'is not a Decimal128');
}

export function parseObjectId(text: string): Parsed<{ type: 'objectId'; hex: string }> {
  const t = text.trim();
  if (!HEX24.test(t)) return err(`"${text}" is not an ObjectId (24 hex characters)`);
  return ok({ type: 'objectId', hex: t.toLowerCase() });
}

export function parseUuid(
  text: string,
): Parsed<{ type: 'binary'; subtype: number; base64: string }> {
  return viaConvert(text, 'uuid', 'is not a UUID');
}

export function parseBinary(
  subtypeText: string,
  base64Text: string,
): Parsed<{ type: 'binary'; subtype: number; base64: string }> {
  const sub = subtypeText.trim();
  const subtype = /^0x[0-9a-fA-F]{1,2}$/.test(sub)
    ? parseInt(sub, 16)
    : /^\d{1,3}$/.test(sub)
      ? Number(sub)
      : NaN;
  if (!(subtype >= 0 && subtype <= 255)) return err(`"${subtypeText}" is not a subtype (0 … 255)`);
  const base64 = base64Text.replace(/\s+/g, '');
  if (!BASE64.test(base64)) return err('not base64 (A-Z, a-z, 0-9, +, /, padded with =)');
  return ok({ type: 'binary', subtype, base64 });
}

/** A regex; options are checked against MongoDB's set and stored sorted. */
export function parseRegex(
  pattern: string,
  options: string,
): Parsed<{ type: 'regex'; pattern: string; options: string }> {
  const letters = options.trim().split('');
  const bad = letters.filter((c) => !REGEX_OPTIONS.includes(c));
  if (bad.length) return err(`unknown regex option "${bad.join('')}" (allowed: ${REGEX_OPTIONS})`);
  if (new Set(letters).size !== letters.length) return err('a regex option is repeated');
  if (pattern.includes('\0')) return err('a regex pattern cannot contain a NUL character');
  return ok({ type: 'regex', pattern, options: letters.sort().join('') });
}

export function parseTimestamp(
  tText: string,
  iText: string,
): Parsed<{ type: 'timestamp'; t: number; i: number }> {
  const part = (text: string, name: string): number | string => {
    const s = text.trim();
    if (!/^\d+$/.test(s)) return `${name} "${text}" is not an unsigned integer`;
    const n = Number(s);
    return n > UINT32_MAX ? `${name} ${s} overflows 32 bits (max ${UINT32_MAX})` : n;
  };
  const t = part(tText, 'seconds');
  if (typeof t === 'string') return err(t);
  const i = part(iText, 'increment');
  if (typeof i === 'string') return err(i);
  return ok({ type: 'timestamp', t, i });
}

const WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
/** An offset with seconds (local mean time, as `formatDate` writes it), e.g. `+00:34:08`. */
const SECONDS_OFFSET = /^(.+T.+)([+-])(\d{2}):(\d{2}):(\d{2})$/;

/**
 * A date from ISO text: with `Z` or an offset (`±HH:MM`, or `±HH:MM:SS` as
 * shown for local mean time) as is, a trailing zone name (as the explorer
 * shows it) ignored; a date-time without offset is wall time in the zone dates
 * are shown in (UTC or local); a date alone is UTC midnight. A bare integer is
 * milliseconds since 1970 (how dates outside the JS date range are shown).
 */
export function parseDate(text: string, dates: DateDisplay): Parsed<{ type: 'date'; ms: bigint }> {
  const t = text.trim().replace(/\s+[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/, '');
  if (INT_TEXT.test(t)) {
    const ms = BigInt(t);
    if (ms < INT64_MIN || ms > INT64_MAX) return err(`${t} ms overflows a Date (Int64)`);
    return ok({ type: 'date', ms });
  }
  if (WALL_TIME.test(t)) {
    const ms = wallTimeToMs(t, dates);
    return ms === null ? err(`"${text}" is not a valid date`) : ok({ type: 'date', ms });
  }
  try {
    const lmt = SECONDS_OFFSET.exec(t);
    if (lmt) {
      const [, base = '', sign, h, m, s] = lmt;
      if (Number(h) >= 24 || Number(m) >= 60 || Number(s) >= 60) throw new Error('offset');
      const offsetMs = (Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1000;
      return ok({
        type: 'date',
        ms: parseIsoDate(`${base}Z`) - BigInt(sign === '-' ? -offsetMs : offsetMs),
      });
    }
    return ok({ type: 'date', ms: parseIsoDate(t) });
  } catch {
    return err(`"${text}" is not an ISO-8601 date`);
  }
}

/**
 * Epoch ms of a `YYYY-MM-DDTHH:mm[:ss[.sss]]` wall time (a `datetime-local`
 * input's value) in the display zone; null for impossible dates.
 */
export function wallTimeToMs(wall: string, dates: DateDisplay): bigint | null {
  const m = WALL_TIME.exec(wall);
  if (!m) return null;
  let asUtc: bigint;
  try {
    const [, y, mo, d, h, mi, s = '00', frac = ''] = m;
    asUtc = parseIsoDate(`${y}-${mo}-${d}T${h}:${mi}:${s}.${frac.padEnd(3, '0')}Z`);
  } catch {
    return null;
  }
  if (dates.utc) return asUtc;
  const zone = dates.timeZone ?? systemTimeZone();
  const wallMs = Number(asUtc);
  // The offset at the instant, not at the wall time read as UTC (they differ
  // near a DST change): one correction step.
  const first = zoneOffsetMs(wallMs, zone);
  const offset = zoneOffsetMs(wallMs - first, zone);
  return BigInt(wallMs - offset);
}

/** The `datetime-local` value (`YYYY-MM-DDTHH:mm:ss.sss`) for a date, or '' outside its range. */
export function dateToWallTime(ms: bigint, dates: DateDisplay): string {
  const text = formatDate(ms, dates);
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3})/.exec(text);
  return m?.[1] ?? '';
}

/** A new ObjectId: 4 bytes seconds, 5 random bytes, 3-byte counter (as the drivers make them). */
export function generateObjectId(
  now: number = Date.now(),
  random: (bytes: Uint8Array<ArrayBuffer>) => void = (b) => globalThis.crypto.getRandomValues(b),
): { type: 'objectId'; hex: string } {
  const bytes = new Uint8Array(8);
  random(bytes);
  counter = (counter + 1) % 0x100_0000;
  const hex = (n: number, width: number): string => n.toString(16).padStart(width, '0');
  const rand = Array.from(bytes.slice(0, 5), (b) => hex(b, 2)).join('');
  const seconds = Math.floor(now / 1000) >>> 0;
  return { type: 'objectId', hex: hex(seconds, 8) + rand + hex(counter, 6) };
}

let counter = Math.floor(Math.random() * 0x100_0000);

/** The text an input shows for a single-text value. */
export function editText(value: BsonLeafValue, dates: DateDisplay): string {
  switch (value.type) {
    case 'int':
      return String(value.value);
    case 'long':
      return value.value.toString();
    case 'double':
      return Object.is(value.value, -0) ? '-0' : String(value.value);
    case 'decimal':
      return value.value;
    case 'objectId':
      return value.hex;
    case 'date':
      return formatDate(value.ms, dates).replace(/ ms since 1970 \(out of date range\)$/, '');
    case 'javascript':
      return value.code;
    case 'binary':
      return uuidOf(value) ?? value.base64;
    default:
      return '';
  }
}

function viaConvert<T extends BsonLeafValue>(
  text: string,
  to: ConversionTarget,
  what: string,
): Parsed<T> {
  try {
    return ok(convert({ type: 'string', value: text }, to) as T);
  } catch (e) {
    if (e instanceof ConversionError) return err(`"${text.trim()}" ${what}`);
    throw e;
  }
}

// --- the type dropdown ---

export const TARGET_LABELS: Readonly<Record<CreatableTarget, string>> = {
  string: 'String',
  int: 'Int32',
  long: 'Int64',
  double: 'Double',
  decimal: 'Decimal128',
  bool: 'Boolean',
  date: 'Date',
  objectId: 'ObjectId',
  uuid: 'UUID',
  binary: 'Binary',
  regex: 'Regex',
  javascript: 'Code',
  timestamp: 'Timestamp',
  object: 'Object',
  array: 'Array',
  null: 'Null',
  minKey: 'MinKey',
  maxKey: 'MaxKey',
};

/** Types the dropdown can make (the deprecated ones never). */
export type CreatableTarget = Exclude<
  ConversionTarget,
  'undefined' | 'symbol' | 'dbPointer' | 'javascriptWithScope'
>;

export const CREATABLE_TARGETS = Object.keys(TARGET_LABELS) as CreatableTarget[];

export interface TypeOption {
  readonly target: CreatableTarget;
  readonly label: string;
  /** False when this value can't become that type (`reason` says why). */
  readonly enabled: boolean;
  readonly reason?: string;
}

/** The dropdown entry a value currently is: `uuid` for a UUID binary, else its BSON type. */
export function currentTarget(value: unknown): ConversionTarget {
  if (isBsonLeaf(value) && uuidOf(value.bson) !== null) return 'uuid';
  return bsonTypeOf(value);
}

/**
 * Values with nothing to lose (null, MinKey, MaxKey, '', {} and []): any type
 * may replace them with its empty value, even where no conversion exists, so
 * a new field (added as '') can become any type.
 */
export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  if (isBsonLeaf(value)) return value.bson.type === 'minKey' || value.bson.type === 'maxKey';
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === 'object' && Object.keys(value).length === 0;
}

/**
 * The value after choosing `target` in the dropdown: bson-model's conversion,
 * or, for an empty value the conversion table has no entry for, the target's
 * empty value. Throws `ConversionError` when neither applies.
 */
export function convertValue(value: unknown, target: CreatableTarget): unknown {
  const from = fromExplorerValue(value);
  try {
    const converted = convert(from, target);
    if (converted === from && currentTarget(value) !== target) {
      throw new ConversionError(from.type, target, 'it already is one; edit its subtype instead');
    }
    return toExplorerValue(converted);
  } catch (e) {
    if (e instanceof ConversionError && isEmptyValue(value))
      return toExplorerValue(emptyOf(target));
    throw e;
  }
}

/** Every creatable type, enabled when `value` can become it. */
export function typeOptions(value: unknown): TypeOption[] {
  const current = currentTarget(value);
  // Whether a document or array converts depends on its type alone
  // (bson-model's table never looks inside): try an empty one instead of
  // copying the whole subtree for every target.
  const shell: BsonValue | undefined =
    isContainer(value) && !isEmptyValue(value)
      ? Array.isArray(value)
        ? { type: 'array', items: [] }
        : { type: 'object', fields: [] }
      : undefined;
  return CREATABLE_TARGETS.map((target) => {
    const label = TARGET_LABELS[target];
    if (target === current) return { target, label, enabled: true };
    try {
      if (shell) convert(shell, target);
      else convertValue(value, target);
      return { target, label, enabled: true };
    } catch (e) {
      if (!(e instanceof ConversionError)) throw e;
      return { target, label, enabled: false, reason: e.message };
    }
  });
}

/** The empty value of a type (what a new value of that type starts as). */
export function emptyOf(target: CreatableTarget): BsonValue {
  switch (target) {
    case 'string':
      return { type: 'string', value: '' };
    case 'int':
      return { type: 'int', value: 0 };
    case 'long':
      return { type: 'long', value: 0n };
    case 'double':
      return { type: 'double', value: 0 };
    case 'decimal':
      return { type: 'decimal', value: '0' };
    case 'bool':
      return { type: 'bool', value: false };
    case 'date':
      return { type: 'date', ms: BigInt(Date.now()) };
    case 'objectId':
      return generateObjectId();
    case 'uuid': {
      const bytes = new Uint8Array(16);
      globalThis.crypto.getRandomValues(bytes);
      bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
      bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
      return {
        type: 'binary',
        subtype: BINARY_SUBTYPE_UUID,
        base64: btoa(String.fromCharCode(...bytes)),
      };
    }
    case 'binary':
      return { type: 'binary', subtype: 0, base64: '' };
    case 'regex':
      return { type: 'regex', pattern: '', options: '' };
    case 'javascript':
      return { type: 'javascript', code: '' };
    case 'timestamp':
      return { type: 'timestamp', t: 0, i: 0 };
    case 'object':
      return { type: 'object', fields: [] };
    case 'array':
      return { type: 'array', items: [] };
    case 'null':
      return { type: 'null' };
    case 'minKey':
      return { type: 'minKey' };
    case 'maxKey':
      return { type: 'maxKey' };
  }
}

/**
 * A blank value of the same type (new rows shaped like existing ones): numbers
 * 0, strings of code '', new ObjectIds and UUIDs; deprecated types become null.
 */
export function blankBson(value: BsonLeafValue): BsonLeafValue {
  const target = currentTarget(new BsonLeaf(value));
  if (!(CREATABLE_TARGETS as readonly string[]).includes(target)) return { type: 'null' };
  if (value.type === 'binary' && target === 'binary') return { ...value, base64: '' };
  return emptyOf(target as CreatableTarget) as BsonLeafValue;
}

// --- new numbers ---

// `newNumber` lives with `fromExplorerValue`, which applies it to plain numbers.
export { type IntegerDefault, newNumber } from './bson-value.util';
