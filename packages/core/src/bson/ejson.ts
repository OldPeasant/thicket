import { Decimal128, Double, EJSON } from 'bson';

import { parseIsoDate } from './iso-date';
import { parseJsonTree, type JsonNode } from './json-tree';
import {
  BsonModelError,
  INT32_MAX,
  INT32_MIN,
  INT64_MAX,
  INT64_MIN,
  UINT32_MAX,
  type BsonDocument,
  type BsonField,
  type BsonValue,
} from './model';

/**
 * Extended JSON v2 ⇄ model.
 *
 * `parseEJson` accepts canonical and relaxed EJSON v2. `stringifyEJson` always writes canonical
 * EJSON v2, so canonical text → model → text is byte-identical. Unlike `bson`'s `EJSON` (which goes
 * through JS objects) this keeps field order, repeated keys, Undefined and DBPointer intact; `bson`
 * is used for the Decimal128 and Double formats so the output matches its canonical EJSON.
 */

const INT_TEXT = /^-?\d+$/;
const DOUBLE_TEXT = /^(?:-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|-?Infinity|NaN)$/;
const HEX24 = /^[0-9a-fA-F]{24}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const HEX_BYTE = /^[0-9a-fA-F]{1,2}$/;
const UUID_TEXT =
  /^[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}$/;
const REGEX_OPTIONS = /^[imlsux]*$/;

/** Parses EJSON v2 text (canonical or relaxed) into a model value. */
export function parseEJson(text: string): BsonValue {
  return fromJsonNode(parseJsonTree(text));
}

/** Parses EJSON text whose top level must be a document. */
export function parseEJsonDocument(text: string): BsonDocument {
  const value = parseEJson(text);
  if (value.type !== 'object') throw new BsonModelError('Expected a document');
  return value;
}

// ---------------------------------------------------------------------------------------------
// Decoding

type Entries = readonly (readonly [string, JsonNode])[];

function invalid(wrapper: string, detail: string): never {
  throw new BsonModelError(`Invalid ${wrapper}: ${detail}`);
}

function stringOf(node: JsonNode | undefined, wrapper: string): string {
  if (node?.kind !== 'string') invalid(wrapper, 'expected a string');
  return node.value;
}

function uint32Of(node: JsonNode | undefined, wrapper: string): number {
  if (node?.kind !== 'number' || !INT_TEXT.test(node.raw)) invalid(wrapper, 'expected an integer');
  const n = Number(node.raw);
  if (n < 0 || n > UINT32_MAX) invalid(wrapper, 'out of the unsigned 32-bit range');
  return n;
}

/** Entries of `node` when it is an object with exactly the given keys (any order). */
function exactly(node: JsonNode | undefined, ...keys: string[]): Map<string, JsonNode> | null {
  if (node?.kind !== 'object' || node.entries.length !== keys.length) return null;
  const map = new Map(node.entries);
  return map.size === keys.length && keys.every((k) => map.has(k)) ? map : null;
}

function parseInt64(text: string, wrapper: string): bigint {
  if (!INT_TEXT.test(text)) invalid(wrapper, `"${text}" is not an integer`);
  const n = BigInt(text);
  if (n < INT64_MIN || n > INT64_MAX) invalid(wrapper, 'out of the 64-bit range');
  return n;
}

function parseObjectId(text: string, wrapper: string): string {
  if (!HEX24.test(text)) invalid(wrapper, `"${text}" is not 24 hex characters`);
  return text.toLowerCase();
}

function fromJsonNode(node: JsonNode): BsonValue {
  switch (node.kind) {
    case 'string':
      return { type: 'string', value: node.value };
    case 'bool':
      return { type: 'bool', value: node.value };
    case 'null':
      return { type: 'null' };
    case 'number':
      return fromJsonNumber(node.raw);
    case 'array':
      return { type: 'array', items: node.items.map(fromJsonNode) };
    case 'object':
      return fromWrapper(node.entries) ?? toDocument(node.entries);
  }
}

function toDocument(entries: Entries): BsonDocument {
  return {
    type: 'object',
    fields: entries.map(([key, value]): BsonField => ({ key, value: fromJsonNode(value) })),
  };
}

/** Relaxed-mode plain JSON numbers: smallest integer type that fits, Double otherwise. */
function fromJsonNumber(raw: string): BsonValue {
  if (INT_TEXT.test(raw) && raw !== '-0') {
    const n = BigInt(raw);
    if (n >= INT32_MIN && n <= INT32_MAX) return { type: 'int', value: Number(n) };
    if (n >= INT64_MIN && n <= INT64_MAX) return { type: 'long', value: n };
  }
  return { type: 'double', value: Number(raw) };
}

