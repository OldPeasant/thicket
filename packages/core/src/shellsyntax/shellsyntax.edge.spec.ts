import { afterEach, describe, expect, it } from 'vitest';

import { stringifyEJson } from '../bson/ejson';
import { BsonModelError, INT64_MAX, INT64_MIN, type BsonValue } from '../bson/model';
import {
  parseShellSyntax,
  parseShellSyntaxDocument,
  printShellSyntax,
  ShellSyntaxError,
} from './index';

/**
 * Edge cases of the shell-syntax parser and printer (task shell-syntax): comments, unicode
 * identifiers and whitespace, string escapes, number and regex literal edge cases, the printer's
 * regex-literal fallback, line/column with CRLF, the nesting limit and refusal of code.
 */

function errorOf(run: () => unknown): ShellSyntaxError {
  try {
    run();
  } catch (e) {
    expect(e).toBeInstanceOf(ShellSyntaxError);
    return e as ShellSyntaxError;
  }
  throw new Error('expected the text to be rejected');
}

const parseError = (text: string): ShellSyntaxError => errorOf(() => parseShellSyntax(text));
const ejson = (text: string): string => stringifyEJson(parseShellSyntax(text));
const keys = (v: BsonValue): string[] => (v.type === 'object' ? v.fields.map((f) => f.key) : []);

/** print -> parse gives the same value, and printing again gives the same text. */
function expectRoundTrip(value: BsonValue): string {
  const printed = printShellSyntax(value);
  expect(parseShellSyntax(printed), printed).toEqual(value);
  expect(printShellSyntax(parseShellSyntax(printed))).toBe(printed);
  return printed;
}

describe('comments and whitespace', () => {
  it('allows block comments between every token', () => {
    expect(ejson('/*a*/{/*b*/a/*c*/:/*d*/1/*e*/,/*f*/}/*g*/')).toBe('{"a":{"$numberInt":"1"}}');
  });

  it.each([
    ['\n', '{ a: 1 // x\n}'],
    ['\r\n', '{ a: 1 // x\r\n}'],
    ['\r', '{ a: 1 // x\r}'],
    ['U+2028', '{ a: 1 // x\u2028}'],
    ['U+2029', '{ a: 1 // x\u2029}'],
  ])('ends a line comment at %s', (_name, text) => {
    expect(ejson(text)).toBe('{"a":{"$numberInt":"1"}}');
  });

  it('allows a trailing line comment without a final newline', () => {
    expect(ejson('{ a: 1 } // done')).toBe('{"a":{"$numberInt":"1"}}');
    expect(ejson('{ a: 1 }; /* done */')).toBe('{"a":{"$numberInt":"1"}}');
  });

  it('does not read "/*" or "//" as a regex literal', () => {
    expect(ejson('/*x*/ 1')).toBe('{"$numberInt":"1"}');
    expect(ejson('[//x/\n2]')).toBe('[{"$numberInt":"2"}]');
  });

  it('rejects a comment-only or whitespace-only text at the end of input', () => {
    expect(parseError('// only')).toMatchObject({ line: 1, column: 8, offset: 7 });
    expect(parseError('// only').reason).toBe('Expected a value but found end of input');
    expect(parseError('  \r\n\t')).toMatchObject({ line: 2, column: 2 });
  });

  it('does not nest block comments', () => {
    const e = parseError('/* /* */ */ {}');
    expect(e.message).toMatch(/Unexpected "\*"/);
    expect(e).toMatchObject({ line: 1, column: 10 });
  });

  it('rejects a second semicolon', () => {
    const e = parseError('{};;');
    expect(e.message).toMatch(/Unexpected ";" after the value/);
    expect(e.column).toBe(4);
  });

  it('accepts unicode white space and line terminators between tokens', () => {
    const text = '\ufeff{\u00a0a\u3000:\u2003 1\u202f,\u2028b\u2029:\u1680\u205f2\u000b\u000c}';
    expect(ejson(text)).toBe('{"a":{"$numberInt":"1"},"b":{"$numberInt":"2"}}');
  });

  it('does not treat U+0085 (not JS white space) as white space', () => {
    const e = parseError('{ a:\u0085 1 }');
    expect(e.message).toMatch(/Unexpected/);
    expect(e).toMatchObject({ line: 1, column: 5 });
  });
});

