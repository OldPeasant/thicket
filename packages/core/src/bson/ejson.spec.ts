import { Double, EJSON } from 'bson';
import { describe, expect, it } from 'vitest';

import {
  base64ToBytes,
  base64ToHex,
  bytesToBase64,
  hexToBase64,
  parseEJson,
  parseEJsonDocument,
  stringifyEJson,
} from './ejson';
import { ALL_TYPES_EJSON as FIXTURE, ALL_TYPES_FIELDS as FIELDS } from './fixtures';
import { BsonModelError, type BsonDocument, type BsonValue } from './model';

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

describe('EJSON round trip edge cases', () => {
  it('writes doubles exactly as bson canonical EJSON does', () => {
    const doubles = [
      0.1,
      -1.5e-300,
      1e-7,
      123456789.125,
      2 ** 53,
      2 ** 53 + 2,
      1e21,
      1.7976931348623157e308,
      -5e-324,
    ];
    for (const d of doubles) {
      const viaBson = EJSON.stringify({ v: new Double(d) }, { relaxed: false });
      expect(`{"v":${stringifyEJson({ type: 'double', value: d })}}`, String(d)).toBe(viaBson);
      const back = parseEJson(stringifyEJson({ type: 'double', value: d }));
      expect(back, String(d)).toEqual({ type: 'double', value: d });
    }
  });

  it('round-trips Int64 values around 2^53 without precision loss', () => {
    for (const n of [2n ** 53n - 1n, 2n ** 53n, 2n ** 53n + 1n, -(2n ** 53n) - 1n]) {
      const text = `{"$numberLong":"${n}"}`;
      expect(parseEJson(text)).toEqual({ type: 'long', value: n });
      expect(stringifyEJson(parseEJson(text))).toBe(text);
    }
  });

  it('round-trips keys and strings that need escaping, including the empty key', () => {
    const text =
      '{"":"empty","a\\"b":"q","line\\nbreak":"\\u0000","☃":"snow","\\ud83d\\ude00":"emoji"}';
    const model = parseEJsonDocument(text);
    expect(model.fields.map((f) => f.key)).toEqual(['', 'a"b', 'line\nbreak', '☃', '😀']);
    expect(parseEJsonDocument(stringifyEJson(model))).toEqual(model);
    // bson writes non-ASCII characters literally, so canonical text uses them unescaped
    const canonical = '{"":"empty","a\\"b":"q","line\\nbreak":"\\u0000","☃":"snow","😀":"emoji"}';
    expect(stringifyEJson(model)).toBe(canonical);
  });

  it('keeps nested wrappers inside arrays and code-with-scope scopes', () => {
    const text =
      '{"a":[{"$numberLong":"1"},[{"$date":{"$numberLong":"0"}}],{"$code":"y","$scope":{"z":{"$minKey":1}}}]}';
    expect(stringifyEJson(parseEJson(text))).toBe(text);
  });

  it('round-trips through indented output', () => {
    const text =
      '{"a":{"b":[{"$numberInt":"1"},{"$binary":{"base64":"AQ==","subType":"04"}}]},"c":[]}';
    const pretty = stringifyEJson(parseEJson(text), 4);
    expect(pretty).toContain('\n    "a": {');
    expect(stringifyEJson(parseEJson(pretty))).toBe(text);
  });

  it('clamps the indent to 0..10 like JSON.stringify', () => {
    const v = parseEJson('{"a":1}');
    expect(stringifyEJson(v, -3)).toBe('{"a":{"$numberInt":"1"}}');
    expect(stringifyEJson(v, 50)).toBe(`{\n${' '.repeat(10)}"a": {"$numberInt":"1"}\n}`);
  });

  it('normalizes accepted non-canonical wrapper forms to canonical text', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['{"$numberInt":"-0"}', '{"$numberInt":"0"}'],
      ['{"$numberDouble":"-0"}', '{"$numberDouble":"-0.0"}'],
      ['{"$numberDouble":"1e5"}', '{"$numberDouble":"100000.0"}'],
      ['{"$numberDecimal":"1.0E+3"}', '{"$numberDecimal":"1.0E+3"}'],
      ['{"$numberDecimal":"12000E-1"}', '{"$numberDecimal":"1200.0"}'],
      ['{"$oid":"5F1D7A3E9C1B2A0012345678"}', '{"$oid":"5f1d7a3e9c1b2a0012345678"}'],
      [
        '{"$binary":{"base64":"AQ==","subType":"8A"}}',
        '{"$binary":{"base64":"AQ==","subType":"8a"}}',
      ],
      ['{"$timestamp":{"i":2,"t":1}}', '{"$timestamp":{"t":1,"i":2}}'],
      ['{"$scope":{},"$code":"c"}', '{"$code":"c","$scope":{}}'],
      [
        '{"$dbPointer":{"$id":{"$oid":"5f1d7a3e9c1b2a0012345678"},"$ref":"c"}}',
        '{"$dbPointer":{"$ref":"c","$id":{"$oid":"5f1d7a3e9c1b2a0012345678"}}}',
      ],
      ['{"$date":"1970-01-01T00:00:00.001+00:00"}', '{"$date":{"$numberLong":"1"}}'],
      ['{"$date":-1}', '{"$date":{"$numberLong":"-1"}}'],
      [
        '{"$uuid":"0F8FAD5BD9CB469FA16570867728950E"}',
        '{"$binary":{"base64":"D4+tW9nLRp+hZXCGdyiVDg==","subType":"04"}}',
      ],
    ];
    for (const [input, canonical] of cases) {
      expect(stringifyEJson(parseEJson(input)), input).toBe(canonical);
    }
  });

  it('keeps an Int32-sized plain number boundary exact', () => {
    expect(parseEJson('2147483647')).toEqual({ type: 'int', value: 2147483647 });
    expect(parseEJson('2147483648')).toEqual({ type: 'long', value: 2147483648n });
    expect(parseEJson('-2147483649')).toEqual({ type: 'long', value: -2147483649n });
    expect(parseEJson('9223372036854775808')).toEqual({ type: 'double', value: 2 ** 63 });
    expect(parseEJson('1.0')).toEqual({ type: 'double', value: 1 });
  });

  it.each([
    ['{"$numberLong":5}', 'expected a string'],
    ['{"$numberInt":"+1"}', 'Invalid $numberInt'],
    ['{"$numberInt":""}', 'Invalid $numberInt'],
    ['{"$numberDouble":"inf"}', 'Invalid $numberDouble'],
    ['{"$binary":"AQID"}', 'expected base64 and subType'],
    ['{"$binary":{"base64":"AQID","subType":"00","x":1}}', 'expected base64 and subType'],
    ['{"$binary":{"base64":"AQ=","subType":"00"}}', 'invalid base64'],
    ['{"$timestamp":{"t":4294967296,"i":0}}', 'unsigned 32-bit'],
    ['{"$timestamp":{"t":0,"i":"1"}}', 'expected an integer'],
    ['{"$date":{"$numberLong":"9223372036854775808"}}', 'out of the 64-bit range'],
    ['{"$date":1.5}', 'Invalid $date'],
    ['{"$date":"2024-01-01T00:00:00"}', 'Invalid $date'],
    ['{"$regularExpression":{"pattern":1,"options":""}}', 'expected a string'],
    ['{"$dbPointer":{"$ref":"a","$id":{"$oid":"short"}}}', 'not 24 hex characters'],
    ['{"$minKey":true}', 'Invalid $minKey'],
    ['{"$undefined":1}', 'Invalid $undefined'],
    ['{"$code":1,"$scope":{}}', 'expected a string'],
  ])('rejects %s (%s)', (text, message) => {
    expect(() => parseEJson(text)).toThrow(BsonModelError);
    expect(() => parseEJson(text)).toThrow(message);
  });
});

