import { describe, expect, it } from 'vitest';

import { parseEJson, stringifyEJson } from '../bson/ejson';
import type { BsonValue } from '../bson/model';
import {
  parseShellSyntax,
  parseShellSyntaxDocument,
  positionAt,
  printShellSyntax,
  ShellSyntaxError,
} from './index';

function errorOf(text: string): ShellSyntaxError {
  try {
    parseShellSyntax(text);
  } catch (e) {
    expect(e).toBeInstanceOf(ShellSyntaxError);
    return e as ShellSyntaxError;
  }
  throw new Error(`expected ${text} to be rejected`);
}

const ejson = (v: BsonValue): string => stringifyEJson(v);

describe('parseShellSyntax: values', () => {
  it.each([
    ['{ a: 1 }', '{"a":{"$numberInt":"1"}}'],
    ['{ \'a b\': \'x\', "c": "y" }', '{"a b":"x","c":"y"}'],
    ['{ $gt: 1.5 }', '{"$gt":{"$numberDouble":"1.5"}}'],
    ['{ n: 3000000000 }', '{"n":{"$numberDouble":"3000000000.0"}}'],
    ['{ n: 1.0 }', '{"n":{"$numberInt":"1"}}'],
    ['{ n: -0 }', '{"n":{"$numberDouble":"-0.0"}}'],
    [
      '{ n: 0x1F, o: 0o17, b: 0b101, s: 1_000 }',
      '{"n":{"$numberInt":"31"},"o":{"$numberInt":"15"},"b":{"$numberInt":"5"},"s":{"$numberInt":"1000"}}',
    ],
    ['{ n: 5n }', '{"n":{"$numberLong":"5"}}'],
    [
      '{ n: -Infinity, m: NaN, p: +Infinity }',
      '{"n":{"$numberDouble":"-Infinity"},"m":{"$numberDouble":"NaN"},"p":{"$numberDouble":"Infinity"}}',
    ],
    ['ObjectId("65F0A1B2C3D4E5F6A7B8C9D0")', '{"$oid":"65f0a1b2c3d4e5f6a7b8c9d0"}'],
    ["new ObjectId('65f0a1b2c3d4e5f6a7b8c9d0')", '{"$oid":"65f0a1b2c3d4e5f6a7b8c9d0"}'],
    [
      'ObjectId.createFromHexString("65f0a1b2c3d4e5f6a7b8c9d0")',
      '{"$oid":"65f0a1b2c3d4e5f6a7b8c9d0"}',
    ],
    ['ISODate("2024-05-01T12:30:00.123+02:00")', '{"$date":{"$numberLong":"1714559400123"}}'],
    ['new Date("2024-05-01")', '{"$date":{"$numberLong":"1714521600000"}}'],
    ['new Date(0)', '{"$date":{"$numberLong":"0"}}'],
    ['NumberLong("9223372036854775807")', '{"$numberLong":"9223372036854775807"}'],
    ['NumberLong(-42)', '{"$numberLong":"-42"}'],
    ['Long(9007199254740993)', '{"$numberLong":"9007199254740993"}'],
    ['NumberInt("7")', '{"$numberInt":"7"}'],
    ['Int32(-7)', '{"$numberInt":"-7"}'],
    ['NumberDecimal("1.50")', '{"$numberDecimal":"1.50"}'],
    ['Decimal128(0.1)', '{"$numberDecimal":"0.1"}'],
    ['Double(5)', '{"$numberDouble":"5.0"}'],
    ['Double("2.5")', '{"$numberDouble":"2.5"}'],
    [
      'UUID("0123456789abcdef0123456789abcdef")',
      '{"$binary":{"base64":"ASNFZ4mrze8BI0VniavN7w==","subType":"04"}}',
    ],
    ['BinData(0, "AQID")', '{"$binary":{"base64":"AQID","subType":"00"}}'],
    ['HexData(5, "010203")', '{"$binary":{"base64":"AQID","subType":"05"}}'],
    [
      'MD5("0123456789abcdef0123456789abcdef")',
      '{"$binary":{"base64":"ASNFZ4mrze8BI0VniavN7w==","subType":"05"}}',
    ],
    ['Binary.createFromBase64("AQID", 128)', '{"$binary":{"base64":"AQID","subType":"80"}}'],
    ['Binary.createFromHexString("0102")', '{"$binary":{"base64":"AQI=","subType":"00"}}'],
    ['Timestamp(1, 2)', '{"$timestamp":{"t":1,"i":2}}'],
    ['Timestamp({ t: 4294967295, i: 0 })', '{"$timestamp":{"t":4294967295,"i":0}}'],
    ['Timestamp()', '{"$timestamp":{"t":0,"i":0}}'],
    ['/^ab+c$/mi', '{"$regularExpression":{"pattern":"^ab+c$","options":"im"}}'],
    ['/a\\/b[/]/', '{"$regularExpression":{"pattern":"a\\\\/b[/]","options":""}}'],
    ['RegExp("a.c", "s")', '{"$regularExpression":{"pattern":"a.c","options":"s"}}'],
    ['BSONRegExp("a c", "xl")', '{"$regularExpression":{"pattern":"a c","options":"lx"}}'],
    ['Code("return 1")', '{"$code":"return 1"}'],
    ['Code("x", { x: 1 })', '{"$code":"x","$scope":{"x":{"$numberInt":"1"}}}'],
    ['BSONSymbol("s")', '{"$symbol":"s"}'],
    [
      'DBPointer("db.c", ObjectId("65f0a1b2c3d4e5f6a7b8c9d0"))',
      '{"$dbPointer":{"$ref":"db.c","$id":{"$oid":"65f0a1b2c3d4e5f6a7b8c9d0"}}}',
    ],
    ['DBRef("c", 1, "db")', '{"$ref":"c","$id":{"$numberInt":"1"},"$db":"db"}'],
    [
      '[MinKey(), MaxKey, MinKey, undefined, null, true, false]',
      '[{"$minKey":1},{"$maxKey":1},{"$minKey":1},{"$undefined":true},null,true,false]',
    ],
  ])('%s', (text, expected) => {
    expect(ejson(parseShellSyntax(text))).toBe(expected);
  });

  it('decodes string escapes', () => {
    const v = parseShellSyntax(String.raw`'a\'b\"c\n\t\x41B\u{1F600}\0\
d'`);
    expect(v).toEqual({ type: 'string', value: 'a\'b"c\n\tAB\u{1F600}\0d' });
  });

  it('keeps key order and repeated keys, allows comments, trailing commas and a semicolon', () => {
    const v = parseShellSyntax(
      '// filter\n{ b: 1, /* x */ a: 2, b: 3, 10: 4, 2: 5, function: 6, }; ',
    );
    expect(v.type === 'object' && v.fields.map((f) => f.key)).toEqual([
      'b',
      'a',
      'b',
      '10',
      '2',
      'function',
    ]);
  });

  it('generates values for ObjectId(), UUID() and new Date()', () => {
    const oid = parseShellSyntax('ObjectId()');
    expect(oid.type === 'objectId' && /^[0-9a-f]{24}$/.test(oid.hex)).toBe(true);
    const uuid = parseShellSyntax('UUID()');
    expect(uuid.type === 'binary' && uuid.subtype === 4 && uuid.base64.length === 24).toBe(true);
    const now = parseShellSyntax('new Date()');
    expect(now.type === 'date' && Math.abs(Number(now.ms) - Date.now()) < 60_000).toBe(true);
  });

  it('parseShellSyntaxDocument requires a document', () => {
    expect(parseShellSyntaxDocument('{}')).toEqual({ type: 'object', fields: [] });
    const e = (() => {
      try {
        parseShellSyntaxDocument('\n  [1]');
      } catch (err) {
        return err as ShellSyntaxError;
      }
      return null;
    })();
    expect(e).toMatchObject({ line: 2, column: 3 });
  });
});

