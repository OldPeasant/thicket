import { EJSON } from 'bson';
import { describe, expect, it } from 'vitest';

import { parseEJson, parseEJsonDocument, stringifyEJson } from './ejson';
import type { BsonDocument, BsonValue } from './model';

/** One field per BSON type and edge case, in canonical EJSON v2 as `bson` writes it. */
const FIELDS: readonly (readonly [string, string])[] = [
  ['_id', '{"$oid":"5f1d7a3e9c1b2a0012345678"}'],
  ['double', '{"$numberDouble":"3.14"}'],
  ['doubleIntegral', '{"$numberDouble":"1.0"}'],
  ['negativeZero', '{"$numberDouble":"-0.0"}'],
  ['nan', '{"$numberDouble":"NaN"}'],
  ['infinity', '{"$numberDouble":"Infinity"}'],
  ['negativeInfinity', '{"$numberDouble":"-Infinity"}'],
  ['hugeDouble', '{"$numberDouble":"1e+21"}'],
  ['tinyDouble', '{"$numberDouble":"5e-324"}'],
  ['string', JSON.stringify('héllo "quoted" \n ☃ \\ \u0001')],
  ['object', '{"a":{"$numberInt":"1"},"b":{"c":"d"}}'],
  ['array', '[{"$numberInt":"1"},"x",null,[],{}]'],
  ['binaryGeneric', '{"$binary":{"base64":"AQID","subType":"00"}}'],
  ['binaryFunction', '{"$binary":{"base64":"AQ==","subType":"01"}}'],
  ['binaryOld', '{"$binary":{"base64":"AAAAAA==","subType":"02"}}'],
  ['uuidLegacy', '{"$binary":{"base64":"D4+tW9nLRp+hZXCGdyiVDg==","subType":"03"}}'],
  ['uuid', '{"$binary":{"base64":"D4+tW9nLRp+hZXCGdyiVDg==","subType":"04"}}'],
  ['md5', '{"$binary":{"base64":"1B2M2Y8AsgTpgAmY7PhCfg==","subType":"05"}}'],
  ['encrypted', '{"$binary":{"base64":"","subType":"06"}}'],
  ['column', '{"$binary":{"base64":"AA==","subType":"07"}}'],
  ['sensitive', '{"$binary":{"base64":"AA==","subType":"08"}}'],
  ['vector', '{"$binary":{"base64":"EAA=","subType":"09"}}'],
  ['userDefined', '{"$binary":{"base64":"/w==","subType":"80"}}'],
  ['undefined', '{"$undefined":true}'],
  ['true', 'true'],
  ['false', 'false'],
  ['date', '{"$date":{"$numberLong":"1700000000000"}}'],
  ['dateBeforeEpoch', '{"$date":{"$numberLong":"-62135596800000"}}'],
  ['dateBeyondJs', '{"$date":{"$numberLong":"9223372036854775807"}}'],
  ['null', 'null'],
  ['regex', '{"$regularExpression":{"pattern":"^a.*\\\\d+$","options":"imsux"}}'],
  ['dbPointer', '{"$dbPointer":{"$ref":"db.coll","$id":{"$oid":"5f1d7a3e9c1b2a0012345679"}}}'],
  ['code', '{"$code":"function () { return 1; }"}'],
  ['symbol', '{"$symbol":"sym"}'],
  ['codeWithScope', '{"$code":"x + 1","$scope":{"x":{"$numberInt":"1"}}}'],
  ['int32', '{"$numberInt":"42"}'],
  ['int32Min', '{"$numberInt":"-2147483648"}'],
  ['int32Max', '{"$numberInt":"2147483647"}'],
  ['timestamp', '{"$timestamp":{"t":4294967295,"i":1}}'],
  ['int64', '{"$numberLong":"9007199254740993"}'],
  ['int64Min', '{"$numberLong":"-9223372036854775808"}'],
  ['int64Max', '{"$numberLong":"9223372036854775807"}'],
  ['decimal', '{"$numberDecimal":"-1.10"}'],
  ['decimalExp', '{"$numberDecimal":"1E+3"}'],
  ['decimalMax', '{"$numberDecimal":"9.999999999999999999999999999999999E+6144"}'],
  ['decimalNaN', '{"$numberDecimal":"NaN"}'],
  ['decimalNegZero', '{"$numberDecimal":"-0"}'],
  ['minKey', '{"$minKey":1}'],
  ['maxKey', '{"$maxKey":1}'],
];