describe('unicode identifiers', () => {
  it('accepts unquoted keys with unicode letters, $, _ and ZWJ/ZWNJ', () => {
    const v = parseShellSyntax(
      '{ café: 1, 名前: 2, ñandú: 3, $: 4, _: 5, a\u200db: 6, a\u200cb: 7 }',
    );
    expect(keys(v)).toEqual(['café', '名前', 'ñandú', '$', '_', 'a\u200db', 'a\u200cb']);
  });

  it('prints non-ASCII keys quoted and reads them back', () => {
    const v = parseShellSyntax('{ café: 1, 名前: 2 }');
    expect(expectRoundTrip(v)).toBe('{ "café": 1, "名前": 2 }');
  });

  it('refuses a key that is not an identifier', () => {
    const e = parseError('{ 😀: 1 }');
    expect(e.message).toMatch(/Expected a key or "}"/);
    expect(e).toMatchObject({ line: 1, column: 3 });
  });

  it('refuses unicode escapes in identifiers (no hidden keywords)', () => {
    expect(parseError('{ \\u0061: 1 }')).toMatchObject({ line: 1, column: 3 });
    const e = parseError('{ a: \\u0074his }');
    expect(e.message).toMatch(/Unexpected "\\"/);
    expect(e.column).toBe(6);
  });

  it('refuses unicode identifiers as values', () => {
    const e = parseError('{ a: café }');
    expect(e.message).toMatch(/Unknown name "café"/);
    expect(e.column).toBe(6);
  });
});

describe('string escapes', () => {
  it.each([
    [String.raw`"\b\f\v\r\n\t"`, '\b\f\v\r\n\t'],
    [String.raw`"\\ \/ \' \""`, '\\ / \' "'],
    [String.raw`"\a\c\z"`, 'acz'],
    [String.raw`"\x41\x7e\xFF"`, 'A~\u00ff'],
    [String.raw`"\u0041\u00e9\uD83D\uDE00"`, 'Aé😀'],
    [String.raw`"\u{41}\u{0}\u{10FFFF}\u{00000041}"`, 'A\0\u{10ffff}A'],
    [String.raw`"\0x"`, '\0x'],
    [`'a"b'`, 'a"b'],
    [`"a'b"`, "a'b"],
    ['"a\u2028b\u2029c"', 'a\u2028b\u2029c'],
    ['"a\\\nb"', 'ab'],
    ['"a\\\r\nb"', 'ab'],
    ['"a\\\rb"', 'ab'],
    ['"a\\\u2028b"', 'ab'],
    ['"a\\\u2029b"', 'ab'],
    ['""', ''],
  ])('%j', (text, value) => {
    expect(parseShellSyntax(text)).toEqual({ type: 'string', value });
  });

  it('decodes escapes in quoted keys', () => {
    expect(keys(parseShellSyntax(String.raw`{ "a\u0062": 1, 'c\x64': 2 }`))).toEqual(['ab', 'cd']);
  });

  it.each([
    ['"\\08"', 2, /Octal escape/],
    ['"\\8"', 2, /Octal escape/],
    ['"\\u12"', 4, /Invalid escape/],
    ['"\\u{}"', 2, /Invalid escape/],
    ['"\\u{41"', 2, /Invalid escape/],
    ['"\\u{g}"', 2, /Invalid escape/],
    ['"\\u{000000041}"', 2, /Invalid escape/],
    ['"\\xg1"', 4, /Invalid escape/],
    ['"abc\\', 1, /Unterminated string/],
    ['"\\0', 1, /Unterminated string/],
    ['"a\rb"', 1, /Unterminated string/],
    ['\'abc"', 1, /Unterminated string/],
  ])('rejects %j', (text, column, message) => {
    const e = parseError(text);
    expect(e.message).toMatch(message);
    expect({ line: e.line, column: e.column }).toEqual({ line: 1, column });
  });

  it('round-trips strings with control characters, line separators and lone surrogates', () => {
    expectRoundTrip({ type: 'string', value: '\0\u0001\u001f\u007f\u2028\u2029\ud800 \udfff "\\' });
  });
});