describe('parseShellSyntax: refuses code with a position', () => {
  it.each([
    ['function () { return 1 }', 1, 1, /"function" is code/],
    ['{ a: function() {} }', 1, 6, /"function" is code/],
    ['{ $where: this.a > 1 }', 1, 11, /"this" is code/],
    ['{\n  a: this\n}', 2, 6, /"this" is code/],
    ['{ a: eval("1") }', 1, 6, /"eval" is code/],
    ['{ a: alert(1) }', 1, 6, /Unknown function "alert"/],
    ['{ a: process.exit(1) }', 1, 6, /Unknown function "process.exit"/],
    ['{ a: new Function("x") }', 1, 6, /Unknown function "Function"/],
    ['{ a: () => 1 }', 1, 6, /Parentheses/],
    ['{ a: x => 1 }', 1, 6, /Unknown name "x"/],
    ['{ a: b }', 1, 6, /Unknown name "b"/],
    ['{ a }', 1, 3, /Shorthand property "a"/],
    ['{ a() {} }', 1, 3, /Methods/],
    ['{ [k]: 1 }', 1, 3, /Computed keys/],
    ['{ ...x }', 1, 3, /Spread/],
    ['{ a: `x${1}` }', 1, 6, /Template literals/],
    ['{ a: 1 + 2 }', 1, 8, /Operators/],
    ['[1 - 2]', 1, 4, /Operators/],
    ['[ObjectId()[0]]', 1, 12, /Property access/],
    ['1 + 2', 1, 3, /Operators/],
    ['ObjectId("65f0a1b2c3d4e5f6a7b8c9d0").getTimestamp()', 1, 37, /Property access/],
    ['{ a: ObjectId("65f0a1b2c3d4e5f6a7b8c9d0").toString() }', 1, 42, /Property access/],
    ['{ a: 1 } { b: 2 }', 1, 10, /Unexpected "\{" after the value/],
    ['{ a: async function() {} }', 1, 6, /"async" is code/],
    ['{ a: new this.Foo() }', 1, 6, /"this" is code/],
  ])('%s', (text, line, column, message) => {
    const e = errorOf(text);
    expect(e.message).toMatch(message);
    expect({ line: e.line, column: e.column }).toEqual({ line, column });
    expect(e.message).toContain(`(line ${line}, column ${column})`);
  });
});