const FIXTURE = `{${FIELDS.map(([k, v]) => `${JSON.stringify(k)}:${v}`).join(',')}}`;

/** Types `bson`'s own EJSON changes (Undefined → null, DBPointer → DBRef, dates beyond JS). */
const NOT_LOSSLESS_IN_BSON = new Set(['undefined', 'dbPointer', 'dateBeyondJs']);

function field(d: BsonDocument, key: string): BsonValue | undefined {
  return d.fields.find((f) => f.key === key)?.value;
}

describe('EJSON round trip', () => {
  it('is byte-identical for a document with every BSON type', () => {
    const model = parseEJsonDocument(FIXTURE);
    expect(model.fields.map((f) => f.key)).toEqual(FIELDS.map(([k]) => k));
    expect(stringifyEJson(model)).toBe(FIXTURE);
  });

  it('writes each leaf exactly as bson canonical EJSON does', () => {
    for (const [key, text] of FIELDS) {
      if (NOT_LOSSLESS_IN_BSON.has(key)) continue;
      const viaBson = EJSON.stringify(EJSON.parse(`{"v":${text}}`, { relaxed: false }), {
        relaxed: false,
      });
      expect(`{"v":${stringifyEJson(parseEJson(text))}}`, key).toBe(viaBson);
    }
  });

  it('models the types losslessly', () => {
    const model = parseEJsonDocument(FIXTURE);
    expect(field(model, 'negativeZero')).toEqual({ type: 'double', value: -0 });
    expect(Object.is((field(model, 'negativeZero') as { value: number }).value, -0)).toBe(true);
    expect(field(model, 'nan')).toEqual({ type: 'double', value: NaN });
    expect(field(model, 'int64')).toEqual({ type: 'long', value: 9007199254740993n });
    expect(field(model, 'dateBeyondJs')).toEqual({ type: 'date', ms: 2n ** 63n - 1n });
    expect(field(model, 'uuid')).toEqual({
      type: 'binary',
      subtype: 4,
      base64: 'D4+tW9nLRp+hZXCGdyiVDg==',
    });
    expect(field(model, 'undefined')).toEqual({ type: 'undefined' });
    expect(field(model, 'dbPointer')).toEqual({
      type: 'dbPointer',
      ref: 'db.coll',
      hex: '5f1d7a3e9c1b2a0012345679',
    });
    expect(field(model, 'codeWithScope')?.type).toBe('javascriptWithScope');
  });
});

describe('field order', () => {
  it('keeps integer-like keys, $-prefixed keys and repeated keys where they are', () => {
    const text =
      '{"b":{"$numberInt":"1"},"10":"ten","2":"two","$set":"x","$id":"y","$ref":"z",' +
      '"__proto__":"p","a":"first","a":"second","$foo":{"$bar":true}}';
    const model = parseEJsonDocument(text);
    expect(model.fields.map((f) => f.key)).toEqual([
      'b',
      '10',
      '2',
      '$set',
      '$id',
      '$ref',
      '__proto__',
      'a',
      'a',
      '$foo',
    ]);
    expect(stringifyEJson(model)).toBe(text);
  });

  it('keeps documents that merely look like type wrappers as documents', () => {
    for (const text of [
      '{"$oid":"5f1d7a3e9c1b2a0012345678","extra":true}',
      '{"$regex":"abc","$options":"i"}',
      '{"$date":{"$numberLong":"1"},"$x":1}',
      '{"$ref":"coll","$id":{"$oid":"5f1d7a3e9c1b2a0012345678"}}',
      '{"$unknown":"x"}',
    ]) {
      const model = parseEJson(text);
      expect(model.type, text).toBe('object');
      expect(parseEJson(stringifyEJson(model))).toEqual(model);
    }
  });
});