describe('number literals', () => {
  it.each([
    ['0', '{"$numberInt":"0"}'],
    ['5.', '{"$numberInt":"5"}'],
    ['.5', '{"$numberDouble":"0.5"}'],
    ['1e3', '{"$numberInt":"1000"}'],
    ['1E-2', '{"$numberDouble":"0.01"}'],
    ['2147483647', '{"$numberInt":"2147483647"}'],
    ['2147483648', '{"$numberDouble":"2147483648.0"}'],
    ['-2147483648', '{"$numberInt":"-2147483648"}'],
    ['-2147483649', '{"$numberDouble":"-2147483649.0"}'],
    ['0xFFFFFFFF', '{"$numberDouble":"4294967295.0"}'],
    ['0B1_0', '{"$numberInt":"2"}'],
    ['0O7', '{"$numberInt":"7"}'],
    ['-0x10', '{"$numberInt":"-16"}'],
    ['+5', '{"$numberInt":"5"}'],
    ['- 5', '{"$numberInt":"-5"}'],
    ['-/* c */5', '{"$numberInt":"-5"}'],
    ['-0.0', '{"$numberDouble":"-0.0"}'],
    ['1_000_000.000_5', '{"$numberDouble":"1000000.0005"}'],
    ['1e400', '{"$numberDouble":"Infinity"}'],
    ['-5n', '{"$numberLong":"-5"}'],
    ['0x7fffffffffffffffn', '{"$numberLong":"9223372036854775807"}'],
    ['-9223372036854775808n', '{"$numberLong":"-9223372036854775808"}'],
    ['-NaN', '{"$numberDouble":"NaN"}'],
  ])('%s', (text, expected) => {
    expect(ejson(text)).toBe(expected);
  });

  it('reads an integer literal beyond 2^53 as the nearest Double', () => {
    expect(parseShellSyntax('12345678901234567890')).toEqual({
      type: 'double',
      value: 12345678901234567000,
    });
  });

  it.each([
    ['00', 1, /Invalid number/],
    ['08', 1, /Invalid number/],
    ['0x', 1, /Invalid number/],
    ['0b2', 1, /Invalid number/],
    ['0xg', 1, /Invalid number/],
    ['1_', 1, /Invalid number/],
    ['1__0', 1, /Invalid number/],
    ['0_1', 1, /Invalid number/],
    ['1e', 1, /Invalid number/],
    ['1e+', 1, /Invalid number/],
    ['1n2', 1, /Invalid number/],
    ['1.5e3n', 1, /Invalid number/],
    ['.', 1, /Invalid number/],
    ['-9223372036854775809n', 1, /outside the 64-bit integer range/],
    ['9223372036854775808n', 1, /outside the 64-bit integer range/],
    ['+', 2, /Expected a number after "\+"/],
    ['-Infinityx', 2, /Expected a number after "-"/],
    ['5..toString()', 3, /Property access/],
    ['1.5.5', 4, /Property access/],
  ])('rejects %j', (text, column, message) => {
    const e = parseError(text);
    expect(e.message).toMatch(message);
    expect(e.column).toBe(column);
  });

  it('converts number keys like JavaScript does', () => {
    const v = parseShellSyntax('{ 1e3: 1, .5: 2, 0x10: 3, 5n: 4, 1.50: 5, 0: 6 }');
    expect(keys(v)).toEqual(['1000', '0.5', '16', '5', '1.5', '0']);
  });

  it('keeps Int64 precision in constructors given number literals', () => {
    expect(ejson('NumberLong(9223372036854775807)')).toBe('{"$numberLong":"9223372036854775807"}');
    expect(ejson('NumberLong(-0x8000000000000000)')).toBe('{"$numberLong":"-9223372036854775808"}');
    expect(ejson('NumberLong(1e3)')).toBe('{"$numberLong":"1000"}');
    expect(ejson('NumberDecimal(.5)')).toBe('{"$numberDecimal":"0.5"}');
    expect(ejson('NumberDecimal(0b11)')).toBe('{"$numberDecimal":"3"}');
    expect(ejson('NumberDecimal(-1_000.25)')).toBe('{"$numberDecimal":"-1000.25"}');
    expect(ejson('Double(-Infinity)')).toBe('{"$numberDouble":"-Infinity"}');
    expect(ejson('NumberDecimal(-Infinity)')).toBe('{"$numberDecimal":"-Infinity"}');
  });

  it('refuses a single Timestamp argument that is not a document', () => {
    const e = parseError('Timestamp(5)');
    expect(e.message).toMatch(/Expected Timestamp\(\{ t: <seconds>, i: <increment> \}\)/);
    expect(e.column).toBe(11);
  });

  it('accepts Infinity and NaN as constructor arguments like mongosh (TW-1)', () => {
    // Double(-Infinity) is accepted; the unsigned words must be too.
    expect(ejson('Double(Infinity)')).toBe('{"$numberDouble":"Infinity"}');
    expect(ejson('Double(NaN)')).toBe('{"$numberDouble":"NaN"}');
    expect(ejson('NumberDecimal(Infinity)')).toBe('{"$numberDecimal":"Infinity"}');
    expect(ejson('NumberDecimal(NaN)')).toBe('{"$numberDecimal":"NaN"}');
    expect(ejson('Decimal128(Infinity)')).toBe('{"$numberDecimal":"Infinity"}');
  });

  it('still refuses Infinity and NaN where an integer is needed', () => {
    expect(parseError('NumberLong(Infinity)').column).toBe(12);
    expect(parseError('NumberInt(NaN)').column).toBe(11);
  });

  it('accepts bare Infinity and NaN with new, inside documents and around comments', () => {
    expect(ejson('new Double(NaN)')).toBe('{"$numberDouble":"NaN"}');
    expect(ejson('new NumberDecimal(Infinity)')).toBe('{"$numberDecimal":"Infinity"}');
    expect(ejson('Double( /* x */ Infinity // y\n)')).toBe('{"$numberDouble":"Infinity"}');
    expect(ejson('{ a: [Double(Infinity), NumberDecimal(NaN)] }')).toBe(
      '{"a":[{"$numberDouble":"Infinity"},{"$numberDecimal":"NaN"}]}',
    );
  });

  it('round-trips the values read from Double(Infinity) and NumberDecimal(NaN)', () => {
    expect(expectRoundTrip(parseShellSyntax('Double(Infinity)'))).toBe('Infinity');
    expect(expectRoundTrip(parseShellSyntax('Double(NaN)'))).toBe('NaN');
    expect(expectRoundTrip(parseShellSyntax('NumberDecimal(NaN)'))).toBe('NumberDecimal("NaN")');
  });

  it.each([
    ['Double(true)', 8, 'Expected a number as a string'],
    ['Double(undefined)', 8, 'Expected a number as a string'],
    ['Double(MinKey)', 8, 'Expected a number as a string'],
    ['NumberDecimal(null)', 15, 'Expected a decimal as a string'],
    ['NumberDecimal(false)', 15, 'Expected a decimal as a string'],
  ])('refuses the other word %s as a Double or Decimal argument', (text, column, reason) => {
    const e = parseError(text);
    expect(e.reason).toBe(reason);
    expect(e.column).toBe(column);
  });

  it.each([
    ['new Date(Infinity)', 10],
    ['new Date(NaN)', 10],
    ['Timestamp(Infinity, 1)', 11],
    ['Timestamp(1, NaN)', 14],
    ['BinData(NaN, "")', 9],
  ])('still refuses %s, which needs an integer', (text, column) => {
    expect(parseError(text).column).toBe(column);
  });
});