describe('parseShellSyntax: invalid values carry the position', () => {
  it.each([
    ['', 1, 1, /Expected a value/],
    ['{ a: 1', 1, 7, /Expected "," or "\}" but found end of input/],
    ['{ a: "x }', 1, 6, /Unterminated string/],
    ['{ a: "x\ny" }', 1, 6, /Unterminated string/],
    ['/* x', 1, 1, /Unterminated comment/],
    ['{ a: /x }', 1, 6, /Unterminated regular expression/],
    ['{ a: /x/g }', 1, 6, /Unsupported regular expression flags "g"/],
    ['{ a: /x/ii }', 1, 6, /Repeated/],
    ['[1,,2]', 1, 4, /Empty array elements/],
    ['{ a: 017 }', 1, 6, /Invalid number/],
    ['{ a: 1x }', 1, 6, /Invalid number/],
    ['{ a: 1.5n }', 1, 6, /Invalid number/],
    ['{ a: 9223372036854775808n }', 1, 6, /64-bit/],
    ['{ a: "\\1" }', 1, 7, /Octal escape/],
    ['{ a: "\\x4" }', 1, 9, /Invalid escape/],
    ['{ a: "\\u{110000}" }', 1, 7, /Invalid escape/],
    ['{\n  _id: ObjectId("123")\n}', 2, 17, /not 24 hex/],
    ['ObjectId(1)', 1, 10, /as a string/],
    ['ObjectId("65f0a1b2c3d4e5f6a7b8c9d0", 1)', 1, 1, /takes 0 to 1 arguments, got 2/],
    ['ObjectId.createFromHexString()', 1, 1, /takes 1 argument, got 0/],
    ['ISODate("2024-02-30")', 1, 9, /not a valid date/],
    ['new Date(1.5)', 1, 10, /not an integer/],
    ['NumberLong("9223372036854775808")', 1, 12, /out of range/],
    ['NumberLong("1.5")', 1, 12, /not an integer/],
    ['NumberLong(true)', 1, 12, /as a number/],
    ['NumberInt(2147483648)', 1, 11, /out of range/],
    ['NumberDecimal("abc")', 1, 15, /not a valid Decimal128/],
    ['Double("x")', 1, 8, /not a number/],
    ['UUID("xyz")', 1, 6, /not a UUID/],
    ['BinData(256, "")', 1, 9, /out of range/],
    ['BinData(0, "A")', 1, 12, /Invalid base64/],
    ['HexData(0, "abc")', 1, 12, /Invalid hex/],
    ['MD5("00")', 1, 5, /32 hex digits/],
    ['Timestamp(-1, 0)', 1, 11, /out of range/],
    ['Timestamp({ t: 1 })', 1, 11, /Expected Timestamp/],
    ['RegExp("a", "g")', 1, 13, /Unsupported/],
    ['RegExp(1)', 1, 8, /as a string/],
    ['Code("x", 1)', 1, 11, /scope as a document/],
    ['BSONSymbol(1)', 1, 12, /as a string/],
    ['DBPointer("a.b", 1)', 1, 18, /Expected an ObjectId/],
    ['DBRef("c")', 1, 1, /takes 2 to 3 arguments/],
    ['MinKey(1)', 1, 1, /takes 0 arguments/],
    ['- x', 1, 3, /Expected a number after "-"/],
    ['@', 1, 1, /Unexpected "@"/],
    ['{ a: 1 b: 2 }', 1, 8, /Expected "," or "}" but found "b"/],
    ['{ a 1 }', 1, 5, /Expected ":" after key "a"/],
    ['{ 1: 2, @ }', 1, 9, /Expected a key/],
    ['ObjectId(1 2)', 1, 12, /Expected "," or "\)"/],
    ['new 5', 1, 5, /Expected a constructor name/],
    ['Binary.', 1, 8, /Expected a name after "."/],
    ['['.repeat(600), 1, 502, /Nesting is too deep/],
  ])('%j', (text, line, column, message) => {
    const e = errorOf(text);
    expect(e.message).toMatch(message);
    expect({ line: e.line, column: e.column }).toEqual({ line, column });
  });
});

