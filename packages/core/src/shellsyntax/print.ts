import { base64ToHex } from '../bson/ejson';
import { formatIsoDate } from '../bson/iso-date';
import { INT32_MAX, INT32_MIN, type BsonValue } from '../bson/model';
import { scanRegexBody } from './syntax';

export interface PrintOptions {
  /**
   * Spaces per nesting level. 0 (default) prints one line (`{ a: 1, b: [1, 2] }`); more prints
   * one field or item per line. Clamped to 0..10.
   */
  readonly indent?: number;
}

const BARE_KEY = /^[A-Za-z_$][\w$]*$/;
const LITERAL_FLAGS = /^[imsu]*$/;

/**
 * Prints a model value in mongosh shell syntax with stable formatting: `parseShellSyntax` reads
 * it back to the same value, and printing that again gives the same text.
 */
export function printShellSyntax(value: BsonValue, options: PrintOptions = {}): string {
  const indent = ' '.repeat(Math.min(Math.max(Math.trunc(options.indent ?? 0), 0), 10));
  return write(value, indent, '');
}

function write(value: BsonValue, indent: string, current: string): string {
  switch (value.type) {
    case 'object':
      return container(
        value.fields.map((f) => `${key(f.key)}: ${write(f.value, indent, current + indent)}`),
        '{',
        '}',
        indent,
        current,
      );
    case 'array':
      return container(
        value.items.map((v) => write(v, indent, current + indent)),
        '[',
        ']',
        indent,
        current,
      );
    case 'javascriptWithScope':
      return `Code(${q(value.code)}, ${write(value.scope, indent, current)})`;
    default:
      return scalar(value);
  }
}

function container(
  items: readonly string[],
  open: string,
  close: string,
  indent: string,
  current: string,
): string {
  if (items.length === 0) return open + close;
  if (indent) {
    const inner = current + indent;
    return `${open}\n${inner}${items.join(`,\n${inner}`)}\n${current}${close}`;
  }
  return open === '{' ? `{ ${items.join(', ')} }` : `[${items.join(', ')}]`;
}

const q = (s: string): string => JSON.stringify(s);

function key(k: string): string {
  return BARE_KEY.test(k) ? k : q(k);
}

function scalar(
  value: Exclude<BsonValue, { type: 'object' | 'array' | 'javascriptWithScope' }>,
): string {
  switch (value.type) {
    case 'string':
      return q(value.value);
    case 'bool':
      return String(value.value);
    case 'null':
      return 'null';
    case 'undefined':
      return 'undefined';
    case 'int':
      return String(value.value);
    case 'long':
      return Number.isSafeInteger(Number(value.value))
        ? `NumberLong(${value.value})`
        : `NumberLong(${q(String(value.value))})`;
    case 'double':
      return double(value.value);
    case 'decimal':
      return `NumberDecimal(${q(value.value)})`;
    case 'objectId':
      return `ObjectId(${q(value.hex)})`;
    case 'date':
      return date(value.ms);
    case 'binary':
      return binary(value.subtype, value.base64);
    case 'regex':
      return regex(value.pattern, value.options);
    case 'timestamp':
      return `Timestamp({ t: ${value.t}, i: ${value.i} })`;
    case 'javascript':
      return `Code(${q(value.code)})`;
    case 'symbol':
      return `BSONSymbol(${q(value.value)})`;
    case 'dbPointer':
      return `DBPointer(${q(value.ref)}, ObjectId(${q(value.hex)}))`;
    case 'minKey':
      return 'MinKey()';
    case 'maxKey':
      return 'MaxKey()';
  }
}

/** Plain literals read back as Int32 when integral and in range, so those need `Double(…)`. */
function double(v: number): string {
  if (Object.is(v, -0)) return '-0';
  if (Number.isInteger(v) && v >= INT32_MIN && v <= INT32_MAX) return `Double(${v})`;
  return String(v); // NaN, Infinity, -Infinity, shortest round-trip decimal otherwise
}

function date(ms: bigint): string {
  try {
    return `ISODate(${q(formatIsoDate(ms))})`;
  } catch {
    return `new Date(${ms})`; // beyond the JS Date range: keep the exact milliseconds
  }
}

function binary(subtype: number, base64: string): string {
  if (subtype === 4 && base64.length === 24) {
    const h = base64ToHex(base64);
    return `UUID("${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}")`;
  }
  return `BinData(${subtype}, ${q(base64)})`;
}

function regex(pattern: string, options: string): string {
  const literal = `/${pattern}/`;
  const fitsLiteral =
    LITERAL_FLAGS.test(options) &&
    pattern !== '' &&
    !pattern.startsWith('*') &&
    scanRegexBody(literal, 1) === pattern.length + 1;
  return fitsLiteral ? literal + options : `BSONRegExp(${q(pattern)}, ${q(options)})`;
}