/** The typed value an EJSON type wrapper stands for, or null for an ordinary document. */
function fromWrapper(entries: Entries): BsonValue | null {
  const first = entries[0];
  if (!first?.[0].startsWith('$')) return null;
  const node: JsonNode = { kind: 'object', entries };
  const [key, value] = first;
  if (entries.length === 1) {
    switch (key) {
      case '$oid':
        return { type: 'objectId', hex: parseObjectId(stringOf(value, key), key) };
      case '$symbol':
        return { type: 'symbol', value: stringOf(value, key) };
      case '$code':
        return { type: 'javascript', code: stringOf(value, key) };
      case '$numberInt': {
        const text = stringOf(value, key);
        const n = INT_TEXT.test(text) ? Number(text) : NaN;
        if (!(n >= INT32_MIN && n <= INT32_MAX)) invalid(key, `"${text}" is not a 32-bit integer`);
        return { type: 'int', value: n === 0 ? 0 : n };
      }
      case '$numberLong':
        return { type: 'long', value: parseInt64(stringOf(value, key), key) };
      case '$numberDouble': {
        const text = stringOf(value, key);
        if (!DOUBLE_TEXT.test(text)) invalid(key, `"${text}" is not a number`);
        return { type: 'double', value: Number(text) };
      }
      case '$numberDecimal': {
        const text = stringOf(value, key);
        try {
          return { type: 'decimal', value: Decimal128.fromString(text).toString() };
        } catch {
          return invalid(key, `"${text}" is not a decimal`);
        }
      }
      case '$binary': {
        const b =
          exactly(value, 'base64', 'subType') ?? invalid(key, 'expected base64 and subType');
        return binary(stringOf(b.get('base64'), key), stringOf(b.get('subType'), key));
      }
      case '$uuid': {
        const text = stringOf(value, key);
        if (!UUID_TEXT.test(text)) invalid(key, `"${text}" is not a UUID`);
        return { type: 'binary', subtype: 4, base64: hexToBase64(text.replace(/-/g, '')) };
      }
      case '$date':
        return { type: 'date', ms: dateMs(value) };
      case '$timestamp': {
        const t = exactly(value, 't', 'i') ?? invalid(key, 'expected t and i');
        return { type: 'timestamp', t: uint32Of(t.get('t'), key), i: uint32Of(t.get('i'), key) };
      }
      case '$regularExpression': {
        const r = exactly(value, 'pattern', 'options') ?? invalid(key, 'expected pattern, options');
        const options = stringOf(r.get('options'), key);
        if (!REGEX_OPTIONS.test(options)) invalid(key, `invalid options "${options}"`);
        return {
          type: 'regex',
          pattern: stringOf(r.get('pattern'), key),
          options: [...options].sort().join(''),
        };
      }
      case '$dbPointer': {
        const p = exactly(value, '$ref', '$id') ?? invalid(key, 'expected $ref and $id');
        const id = exactly(p.get('$id'), '$oid') ?? invalid(key, '$id must be an ObjectId');
        return {
          type: 'dbPointer',
          ref: stringOf(p.get('$ref'), key),
          hex: parseObjectId(stringOf(id.get('$oid'), key), key),
        };
      }
      case '$minKey':
        if (value.kind !== 'number' || value.raw !== '1') invalid(key, 'expected 1');
        return { type: 'minKey' };
      case '$maxKey':
        if (value.kind !== 'number' || value.raw !== '1') invalid(key, 'expected 1');
        return { type: 'maxKey' };
      case '$undefined':
        if (value.kind !== 'bool' || !value.value) invalid(key, 'expected true');
        return { type: 'undefined' };
    }
    return null;
  }
  const cws = exactly(node, '$code', '$scope');
  if (cws) {
    const scope = fromJsonNode(cws.get('$scope') as JsonNode);
    if (scope.type !== 'object') invalid('$scope', 'expected a document');
    return { type: 'javascriptWithScope', code: stringOf(cws.get('$code'), '$code'), scope };
  }
  const legacyBinary = exactly(node, '$binary', '$type');
  if (legacyBinary) {
    return binary(
      stringOf(legacyBinary.get('$binary'), '$binary'),
      stringOf(legacyBinary.get('$type'), '$binary'),
    );
  }
  return null;
}

function binary(base64: string, subTypeHex: string): BsonValue {
  if (!BASE64.test(base64)) invalid('$binary', 'invalid base64');
  if (!HEX_BYTE.test(subTypeHex)) invalid('$binary', `invalid subType "${subTypeHex}"`);
  return { type: 'binary', subtype: parseInt(subTypeHex, 16), base64 };
}