describe('positionAt', () => {
  it('counts \\n, \\r\\n and \\r as line breaks', () => {
    expect(positionAt('a\nb\r\nc\rd', 7)).toEqual({ offset: 7, line: 4, column: 1 });
    expect(positionAt('ab', 99)).toEqual({ offset: 2, line: 1, column: 3 });
  });
});

/** Text already in the printer's style: print(parse(x)) must give x back exactly. */
const CANONICAL = [
  '{}',
  '[]',
  '{ a: 1 }',
  '{ name: "Ada", age: 36, active: true, nick: null }',
  '{ _id: ObjectId("65f0a1b2c3d4e5f6a7b8c9d0") }',
  '{ createdAt: { $gte: ISODate("2024-01-01T00:00:00.000Z"), $lt: ISODate("2025-01-01T00:00:00.000Z") } }',
  '{ n: NumberLong(42) }',
  '{ n: NumberLong("9223372036854775807") }',
  '{ n: NumberLong(-9007199254740991) }',
  '{ price: NumberDecimal("19.99") }',
  '{ price: NumberDecimal("1.0E+3") }',
  '{ ratio: 0.25, big: 3000000000, tiny: 5e-324, huge: 1e+300 }',
  '{ d: Double(1), z: -0, nan: NaN, inf: Infinity, ninf: -Infinity }',
  '{ id: UUID("0123abcd-4567-89ef-0123-456789abcdef") }',
  '{ data: BinData(0, "AQIDBA=="), legacy: BinData(3, "ASNFZ4mrze8BI0VniavN7w==") }',
  '{ ts: Timestamp({ t: 1700000000, i: 3 }) }',
  '{ name: /^ada/i, other: /a\\/b[/]c/msu }',
  '{ name: BSONRegExp("^a b$", "x"), empty: BSONRegExp("", ""), slash: BSONRegExp("a/b", "") }',
  '{ star: BSONRegExp("*x", ""), nl: BSONRegExp("a\\nb", "") }',
  '{ fn: Code("function () { return 1; }"), scoped: Code("x + y", { x: 1, y: 2 }) }',
  '{ s: BSONSymbol("sym"), u: undefined, p: DBPointer("db.c", ObjectId("65f0a1b2c3d4e5f6a7b8c9d0")) }',
  '{ lo: MinKey(), hi: MaxKey() }',
  '{ "a b": 1, "a.b": 2, "": 3, "1x": 4, $set: { "x-y": 5 }, _under: 6 }',
  '{ text: "quote \\" backslash \\\\ newline \\n tab \\t emoji 😀" }',
  '{ b: 1, a: 2, b: 3 }',
  '{ $or: [{ status: "A" }, { qty: { $lt: 30 } }] }',
  '{ tags: { $in: ["red", "blank"] }, dim: { $all: [14, 21] } }',
  '{ "items.qty": { $elemMatch: { $gt: 5, $lte: 10 } } }',
  '[{ $match: { status: "A" } }, { $group: { _id: "$cust", total: { $sum: "$amount" } } }, { $sort: { total: -1 } }]',
  '{ loc: { $near: { $geometry: { type: "Point", coordinates: [-73.9667, 40.78] }, $maxDistance: 1000 } } }',
  '{ $expr: { $gt: ["$spent", "$budget"] } }',
  '{ nested: [[1, 2], [3, [4, { deep: [] }]]] }',
  '{ at: ISODate("+010000-01-01T00:00:00.000Z"), far: new Date(8640000000000001) }',
  '{ n: NumberLong("-9223372036854775808"), i: -2147483648, x: 2147483647 }',
];

