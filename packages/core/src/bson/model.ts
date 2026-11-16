/**
 * Typed, order-preserving BSON value tree.
 *
 * Values are plain immutable objects (safe for signals and undo stacks). Lossless for every
 * BSON type: Int64 and Date milliseconds are `bigint`, Decimal128 keeps its canonical string
 * (including the exponent), Double keeps -0 and NaN/Infinity, documents keep their field order
 * and even repeated keys.
 */

/** A field of a document. Documents are arrays of fields, never JS objects (key order!). */
export interface BsonField {
  readonly key: string;
  readonly value: BsonValue;
}

export interface BsonDouble {
  readonly type: 'double';
  readonly value: number;
}
export interface BsonString {
  readonly type: 'string';
  readonly value: string;
}
export interface BsonDocument {
  readonly type: 'object';
  readonly fields: readonly BsonField[];
}
export interface BsonArray {
  readonly type: 'array';
  readonly items: readonly BsonValue[];
}
export interface BsonBinary {
  readonly type: 'binary';
  /** 0-255; 4 is UUID, 3 is legacy UUID. */
  readonly subtype: number;
  /** Payload as canonical (padded) base64. */
  readonly base64: string;
}
/** Deprecated: shown and kept, never created. */
export interface BsonUndefined {
  readonly type: 'undefined';
}
export interface BsonObjectId {
  readonly type: 'objectId';
  /** 24 lower-case hex characters. */
  readonly hex: string;
}
export interface BsonBoolean {
  readonly type: 'bool';
  readonly value: boolean;
}
export interface BsonDate {
  readonly type: 'date';
  /** Milliseconds since the Unix epoch (signed 64 bit, may exceed the JS `Date` range). */
  readonly ms: bigint;
}
export interface BsonNull {
  readonly type: 'null';
}
export interface BsonRegex {
  readonly type: 'regex';
  readonly pattern: string;
  /** Option letters, sorted alphabetically (canonical EJSON). */
  readonly options: string;
}
/** Deprecated: shown and kept, never created. */
export interface BsonDbPointer {
  readonly type: 'dbPointer';
  readonly ref: string;
  readonly hex: string;
}
export interface BsonCode {
  readonly type: 'javascript';
  readonly code: string;
}
/** Deprecated: shown and kept, never created. */
export interface BsonSymbol {
  readonly type: 'symbol';
  readonly value: string;
}
/** Deprecated: shown and kept, never created. */
export interface BsonCodeWithScope {
  readonly type: 'javascriptWithScope';
  readonly code: string;
  readonly scope: BsonDocument;
}
export interface BsonInt32 {
  readonly type: 'int';
  readonly value: number;
}
export interface BsonTimestamp {
  readonly type: 'timestamp';
  /** Seconds, unsigned 32 bit. */
  readonly t: number;
  /** Increment, unsigned 32 bit. */
  readonly i: number;
}
export interface BsonInt64 {
  readonly type: 'long';
  readonly value: bigint;
}
export interface BsonDecimal128 {
  readonly type: 'decimal';
  /** Canonical string as produced by `bson`'s `Decimal128#toString()`. */
  readonly value: string;
}
export interface BsonMinKey {
  readonly type: 'minKey';
}
export interface BsonMaxKey {
  readonly type: 'maxKey';
}

export type BsonValue =
  | BsonDouble
  | BsonString
  | BsonDocument
  | BsonArray
  | BsonBinary
  | BsonUndefined
  | BsonObjectId
  | BsonBoolean
  | BsonDate
  | BsonNull
  | BsonRegex
  | BsonDbPointer
  | BsonCode
  | BsonSymbol
  | BsonCodeWithScope
  | BsonInt32
  | BsonTimestamp
  | BsonInt64
  | BsonDecimal128
  | BsonMinKey
  | BsonMaxKey;

/** Type names, matching MongoDB's `$type` aliases. */
export type BsonType = BsonValue['type'];

export const BSON_TYPES: readonly BsonType[] = [
  'double',
  'string',
  'object',
  'array',
  'binary',
  'undefined',
  'objectId',
  'bool',
  'date',
  'null',
  'regex',
  'dbPointer',
  'javascript',
  'symbol',
  'javascriptWithScope',
  'int',
  'timestamp',
  'long',
  'decimal',
  'minKey',
  'maxKey',
];

/** Deprecated BSON types: displayed and preserved, but never created by a conversion or edit. */
export const DEPRECATED_TYPES: readonly BsonType[] = [
  'undefined',
  'symbol',
  'dbPointer',
  'javascriptWithScope',
];

export const BINARY_SUBTYPE_UUID = 4;

export const INT32_MIN = -0x8000_0000;
export const INT32_MAX = 0x7fff_ffff;
export const INT64_MIN = -(2n ** 63n);
export const INT64_MAX = 2n ** 63n - 1n;
export const UINT32_MAX = 0xffff_ffff;

/** Error for invalid values and invalid model operations. */
export class BsonModelError extends Error {
  override readonly name = 'BsonModelError';
}

export function doc(fields: readonly BsonField[] = []): BsonDocument {
  return { type: 'object', fields };
}

export function arr(items: readonly BsonValue[] = []): BsonArray {
  return { type: 'array', items };
}

export function str(value: string): BsonString {
  return { type: 'string', value };
}

export function int32(value: number): BsonInt32 {
  if (!Number.isInteger(value) || value < INT32_MIN || value > INT32_MAX) {
    throw new BsonModelError(`${value} is not a 32-bit integer`);
  }
  return { type: 'int', value: value === 0 ? 0 : value };
}

export function int64(value: bigint): BsonInt64 {
  if (value < INT64_MIN || value > INT64_MAX) {
    throw new BsonModelError(`${value} is outside the 64-bit integer range`);
  }
  return { type: 'long', value };
}

export function double(value: number): BsonDouble {
  return { type: 'double', value };
}

export function bool(value: boolean): BsonBoolean {
  return { type: 'bool', value };
}

export function nil(): BsonNull {
  return { type: 'null' };
}