function dateMs(node: JsonNode): bigint {
  if (node.kind === 'string') {
    try {
      return parseIsoDate(node.value);
    } catch (e) {
      return invalid('$date', (e as Error).message);
    }
  }
  if (node.kind === 'number' && INT_TEXT.test(node.raw)) return parseInt64(node.raw, '$date');
  const long = exactly(node, '$numberLong') ?? invalid('$date', 'expected $numberLong or ISO text');
  return parseInt64(stringOf(long.get('$numberLong'), '$date'), '$date');
}

// ---------------------------------------------------------------------------------------------
// Encoding

/**
 * Canonical EJSON v2 text. `space` indents like `JSON.stringify`'s third argument (type
 * wrappers stay on one line).
 */
export function stringifyEJson(value: BsonValue, space = 0): string {
  return write(value, ' '.repeat(Math.min(Math.max(space, 0), 10)), '');
}

function write(value: BsonValue, indent: string, current: string): string {
  switch (value.type) {
    case 'object':
      return container(
        value.fields.map((f) => [JSON.stringify(f.key), f.value] as const),
        '{',
        '}',
        indent,
        current,
      );
    case 'array':
      return container(
        value.items.map((v) => [null, v] as const),
        '[',
        ']',
        indent,
        current,
      );
    case 'javascriptWithScope':
      return `{"$code":${JSON.stringify(value.code)},"$scope":${write(value.scope, indent, current)}}`;
    default:
      return scalar(value);
  }
}

function container(
  parts: readonly (readonly [string | null, BsonValue])[],
  open: string,
  close: string,
  indent: string,
  current: string,
): string {
  if (parts.length === 0) return open + close;
  const inner = current + indent;
  const sep = indent ? ': ' : ':';
  const items = parts.map(([key, v]) => (key === null ? '' : key + sep) + write(v, indent, inner));
  return indent
    ? `${open}\n${inner}${items.join(`,\n${inner}`)}\n${current}${close}`
    : open + items.join(',') + close;
}

function scalar(value: Exclude<BsonValue, { type: 'object' | 'array' | 'javascriptWithScope' }>) {
  const q = JSON.stringify;
  switch (value.type) {
    case 'string':
      return q(value.value);
    case 'bool':
      return String(value.value);
    case 'null':
      return 'null';
    case 'int':
      return `{"$numberInt":"${value.value}"}`;
    case 'long':
      return `{"$numberLong":"${value.value}"}`;
    case 'double':
      return EJSON.stringify(new Double(value.value), { relaxed: false });
    case 'decimal':
      return `{"$numberDecimal":${q(value.value)}}`;
    case 'objectId':
      return `{"$oid":"${value.hex}"}`;
    case 'date':
      return `{"$date":{"$numberLong":"${value.ms}"}}`;
    case 'binary':
      return `{"$binary":{"base64":"${value.base64}","subType":"${value.subtype.toString(16).padStart(2, '0')}"}}`;
    case 'regex':
      return `{"$regularExpression":{"pattern":${q(value.pattern)},"options":${q(value.options)}}}`;
    case 'timestamp':
      return `{"$timestamp":{"t":${value.t},"i":${value.i}}}`;
    case 'javascript':
      return `{"$code":${q(value.code)}}`;
    case 'symbol':
      return `{"$symbol":${q(value.value)}}`;
    case 'dbPointer':
      return `{"$dbPointer":{"$ref":${q(value.ref)},"$id":{"$oid":"${value.hex}"}}}`;
    case 'undefined':
      return '{"$undefined":true}';
    case 'minKey':
      return '{"$minKey":1}';
    case 'maxKey':
      return '{"$maxKey":1}';
  }
}

// ---------------------------------------------------------------------------------------------
// Bytes (no Node Buffer: this runs in the renderer)

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function hexToBase64(hex: string): string {
  const bytes = Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
  return bytesToBase64(bytes);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a = 0, b = 0, c = 0] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    const n = (a << 16) | (b << 8) | c;
    out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63);
    out += i + 1 < bytes.length ? B64.charAt((n >> 6) & 63) : '=';
    out += i + 2 < bytes.length ? B64.charAt(n & 63) : '=';
  }
  return out;
}

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/=+$/, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let j = 0;
  for (const ch of clean) {
    acc = (acc << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[j++] = (acc >> bits) & 0xff;
    }
  }
  return bytes;
}

export function base64ToHex(base64: string): string {
  return Array.from(base64ToBytes(base64), (b) => b.toString(16).padStart(2, '0')).join('');
}