describe('relaxed EJSON input', () => {
  it('maps plain numbers to the smallest fitting type and normalizes wrappers', () => {
    const model = parseEJson(
      '{"i":1,"neg":-5,"l":3000000000,"d":1.5,"e":1e3,"z":-0,"huge":1e400,' +
        '"big":99999999999999999999,' +
        '"date":{"$date":"2020-01-01T00:00:00Z"},"dateNum":{"$date":5},' +
        '"u":{"$uuid":"0f8fad5b-d9cb-469f-a165-70867728950e"},' +
        '"legacyBin":{"$binary":"AQID","$type":"5"},' +
        '"bin":{"$binary":{"subType":"0","base64":"AQID"}},' +
        '"re":{"$regularExpression":{"pattern":"a","options":"xi"}}}',
    );
    expect(stringifyEJson(model)).toBe(
      '{"i":{"$numberInt":"1"},"neg":{"$numberInt":"-5"},"l":{"$numberLong":"3000000000"},' +
        '"d":{"$numberDouble":"1.5"},"e":{"$numberDouble":"1000.0"},"z":{"$numberDouble":"-0.0"},' +
        '"huge":{"$numberDouble":"Infinity"},"big":{"$numberDouble":"100000000000000000000.0"},' +
        '"date":{"$date":{"$numberLong":"1577836800000"}},"dateNum":{"$date":{"$numberLong":"5"}},' +
        '"u":{"$binary":{"base64":"D4+tW9nLRp+hZXCGdyiVDg==","subType":"04"}},' +
        '"legacyBin":{"$binary":{"base64":"AQID","subType":"05"}},' +
        '"bin":{"$binary":{"base64":"AQID","subType":"00"}},' +
        '"re":{"$regularExpression":{"pattern":"a","options":"ix"}}}',
    );
  });
});

describe('invalid input', () => {
  it.each([
    ['{"a":1', 'Invalid JSON'],
    ['{"a":1}x', 'trailing'],
    ['{"a":01}', 'Invalid JSON'],
    ["{'a':1}", 'expected a key'],
    ['"\\x"', 'escape'],
    ['"abc', 'unterminated'],
    ['"a\u0001"', 'control character'],
    ['tru', 'unexpected token'],
    ['[1 2]', "expected ']'"],
    ['{"a" 1}', "expected ':'"],
    ['{"$oid":"xyz"}', 'Invalid $oid'],
    ['{"$oid":1}', 'expected a string'],
    ['{"$numberInt":"2147483648"}', 'Invalid $numberInt'],
    ['{"$numberInt":"1.5"}', 'Invalid $numberInt'],
    ['{"$numberLong":"9223372036854775808"}', 'Invalid $numberLong'],
    ['{"$numberLong":"x"}', 'Invalid $numberLong'],
    ['{"$numberDouble":"abc"}', 'Invalid $numberDouble'],
    ['{"$numberDecimal":"abc"}', 'Invalid $numberDecimal'],
    ['{"$binary":{"base64":"A","subType":"00"}}', 'base64'],
    ['{"$binary":{"base64":"AA==","subType":"100"}}', 'subType'],
    ['{"$binary":{"base64":"AA=="}}', 'expected base64 and subType'],
    ['{"$uuid":"nope"}', 'Invalid $uuid'],
    ['{"$date":"yesterday"}', 'Invalid $date'],
    ['{"$date":true}', 'Invalid $date'],
    ['{"$timestamp":{"t":-1,"i":0}}', 'Invalid $timestamp'],
    ['{"$timestamp":{"t":1.5,"i":0}}', 'Invalid $timestamp'],
    ['{"$timestamp":{"t":1}}', 'Invalid $timestamp'],
    ['{"$regularExpression":{"pattern":"a","options":"q"}}', 'invalid options'],
    ['{"$regularExpression":{"pattern":"a"}}', 'Invalid $regularExpression'],
    ['{"$dbPointer":{"$ref":"a"}}', 'Invalid $dbPointer'],
    ['{"$dbPointer":{"$ref":"a","$id":"x"}}', 'Invalid $dbPointer'],
    ['{"$minKey":2}', 'Invalid $minKey'],
    ['{"$maxKey":"1"}', 'Invalid $maxKey'],
    ['{"$undefined":false}', 'Invalid $undefined'],
    ['{"$code":"x","$scope":1}', 'Invalid $scope'],
  ])('%s → %s', (text, message) => {
    expect(() => parseEJson(text)).toThrow(message);
  });

  it('rejects a non-document where a document is required', () => {
    expect(() => parseEJsonDocument('[]')).toThrow('Expected a document');
  });
});

describe('stringifyEJson formatting', () => {
  it('indents like JSON.stringify with type wrappers on one line', () => {
    const model = parseEJson('{"a":[{"$numberInt":"1"},{}],"b":{"c":null},"d":[]}');
    expect(stringifyEJson(model, 2)).toBe(
      '{\n  "a": [\n    {"$numberInt":"1"},\n    {}\n  ],\n  "b": {\n    "c": null\n  },\n  "d": []\n}',
    );
  });
});