describe('regex literals', () => {
  it.each([
    ['/[/]/', '[/]'],
    ['/[\\]/]/', '[\\]/]'],
    ['/\\//', '\\/'],
    ['/a[b\\]c]d/', 'a[b\\]c]d'],
    ['/[[]/', '[[]'],
    ['/(/', '('],
    ['/\\u{1F600}é/u', '\\u{1F600}é'],
  ])('keeps the pattern of %s verbatim', (text, pattern) => {
    const v = parseShellSyntax(text);
    expect(v).toMatchObject({ type: 'regex', pattern });
  });

  it('sorts flags', () => {
    expect(parseShellSyntax('/x/usmi')).toEqual({ type: 'regex', pattern: 'x', options: 'imsu' });
  });

  it('reads RegExp(pattern) without flags', () => {
    expect(parseShellSyntax('RegExp("a/b")')).toEqual({
      type: 'regex',
      pattern: 'a/b',
      options: '',
    });
  });

  it.each(['g', 'y', 'd', 'v', 'x', 'l', 'é', 'ig'])('refuses the flag set %j', (flags) => {
    const e = parseError(`[1, /x/${flags}]`);
    expect(e.reason).toBe(`Unsupported regular expression flags "${flags}"`);
    expect(e.column).toBe(5);
  });

  it.each([
    ['{ a: /x\n/ }', 6],
    ['{ a: /x\\\n/ }', 6],
    ['{ a: /x\u2028/ }', 6],
    ['/x\\', 1],
    ['/[/', 1],
  ])('refuses the unterminated regex %j', (text, column) => {
    const e = parseError(text);
    expect(e.message).toMatch(/Unterminated regular expression/);
    expect(e.column).toBe(column);
  });

  it('refuses property access on and text after a regex literal', () => {
    expect(parseError('/x/i.test("a")')).toMatchObject({ column: 5 });
    expect(parseError('/x/i.test("a")').message).toMatch(/Property access/);
    const e = parseError('/x/ i');
    expect(e.message).toMatch(/Unexpected "i" after the value/);
    expect(e.column).toBe(5);
  });

  it('refuses a regex literal as a key', () => {
    expect(parseError('{ /x/: 1 }').message).toMatch(/Expected a key/);
  });
});

