import { Decimal128, ObjectId, UUID } from 'bson';

import { base64ToBytes, bytesToBase64, hexToBase64 } from '../bson/ejson';
import { parseIsoDate } from '../bson/iso-date';
import {
  INT32_MAX,
  INT32_MIN,
  INT64_MAX,
  INT64_MIN,
  UINT32_MAX,
  type BsonDocument,
  type BsonValue,
} from '../bson/model';
import { ShellSyntaxError } from './errors';
import type { Node, NumberNode } from './syntax';

const HEX24 = /^[0-9a-fA-F]{24}$/;
const HEX = /^(?:[0-9a-fA-F]{2})*$/;
const INT_TEXT = /^[+-]?\d+$/;
const DOUBLE_TEXT = /^[+-]?(?:(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|Infinity)$|^NaN$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const UUID_TEXT =
  /^[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}$/;
/** Flags of JS regex literals and `RegExp(…)` that MongoDB knows. */
const JS_REGEX_FLAGS = /^[imsu]*$/;
const BSON_REGEX_OPTIONS = /^[imlsux]*$/;

type Fail = (reason: string, node: Node) => never;

interface Context {
  readonly fail: Fail;
  readonly value: (node: Node) => BsonValue;
}

type Constructor = (args: readonly Node[], call: Node, ctx: Context) => BsonValue;

/** Maps a syntax tree to the BSON model; errors point at the offending node. */
export function toBsonValue(root: Node, text: string): BsonValue {
  const fail: Fail = (reason, node) => {
    throw new ShellSyntaxError(reason, text, node.pos);
  };
  const value = (node: Node): BsonValue => {
    switch (node.kind) {
      case 'object':
        return {
          type: 'object',
          fields: node.entries.map((e) => ({ key: e.key, value: value(e.value) })),
        };
      case 'array':
        return { type: 'array', items: node.items.map(value) };
      case 'string':
        return { type: 'string', value: node.value };
      case 'number':
        if (node.bigint && (node.exact ?? 0n) !== BigInt.asIntN(64, node.exact ?? 0n)) {
          return fail(`${node.text} is outside the 64-bit integer range`, node);
        }
        return numberValue(node);
      case 'regex':
        return regex(node.pattern, node.flags, JS_REGEX_FLAGS, node, fail);
      case 'word':
        return wordValue(node.name);
      case 'call': {
        const ctor = CONSTRUCTORS.get(node.name);
        if (!ctor) {
          return fail(
            `Unknown function "${node.name}"; allowed are ${[...CONSTRUCTORS.keys()].join(', ')}`,
            node,
          );
        }
        return ctor(node.args, node, ctx);
      }
    }
  };
  const ctx: Context = { fail, value };
  return value(root);
}

/** A JS number as mongosh stores it: Int32 if it is an integer that fits, Double otherwise. */
function numberValue(node: NumberNode): BsonValue {
  if (node.bigint) return { type: 'long', value: node.exact ?? 0n };
  const v = node.value;
  if (Number.isInteger(v) && v >= INT32_MIN && v <= INT32_MAX && !Object.is(v, -0)) {
    return { type: 'int', value: v };
  }
  return { type: 'double', value: v };
}

function wordValue(name: string): BsonValue {
  switch (name) {
    case 'true':
    case 'false':
      return { type: 'bool', value: name === 'true' };
    case 'null':
      return { type: 'null' };
    case 'undefined':
      return { type: 'undefined' };
    case 'NaN':
      return { type: 'double', value: NaN };
    case 'Infinity':
      return { type: 'double', value: Infinity };
    case 'MinKey':
      return { type: 'minKey' };
    default:
      return { type: 'maxKey' };
  }
}

function regex(pattern: string, flags: string, allowed: RegExp, node: Node, fail: Fail): BsonValue {
  if (!allowed.test(flags)) fail(`Unsupported regular expression flags "${flags}"`, node);
  const sorted = [...flags].sort();
  if (sorted.some((f, i) => f === sorted[i - 1])) fail(`Repeated regular expression flag`, node);
  return { type: 'regex', pattern, options: sorted.join('') };
}

// ---------------------------------------------------------------------------------------------
// Constructors

function args(
  call: Node,
  list: readonly Node[],
  min: number,
  max: number,
  fail: Fail,
): readonly Node[] {
  if (list.length < min || list.length > max) {
    const name = call.kind === 'call' ? call.name : 'value';
    const expected = min === max ? `${min}` : `${min} to ${max}`;
    fail(
      `${name}() takes ${expected} argument${expected === '1' ? '' : 's'}, got ${list.length}`,
      call,
    );
  }
  return list;
}

function stringArg(node: Node | undefined, what: string, fail: Fail, call: Node): string {
  if (node?.kind !== 'string') return fail(`Expected ${what} as a string`, node ?? call);
  return node.value;
}

/** An integer argument given as a number or a string, exactly. */
function integerArg(node: Node, what: string, fail: Fail): bigint {
  if (node.kind === 'string') {
    if (!INT_TEXT.test(node.value.trim())) fail(`"${node.value}" is not an integer`, node);
    return BigInt(node.value.trim());
  }
  if (node.kind !== 'number') return fail(`Expected ${what} as a number`, node);
  if (node.exact !== null) return node.exact;
  if (!Number.isSafeInteger(node.value)) fail(`${node.text || node.value} is not an integer`, node);
  return BigInt(node.value);
}

function rangedInt(node: Node, what: string, min: bigint, max: bigint, fail: Fail): bigint {
  const n = integerArg(node, what, fail);
  if (n < min || n > max) fail(`${what} ${n} is out of range (${min} to ${max})`, node);
  return n;
}

function objectIdHex(node: Node | undefined, fail: Fail, call: Node): string {
  const hex = stringArg(node, 'a 24-character hex ObjectId', fail, call);
  if (!HEX24.test(hex)) fail(`"${hex}" is not 24 hex characters`, node ?? call);
  return hex.toLowerCase();
}

function base64Binary(node: Node | undefined, subtype: number, fail: Fail, call: Node): BsonValue {
  const b64 = stringArg(node, 'base64 data', fail, call);
  if (!BASE64.test(b64)) fail('Invalid base64 data', node ?? call);
  return { type: 'binary', subtype, base64: bytesToBase64(base64ToBytes(b64)) };
}

function hexBinary(node: Node | undefined, subtype: number, fail: Fail, call: Node): BsonValue {
  const hex = stringArg(node, 'hex data', fail, call);
  if (!HEX.test(hex)) fail('Invalid hex data', node ?? call);
  return { type: 'binary', subtype, base64: hexToBase64(hex) };
}

function subtypeArg(node: Node | undefined, fail: Fail): number {
  return node === undefined ? 0 : Number(rangedInt(node, 'Binary subtype', 0n, 255n, fail));
}

const objectId: Constructor = (list, call, { fail }) => {
  const [hex] = args(call, list, 0, 1, fail);
  return {
    type: 'objectId',
    hex: hex ? objectIdHex(hex, fail, call) : new ObjectId().toHexString(),
  };
};

const date: Constructor = (list, call, { fail }) => {
  const [arg] = args(call, list, 0, 1, fail);
  if (!arg) return { type: 'date', ms: BigInt(Date.now()) };
  if (arg.kind === 'number')
    return { type: 'date', ms: rangedInt(arg, 'Date', INT64_MIN, INT64_MAX, fail) };
  const text = stringArg(arg, 'an ISO-8601 date', fail, call);
  try {
    return { type: 'date', ms: parseIsoDate(text) };
  } catch (e) {
    return fail((e as Error).message, arg);
  }
};

const long: Constructor = (list, call, { fail }) => {
  const [arg] = args(call, list, 1, 1, fail) as [Node];
  return { type: 'long', value: rangedInt(arg, 'NumberLong', INT64_MIN, INT64_MAX, fail) };
};

const int: Constructor = (list, call, { fail }) => {
  const [arg] = args(call, list, 1, 1, fail) as [Node];
  const n = rangedInt(arg, 'NumberInt', BigInt(INT32_MIN), BigInt(INT32_MAX), fail);
  return { type: 'int', value: Number(n) };
};

const decimal: Constructor = (list, call, { fail }) => {
  const [arg] = args(call, list, 1, 1, fail) as [Node];
  let text: string;
  if (arg.kind === 'number') text = arg.text || String(arg.value);
  else text = stringArg(arg, 'a decimal', fail, call).trim();
  // bson accepts hex for numbers only via Number(); keep that exact for 0x… integer literals.
  if (arg.kind === 'number' && arg.exact !== null) text = String(arg.exact);
  try {
    return { type: 'decimal', value: Decimal128.fromString(text).toString() };
  } catch {
    return fail(`"${text}" is not a valid Decimal128`, arg);
  }
};

const doubleCtor: Constructor = (list, call, { fail }) => {
  const [arg] = args(call, list, 1, 1, fail) as [Node];
  if (arg.kind === 'number') return { type: 'double', value: arg.value };
  const text = stringArg(arg, 'a number', fail, call).trim();
  if (!DOUBLE_TEXT.test(text)) fail(`"${text}" is not a number`, arg);
  return { type: 'double', value: Number(text) };
};

const uuid: Constructor = (list, call, { fail }) => {
  const [arg] = args(call, list, 0, 1, fail);
  if (!arg) return { type: 'binary', subtype: 4, base64: new UUID().toString('base64') };
  const text = stringArg(arg, 'a UUID', fail, call);
  if (!UUID_TEXT.test(text)) fail(`"${text}" is not a UUID`, arg);
  return { type: 'binary', subtype: 4, base64: hexToBase64(text.replace(/-/g, '')) };
};

const binData: Constructor = (list, call, { fail }) => {
  const [sub, data] = args(call, list, 2, 2, fail) as [Node, Node];
  return base64Binary(data, subtypeArg(sub, fail), fail, call);
};

const hexData: Constructor = (list, call, { fail }) => {
  const [sub, data] = args(call, list, 2, 2, fail) as [Node, Node];
  return hexBinary(data, subtypeArg(sub, fail), fail, call);
};

const md5: Constructor = (list, call, { fail }) => {
  const [data] = args(call, list, 1, 1, fail) as [Node];
  const value = hexBinary(data, 5, fail, call);
  if (stringArg(data, 'hex data', fail, call).length !== 32) fail('MD5 needs 32 hex digits', data);
  return value;
};

const timestamp: Constructor = (list, call, { fail }) => {
  args(call, list, 0, 2, fail);
  const u32 = (n: Node, what: string) => Number(rangedInt(n, what, 0n, BigInt(UINT32_MAX), fail));
  if (list.length === 0) return { type: 'timestamp', t: 0, i: 0 };
  if (list.length === 2) {
    return {
      type: 'timestamp',
      t: u32(list[0] as Node, 'Timestamp t'),
      i: u32(list[1] as Node, 'Timestamp i'),
    };
  }
  const obj = list[0] as Node;
  const t = obj.kind === 'object' ? obj.entries.find((e) => e.key === 't') : undefined;
  const i = obj.kind === 'object' ? obj.entries.find((e) => e.key === 'i') : undefined;
  if (obj.kind !== 'object' || !t || !i || obj.entries.length !== 2) {
    return fail('Expected Timestamp({ t: <seconds>, i: <increment> }) or Timestamp(t, i)', obj);
  }
  return { type: 'timestamp', t: u32(t.value, 'Timestamp t'), i: u32(i.value, 'Timestamp i') };
};

const regExp =
  (allowed: RegExp): Constructor =>
  (list, call, { fail }) => {
    const [pattern, flags] = args(call, list, 1, 2, fail) as [Node, Node | undefined];
    const p = stringArg(pattern, 'a pattern', fail, call);
    const f = flags ? stringArg(flags, 'options', fail, call) : '';
    return regex(p, f, allowed, flags ?? call, fail);
  };

const code: Constructor = (list, call, { fail, value }) => {
  const [src, scope] = args(call, list, 1, 2, fail) as [Node, Node | undefined];
  const text = stringArg(src, 'JavaScript code', fail, call);
  if (!scope) return { type: 'javascript', code: text };
  const s = value(scope);
  if (s.type !== 'object') return fail('Expected the scope as a document', scope);
  return { type: 'javascriptWithScope', code: text, scope: s };
};

const symbol: Constructor = (list, call, { fail }) => {
  const [arg] = args(call, list, 1, 1, fail) as [Node];
  return { type: 'symbol', value: stringArg(arg, 'the symbol', fail, call) };
};

const dbPointer: Constructor = (list, call, { fail, value }) => {
  const [ns, id] = args(call, list, 2, 2, fail) as [Node, Node];
  const ref = stringArg(ns, 'the namespace', fail, call);
  const oid = value(id);
  if (oid.type !== 'objectId') return fail('Expected an ObjectId', id);
  return { type: 'dbPointer', ref, hex: oid.hex };
};

const dbRef: Constructor = (list, call, { fail, value }) => {
  const [coll, id, db] = args(call, list, 2, 3, fail) as [Node, Node, Node | undefined];
  const fields: BsonDocument['fields'][number][] = [
    {
      key: '$ref',
      value: { type: 'string', value: stringArg(coll, 'the collection', fail, call) },
    },
    { key: '$id', value: value(id) },
  ];
  if (db)
    fields.push({
      key: '$db',
      value: { type: 'string', value: stringArg(db, 'the database', fail, call) },
    });
  return { type: 'object', fields };
};

const key =
  (type: 'minKey' | 'maxKey'): Constructor =>
  (list, call, { fail }) => {
    args(call, list, 0, 0, fail);
    return { type };
  };

const fromBase64: Constructor = (list, call, { fail }) => {
  const [data, sub] = args(call, list, 1, 2, fail) as [Node, Node | undefined];
  return base64Binary(data, subtypeArg(sub, fail), fail, call);
};

const fromHex: Constructor = (list, call, { fail }) => {
  const [data, sub] = args(call, list, 1, 2, fail) as [Node, Node | undefined];
  return hexBinary(data, subtypeArg(sub, fail), fail, call);
};

const objectIdFromHex: Constructor = (list, call, ctx) => {
  args(call, list, 1, 1, ctx.fail);
  return objectId(list, call, ctx);
};

/** The only callable names; anything else is refused. `new` is optional for all of them. */
const CONSTRUCTORS: ReadonlyMap<string, Constructor> = new Map([
  ['ObjectId', objectId],
  ['ObjectId.createFromHexString', objectIdFromHex],
  ['ISODate', date],
  ['Date', date],
  ['NumberLong', long],
  ['Long', long],
  ['NumberInt', int],
  ['Int32', int],
  ['NumberDecimal', decimal],
  ['Decimal128', decimal],
  ['Double', doubleCtor],
  ['UUID', uuid],
  ['BinData', binData],
  ['HexData', hexData],
  ['MD5', md5],
  ['Binary.createFromBase64', fromBase64],
  ['Binary.createFromHexString', fromHex],
  ['Timestamp', timestamp],
  ['RegExp', regExp(JS_REGEX_FLAGS)],
  ['BSONRegExp', regExp(BSON_REGEX_OPTIONS)],
  ['Code', code],
  ['BSONSymbol', symbol],
  ['DBPointer', dbPointer],
  ['DBRef', dbRef],
  ['MinKey', key('minKey')],
  ['MaxKey', key('maxKey')],
]);
