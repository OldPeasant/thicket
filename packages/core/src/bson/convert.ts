import { Decimal128 } from 'bson';

import { base64ToBytes, base64ToHex, hexToBase64 } from './ejson';
import { formatIsoDate, parseIsoDate } from './iso-date';
import {
  BINARY_SUBTYPE_UUID,
  BsonModelError,
  INT32_MAX,
  INT32_MIN,
  INT64_MAX,
  INT64_MIN,
  type BsonType,
  type BsonValue,
} from './model';

/**
 * Explicit type conversions (the type dropdown). A conversion either produces an exactly
 * corresponding value or throws a `ConversionError`; it never silently truncates or overflows.
 * `'uuid'` is a pseudo target: a Binary with subtype 4.
 */
export type ConversionTarget = BsonType | 'uuid';

export class ConversionError extends BsonModelError {
  constructor(
    readonly from: BsonType,
    readonly to: ConversionTarget,
    reason: string,
  ) {
    super(`Cannot convert ${from} to ${to}: ${reason}`);
  }
}

const HEX24 = /^[0-9a-fA-F]{24}$/;
const INT_TEXT = /^[+-]?\d+$/;
const NUMBER_TEXT = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const UUID_TEXT =
  /^[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}$/;

export function convert(value: BsonValue, to: ConversionTarget): BsonValue {
  const fail = (reason: string): never => {
    throw new ConversionError(value.type, to, reason);
  };
  if (value.type === to) return value;
  switch (to) {
    case 'string':
      return { type: 'string', value: toText(value, fail) };
    case 'objectId':
      if (value.type !== 'string') return fail('only strings convert to ObjectId');
      if (!HEX24.test(value.value)) return fail(`"${value.value}" is not 24 hex characters`);
      return { type: 'objectId', hex: value.value.toLowerCase() };
    case 'int': {
      const n = toInteger(value, fail);
      if (n < INT32_MIN || n > INT32_MAX) return fail(`${n} overflows Int32`);
      return { type: 'int', value: Number(n) };
    }
    case 'long': {
      const n = value.type === 'date' ? value.ms : toInteger(value, fail);
      if (n < INT64_MIN || n > INT64_MAX) return fail(`${n} overflows Int64`);
      return { type: 'long', value: n };
    }
    case 'double':
      return { type: 'double', value: toDouble(value, fail) };
    case 'decimal':
      return { type: 'decimal', value: toDecimal(value, fail) };
    case 'bool':
      return { type: 'bool', value: toBool(value, fail) };
    case 'date':
      return { type: 'date', ms: toDateMs(value, fail) };
    case 'uuid':
      return { type: 'binary', subtype: BINARY_SUBTYPE_UUID, base64: toUuidBase64(value, fail) };
    case 'binary':
      return fail('use the uuid target or edit the binary value');
    case 'regex':
      if (value.type !== 'string') return fail('only strings convert to Regex');
      return { type: 'regex', pattern: value.value, options: '' };
    case 'javascript':
      if (value.type !== 'string') return fail('only strings convert to Code');
      return { type: 'javascript', code: value.value };
    case 'object':
      if (value.type !== 'array') return fail('only arrays convert to documents');
      return {
        type: 'object',
        fields: value.items.map((item, i) => ({ key: String(i), value: item })),
      };
    case 'array':
      if (value.type !== 'object') return fail('only documents convert to arrays');
      return { type: 'array', items: value.fields.map((f) => f.value) };
    case 'timestamp':
      return fail('timestamps are created by the server');
    case 'null':
      return { type: 'null' };
    case 'minKey':
      return { type: 'minKey' };
    case 'maxKey':
      return { type: 'maxKey' };
    case 'undefined':
    case 'symbol':
    case 'dbPointer':
    case 'javascriptWithScope':
      return fail('deprecated types cannot be created');
  }
}