describe('printShellSyntax: regex literal or BSONRegExp', () => {
  it.each([
    ['a\\', '', 'BSONRegExp("a\\\\", "")'],
    ['/x', 'i', 'BSONRegExp("/x", "i")'],
    ['a\u2028b', '', 'BSONRegExp("a\u2028b", "")'],
    ['a\rb', '', 'BSONRegExp("a\\rb", "")'],
    ['a]/', '', 'BSONRegExp("a]/", "")'],
    ['[/', '', 'BSONRegExp("[/", "")'],
    ['x', 'l', 'BSONRegExp("x", "l")'],
    ['x', 'x', 'BSONRegExp("x", "x")'],
    ['x', 'imsux', 'BSONRegExp("x", "imsux")'],
    ['[\\]/]', '', '/[\\]/]/'],
    ['\\/', '', '/\\//'],
    ['x', 'imsu', '/x/imsu'],
    ['a*', '', '/a*/'],
    // PCRE-only patterns that JS cannot compile stay in BSONRegExp so mongosh reads them (CR-1).
    ['(?i)a', '', 'BSONRegExp("(?i)a", "")'],
    ['a++', '', 'BSONRegExp("a++", "")'],
    ['(?>a)', 'i', 'BSONRegExp("(?>a)", "i")'],
    ['a\\-', 'u', 'BSONRegExp("a\\\\-", "u")'],
    ['a\\-', '', '/a\\-/'],
  ])('pattern %j options %j -> %s', (pattern, options, printed) => {
    expect(expectRoundTrip({ type: 'regex', pattern, options })).toBe(printed);
  });

  it.each([
    // Valid in JS, so the literal form stays.
    ['\\p{L}+', 'u', '/\\p{L}+/u'],
    ['(?<y>\\d{4})-\\k<y>', '', '/(?<y>\\d{4})-\\k<y>/'],
    ['(?<=a)b(?!c)', 'i', '/(?<=a)b(?!c)/i'],
    ['.', 's', '/./s'],
    ['(a+)+$', '', '/(a+)+$/'],
    // Not valid in JS (PCRE-only or malformed), so BSONRegExp (CR-1).
    ['\\p{NotAProperty}', 'u', 'BSONRegExp("\\\\p{NotAProperty}", "u")'],
    ['a{2,1}', '', 'BSONRegExp("a{2,1}", "")'],
    ['[z-a]', '', 'BSONRegExp("[z-a]", "")'],
    ['(?#note)a', '', 'BSONRegExp("(?#note)a", "")'],
    ['(', '', 'BSONRegExp("(", "")'],
    ['\\Aa\\z', 'u', 'BSONRegExp("\\\\Aa\\\\z", "u")'],
  ])('pattern %j options %j -> %s (JS compile check)', (pattern, options, printed) => {
    expect(expectRoundTrip({ type: 'regex', pattern, options })).toBe(printed);
  });

  it('prints a parsed PCRE-only regex literal as BSONRegExp, also inside a document', () => {
    expect(printShellSyntax(parseShellSyntax('/a++/'))).toBe('BSONRegExp("a++", "")');
    expect(printShellSyntax(parseShellSyntax('{ name: /(?i)ann/, ok: /ann/i }'))).toBe(
      '{ name: BSONRegExp("(?i)ann", ""), ok: /ann/i }',
    );
  });
});