describe('Binary base64 canonicalization', () => {
  it.each(['AB==', 'AAB=', 'AQIDBA==', 'AQIDBAU=', ''])(
    'stores %s as bson canonical EJSON writes it',
    (b64) => {
      const text = `{"v":{"$binary":{"base64":"${b64}","subType":"00"}}}`;
      const viaBson = EJSON.stringify(EJSON.parse(text, { relaxed: false }), { relaxed: false });
      expect(stringifyEJson(parseEJson(text))).toBe(viaBson);
    },
  );

  it('normalizes the legacy form too', () => {
    expect(parseEJson('{"$binary":"AB==","$type":"00"}')).toEqual({
      type: 'binary',
      subtype: 0,
      base64: 'AA==',
    });
  });
});

describe('base64 helpers', () => {
  it('round-trip byte arrays of every padding length', () => {
    for (let n = 0; n <= 7; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 97 + 251) & 0xff);
      const b64 = bytesToBase64(bytes);
      expect(b64.length % 4).toBe(0);
      expect(base64ToBytes(b64)).toEqual(bytes);
    }
  });

  it('convert between hex and base64', () => {
    expect(hexToBase64('')).toBe('');
    expect(hexToBase64('0f8fad5bd9cb469fa16570867728950e')).toBe('D4+tW9nLRp+hZXCGdyiVDg==');
    expect(base64ToHex('D4+tW9nLRp+hZXCGdyiVDg==')).toBe('0f8fad5bd9cb469fa16570867728950e');
    expect(base64ToHex('')).toBe('');
    expect(bytesToBase64(Uint8Array.of(0xfb, 0xff))).toBe('+/8=');
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