/** Text in other spellings: parse → print gives the canonical text, which is a fixpoint. */
const VARIANTS: readonly (readonly [string, string])[] = [
  ["{'a': 'x'}", '{ a: "x" }'],
  ['{a:1,}', '{ a: 1 }'],
  [
    '{ id: new ObjectId("65F0A1B2C3D4E5F6A7B8C9D0") }',
    '{ id: ObjectId("65f0a1b2c3d4e5f6a7b8c9d0") }',
  ],
  [
    '{ n: Long("5"), m: NumberInt(5), d: Decimal128("1") }',
    '{ n: NumberLong(5), m: 5, d: NumberDecimal("1") }',
  ],
  ['{ t: Timestamp(1, 2) }', '{ t: Timestamp({ t: 1, i: 2 }) }'],
  ['{ d: new Date("2024-05-01") }', '{ d: ISODate("2024-05-01T00:00:00.000Z") }'],
  ['{ r: RegExp("x", "mi") }', '{ r: /x/im }'],
  [
    '{ u: BinData(4, "ASNFZ4mrze8BI0VniavN7w==") }',
    '{ u: UUID("01234567-89ab-cdef-0123-456789abcdef") }',
  ],
  ['{ x: 1.0, y: 1e3, z: 0x10 }', '{ x: 1, y: 1000, z: 16 }'],
];

describe('printShellSyntax', () => {
  it(`round-trips a corpus of ${CANONICAL.length} canonical queries and documents`, () => {
    expect(CANONICAL.length).toBeGreaterThanOrEqual(30);
    for (const text of CANONICAL) {
      const value = parseShellSyntax(text);
      expect(printShellSyntax(value), text).toBe(text);
      expect(parseShellSyntax(printShellSyntax(value, { indent: 2 })), text).toEqual(value);
    }
  });

  it.each(VARIANTS)('normalizes %s', (text, canonical) => {
    const printed = printShellSyntax(parseShellSyntax(text));
    expect(printed).toBe(canonical);
    expect(printShellSyntax(parseShellSyntax(printed))).toBe(printed);
  });

  it('round-trips every BSON type from EJSON through shell syntax', () => {
    const value = parseEJson(
      JSON.stringify({
        d: { $numberDouble: '-1.5e-7' },
        dneg: { $numberDouble: '-2' },
        s: 'x',
        o: { a: [] },
        b: { $binary: { base64: '', subType: '00' } },
        u: { $uuid: '00000000-0000-0000-0000-000000000000' },
        undef: { $undefined: true },
        oid: { $oid: '000000000000000000000000' },
        bool: false,
        date: { $date: { $numberLong: '-62135596800001' } },
        nul: null,
        re: { $regularExpression: { pattern: 'a', options: 'ilmsux' } },
        ptr: { $dbPointer: { $ref: 'a', $id: { $oid: '000000000000000000000000' } } },
        code: { $code: '' },
        sym: { $symbol: '' },
        cws: { $code: 'c', $scope: {} },
        i: { $numberInt: '-1' },
        ts: { $timestamp: { t: 0, i: 4294967295 } },
        l: { $numberLong: '9007199254740992' },
        dec: { $numberDecimal: '-0E-6176' },
        min: { $minKey: 1 },
        max: { $maxKey: 1 },
      }),
    );
    expect(parseShellSyntax(printShellSyntax(value))).toEqual(value);
    expect(parseShellSyntax(printShellSyntax(value, { indent: 4 }))).toEqual(value);
  });

  it('indents nested containers and keeps empty ones and Timestamp inline', () => {
    const value = parseShellSyntax(
      '{ a: [1, { b: {} }], t: Timestamp(1, 2), c: Code("x", { y: [] }) }',
    );
    expect(printShellSyntax(value, { indent: 2 })).toBe(
      [
        '{',
        '  a: [',
        '    1,',
        '    {',
        '      b: {}',
        '    }',
        '  ],',
        '  t: Timestamp({ t: 1, i: 2 }),',
        '  c: Code("x", {',
        '    y: []',
        '  })',
        '}',
      ].join('\n'),
    );
  });
});