describe('printShellSyntax: scalars', () => {
  it.each([
    [1e21, '1e+21'],
    [-2147483649, '-2147483649'],
    [2147483648, '2147483648'],
    [-2147483648, 'Double(-2147483648)'],
    [2147483647, 'Double(2147483647)'],
    [0, 'Double(0)'],
    [-0, '-0'],
    [0.1, '0.1'],
    [1e-7, '1e-7'],
    [Number.MAX_VALUE, '1.7976931348623157e+308'],
    [Number.MIN_VALUE, '5e-324'],
    [2 ** 53 + 2, '9007199254740994'],
  ])('double %d -> %s', (value, printed) => {
    expect(expectRoundTrip({ type: 'double', value })).toBe(printed);
  });

  it.each([
    [9007199254740991n, 'NumberLong(9007199254740991)'],
    [9007199254740992n, 'NumberLong("9007199254740992")'],
    [-9007199254740992n, 'NumberLong("-9007199254740992")'],
    [0n, 'NumberLong(0)'],
  ])('long %s -> %s', (value, printed) => {
    expect(expectRoundTrip({ type: 'long', value })).toBe(printed);
  });

  it.each([
    [INT64_MAX, 'new Date(9223372036854775807)'],
    [INT64_MIN, 'new Date(-9223372036854775808)'],
    [-8640000000000001n, 'new Date(-8640000000000001)'],
    [0n, 'ISODate("1970-01-01T00:00:00.000Z")'],
  ])('date %s -> %s', (ms, printed) => {
    expect(expectRoundTrip({ type: 'date', ms })).toBe(printed);
  });

  it.each(['Infinity', '-Infinity', 'NaN', '-0', '1.23E+300', '1E-6176'])(
    'decimal %s round-trips',
    (value) => {
      expect(expectRoundTrip({ type: 'decimal', value })).toBe(`NumberDecimal("${value}")`);
    },
  );

  it('prints subtype 4 binary that is not 16 bytes as BinData', () => {
    expect(expectRoundTrip({ type: 'binary', subtype: 4, base64: 'AQID' })).toBe(
      'BinData(4, "AQID")',
    );
  });

  it('prints keys that are code words or special names bare and reads them back as keys', () => {
    const v = parseShellSyntax(
      '{ function: 1, this: 2, true: 3, __proto__: 4, constructor: 5, new: 6 }',
    );
    expect(expectRoundTrip(v)).toBe(
      '{ function: 1, this: 2, true: 3, __proto__: 4, constructor: 5, new: 6 }',
    );
  });

  it.each([
    [-3, '{ a: [1] }'],
    [0, '{ a: [1] }'],
    [2.9, '{\n  a: [\n    1\n  ]\n}'],
    [99, `{\n${' '.repeat(10)}a: [\n${' '.repeat(20)}1\n${' '.repeat(10)}]\n}`],
  ])('clamps indent %d', (indent, printed) => {
    expect(printShellSyntax(parseShellSyntax('{ a: [1] }'), { indent })).toBe(printed);
  });
});