/** The UUID text (`xxxxxxxx-xxxx-…`) of a Binary subtype 4, or null for any other value. */
export function uuidOf(value: BsonValue): string | null {
  if (value.type !== 'binary' || value.subtype !== BINARY_SUBTYPE_UUID) return null;
  const hex = base64ToHex(value.base64);
  if (hex.length !== 32) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type Fail = (reason: string) => never;

function toText(value: BsonValue, fail: Fail): string {
  switch (value.type) {
    case 'objectId':
      return value.hex;
    case 'int':
    case 'long':
    case 'decimal':
      return String(value.value);
    case 'double':
      return Object.is(value.value, -0) ? '-0' : String(value.value);
    case 'bool':
      return String(value.value);
    case 'date':
      try {
        return formatIsoDate(value.ms);
      } catch (e) {
        return fail((e as Error).message);
      }
    case 'binary':
      return uuidOf(value) ?? fail('only UUID binaries convert to strings');
    case 'javascript':
      return value.code;
    case 'symbol':
      return value.value;
    case 'regex':
      return value.pattern;
    default:
      return fail('no text form');
  }
}

/** Exact integer value; fractional or non-numeric values fail. */
function toInteger(value: BsonValue, fail: Fail): bigint {
  switch (value.type) {
    case 'int':
      return BigInt(value.value);
    case 'long':
      return value.value;
    case 'bool':
      return value.value ? 1n : 0n;
    case 'double':
      if (!Number.isInteger(value.value)) return fail(`${value.value} is not an integer`);
      return BigInt(value.value);
    case 'decimal':
    case 'string': {
      const text = value.value.trim();
      if (INT_TEXT.test(text)) return BigInt(text);
      // Decimal128 integers in exponent form, e.g. "1.0E+3" or "1E+2"
      const decimal = value.type === 'decimal' ? decimalInteger(text) : null;
      return decimal ?? fail(`"${value.value}" is not an integer`);
    }
    default:
      return fail('not a number');
  }
}

function decimalInteger(text: string): bigint | null {
  const m = /^([+-]?)(\d+)(?:\.(\d+))?E([+-]\d+)$/.exec(text);
  if (!m) return null;
  const [, sign, int, frac = '', exp] = m;
  const shift = Number(exp) - frac.length;
  const digits = BigInt(int + frac);
  if (shift < 0) {
    const div = 10n ** BigInt(-shift);
    if (digits % div !== 0n) return null;
    return (sign === '-' ? -1n : 1n) * (digits / div);
  }
  return (sign === '-' ? -1n : 1n) * digits * 10n ** BigInt(shift);
}

function toDouble(value: BsonValue, fail: Fail): number {
  switch (value.type) {
    case 'int':
      return value.value;
    case 'long': {
      const n = Number(value.value);
      if (BigInt(n) !== value.value) return fail(`${value.value} is not exactly representable`);
      return n;
    }
    case 'bool':
      return value.value ? 1 : 0;
    case 'decimal': {
      const n = Number(value.value);
      if (!Number.isFinite(n) && !/Infinity|NaN/.test(value.value)) {
        return fail(`${value.value} overflows Double`);
      }
      return n;
    }
    case 'string': {
      const text = value.value.trim();
      if (!NUMBER_TEXT.test(text) && !/^(?:[+-]?Infinity|NaN)$/.test(text)) {
        return fail(`"${value.value}" is not a number`);
      }
      return Number(text);
    }
    default:
      return fail('not a number');
  }
}

function toDecimal(value: BsonValue, fail: Fail): string {
  let text: string;
  switch (value.type) {
    case 'int':
    case 'long':
      text = String(value.value);
      break;
    case 'double':
      text = Object.is(value.value, -0) ? '-0' : String(value.value);
      break;
    case 'string':
      text = value.value.trim();
      break;
    default:
      return fail('not a number');
  }
  try {
    return Decimal128.fromString(text).toString();
  } catch {
    return fail(`"${text}" is not a decimal`);
  }
}

function toBool(value: BsonValue, fail: Fail): boolean {
  switch (value.type) {
    case 'string':
      if (value.value === 'true') return true;
      if (value.value === 'false') return false;
      return fail(`"${value.value}" is not true or false`);
    case 'int':
    case 'double':
      return value.value !== 0;
    case 'long':
      return value.value !== 0n;
    default:
      return fail('not a boolean');
  }
}

function toDateMs(value: BsonValue, fail: Fail): bigint {
  switch (value.type) {
    case 'string':
      try {
        return parseIsoDate(value.value.trim());
      } catch (e) {
        return fail((e as Error).message);
      }
    case 'long':
      return value.value;
    case 'int':
      return BigInt(value.value);
    case 'objectId':
      return BigInt(parseInt(value.hex.slice(0, 8), 16)) * 1000n;
    default:
      return fail('not a date');
  }
}

function toUuidBase64(value: BsonValue, fail: Fail): string {
  if (value.type === 'string') {
    const text = value.value.trim();
    if (!UUID_TEXT.test(text)) return fail(`"${value.value}" is not a UUID`);
    return hexToBase64(text.replace(/-/g, '').toLowerCase());
  }
  if (value.type === 'binary') {
    if (value.subtype === BINARY_SUBTYPE_UUID) return value.base64;
    if (base64ToBytes(value.base64).length !== 16) return fail('a UUID has 16 bytes');
    return value.base64;
  }
  return fail('only strings and 16-byte binaries convert to UUID');
}