describe('line and column', () => {
  it.each([
    ['CRLF', '{\r\n  a: 1,\r\n  b: this\r\n}', 3, 6],
    ['CR', '{\r  a: this\r}', 2, 6],
    ['mixed', '{\n\r\n\r  a: x }', 4, 6],
    ['end of input after CRLF', '{ a: 1,\r\n', 2, 1],
    ['tab counts as one column', '{\ta:\tthis }', 1, 6],
    ['surrogate pair counts as two columns', '{ "😀": this }', 1, 9],
    ['after a multi-line comment', '/* a\r\n b */ { a: b }', 2, 12],
    ['unterminated string on a CRLF line', '{\r\n  a: "x\r\n}', 2, 6],
    ['value error on a CRLF line', '{\r\n  _id: ObjectId("x")\r\n}', 2, 17],
  ])('%s', (_name, text, line, column) => {
    expect(parseError(text)).toMatchObject({ line, column });
  });

  it('exposes offset, reason and a message with the position', () => {
    const text = '{\r\n  a: this\r\n}';
    const e = parseError(text);
    expect(e).toBeInstanceOf(BsonModelError);
    expect(e).toBeInstanceOf(Error);
    expect(e.offset).toBe(text.indexOf('this'));
    expect(e.reason).toBe('"this" is code, which is not allowed here');
    expect(e.message).toBe(`${e.reason} (line 2, column 6)`);
  });

  it('parseShellSyntaxDocument points at the value after a BOM and blank CRLF lines', () => {
    const e = errorOf(() => parseShellSyntaxDocument('\ufeff\r\n\r\n  "x"'));
    expect(e).toMatchObject({ line: 3, column: 3 });
    expect(e.reason).toBe('Expected a document ({ … })');
  });

  it('parseShellSyntaxDocument points at the value after a leading comment (TW-2)', () => {
    const e = errorOf(() => parseShellSyntaxDocument('// filter\n [1]'));
    expect(e).toMatchObject({ line: 2, column: 2 });
  });

  it.each([
    ['a block comment', '/* filter */ "x"', 1, 14],
    ['several line comments on CRLF lines', '// a\r\n  // b\r\n  5', 3, 3],
    ['a BOM and a block comment', '﻿/* c */\n  true', 2, 3],
    ['a signed number', '// n\n-5', 2, 1],
    ['a constructor with new', '/* d */ new Date(0)', 1, 9],
    ['a regex literal', '// r\n/x/i', 2, 1],
    ['a comment that looks like a document', '/* { a: 1 } */ null', 1, 16],
  ])('parseShellSyntaxDocument points at the value after %s', (_name, text, line, column) => {
    const e = errorOf(() => parseShellSyntaxDocument(text));
    expect(e.reason).toBe('Expected a document ({ … })');
    expect(e).toMatchObject({ line, column });
  });

  it('parseShellSyntaxDocument accepts a document surrounded by comments', () => {
    expect(parseShellSyntaxDocument('// active users\n{ a: 1 } /* end */')).toEqual(
      parseShellSyntax('{ a: 1 }'),
    );
  });

  it('parseShellSyntaxDocument reports a value error before the not-a-document error', () => {
    const e = errorOf(() => parseShellSyntaxDocument('// c\nNumberLong("x")'));
    expect(e.reason).not.toBe('Expected a document ({ … })');
    expect(e).toMatchObject({ line: 2, column: 12 });
  });

  it('parseShellSyntaxDocument still refuses code after a leading comment with its position', () => {
    const e = errorOf(() => parseShellSyntaxDocument('// c\n{ a: this }'));
    expect(e.reason).toBe('"this" is code, which is not allowed here');
    expect(e).toMatchObject({ line: 2, column: 6 });
  });
});

describe('nesting limit', () => {
  const arrays = (n: number): string => '['.repeat(n) + ']'.repeat(n);
  const objects = (n: number): string => '{a:'.repeat(n) + '1' + '}'.repeat(n);

  it('accepts 501 nested empty arrays and 500 nested objects with a value', () => {
    expect(parseShellSyntax(arrays(501)).type).toBe('array');
    const v = parseShellSyntax(objects(500));
    expect(v.type).toBe('object');
    expect(printShellSyntax(v)).toBe('{ a: '.repeat(500) + '1' + ' }'.repeat(500));
  });

  it('refuses one level more at the position of the too-deep value', () => {
    expect(parseError(arrays(502))).toMatchObject({ column: 502, reason: 'Nesting is too deep' });
    expect(parseError(objects(501))).toMatchObject({ column: 1504, reason: 'Nesting is too deep' });
  });

  it('counts constructor arguments as a level', () => {
    const text = '['.repeat(500) + 'NumberInt(1)' + ']'.repeat(500);
    expect(parseError(text)).toMatchObject({ column: 511, reason: 'Nesting is too deep' });
  });

  it('parses a long flat array', () => {
    const v = parseShellSyntax(`[${Array.from({ length: 20000 }, (_, i) => i).join(',')}]`);
    expect(v.type === 'array' && v.items.length).toBe(20000);
  });
});

describe('refusal of code constructs', () => {
  it.each([
    ['this', 1, /"this" is code/],
    ['class A {}', 1, /"class" is code/],
    ['{ a: void 0 }', 6, /"void" is code/],
    ['{ a: typeof x }', 6, /"typeof" is code/],
    ['{ a: delete x }', 6, /"delete" is code/],
    ['{ a: yield }', 6, /"yield" is code/],
    ['{ a: import("fs") }', 6, /"import" is code/],
    ['{ a: async () => 1 }', 6, /"async" is code/],
    ['{ a: new new ObjectId() }', 6, /"new" is code/],
    ['{ a: new (ObjectId)() }', 10, /Expected a constructor name/],
    ['{ a: constructor("x") }', 6, /Unknown function "constructor"/],
    ['{ a: toString() }', 6, /Unknown function "toString"/],
    ['{ a: hasOwnProperty("x") }', 6, /Unknown function "hasOwnProperty"/],
    ['{ a: ObjectId.constructor("return 1") }', 6, /Unknown function "ObjectId.constructor"/],
    ['{ a: Binary.createFromBase64.call(null, "AQID") }', 6, /Unknown function/],
    ['{ a: require("child_process") }', 6, /Unknown function "require"/],
    ['{ a: __proto__ }', 6, /Unknown name "__proto__"/],
    ['{ a: globalThis.process }', 6, /Unknown name "globalThis.process"/],
    ['{ a: String.raw`x` }', 6, /Unknown name "String.raw"/],
    ['{ a: x = 1 }', 6, /Unknown name "x"/],
    ['(function () {})()', 1, /Parentheses/],
    ['{ a: [].constructor }', 8, /Property access/],
    ['{ a: "x".length }', 9, /Property access/],
    ['{ a: /x/.source }', 9, /Property access/],
    ['{ a: ObjectId("65f0a1b2c3d4e5f6a7b8c9d0")["toString"]() }', 42, /Property access/],
    ['{ a: 1 }.a', 9, /Property access/],
    ['{ a: 1, b: 2 } && x', 16, /Operators/],
    ['{ a: 1 } ? 1 : 2', 10, /Operators/],
    ['{ a: 1 == 1 }', 8, /Operators/],
    ['{ a: 1 }, { b: 2 }', 9, /Unexpected "," after the value/],
    ['!{}', 1, /Unexpected "!"/],
    ['{ get a() {} }', 7, /Expected ":" after key "get"/],
  ])('%s', (text, column, message) => {
    const e = parseError(text);
    expect(e.message).toMatch(message);
    expect(e.line).toBe(1);
    expect(e.column).toBe(column);
  });

  const hook = '__shellSyntaxTestHook';
  afterEach(() => {
    Reflect.deleteProperty(globalThis, hook);
  });

  it('never calls a global function named in the text', () => {
    let called = false;
    Reflect.set(globalThis, hook, () => {
      called = true;
      return 1;
    });
    expect(parseError(`{ a: ${hook}() }`).message).toMatch(/Unknown function/);
    expect(parseError(`{ a: new ${hook}() }`).message).toMatch(/Unknown function/);
    expect(called).toBe(false);
  });

  it('still accepts the known constructors with and without new, across lines', () => {
    expect(ejson('new NumberLong("5")')).toBe('{"$numberLong":"5"}');
    expect(ejson('new Timestamp(1, 2)')).toBe('{"$timestamp":{"t":1,"i":2}}');
    expect(ejson('new MaxKey')).toBe('{"$maxKey":1}');
    expect(ejson('ObjectId\n(\n"65f0a1b2c3d4e5f6a7b8c9d0"\n,\n)')).toBe(
      '{"$oid":"65f0a1b2c3d4e5f6a7b8c9d0"}',
    );
    expect(parseShellSyntax('new UUID').type).toBe('binary');
  });
});
