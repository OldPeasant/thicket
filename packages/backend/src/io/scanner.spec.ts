import { describe, expect, it } from 'vitest';

import {
  JsonScanner,
  LineScanner,
  MAX_VALUE_CHARS,
  ScanError,
  type Scanner,
  type ScannedValue,
} from './scanner';

type Make = () => Scanner;

/** Feeds `chunks` one after another and ends the scanner; returns every value. */
function scan(make: Make, chunks: string[]): ScannedValue[] {
  const scanner = make();
  const out: ScannedValue[] = [];
  for (const chunk of chunks) out.push(...scanner.feed(chunk));
  out.push(...scanner.end());
  return out;
}

/** Every way to cut `text` in two, plus one character per chunk. */
function splits(text: string): string[][] {
  const result: string[][] = [[text]];
  for (let i = 1; i < text.length; i++) result.push([text.slice(0, i), text.slice(i)]);
  result.push([...text]);
  return result;
}

/** Asserts that `text` scans to `expected` however it is cut into chunks. */
function expectAnySplit(make: Make, text: string, expected: ScannedValue[]): void {
  for (const chunks of splits(text)) {
    expect(scan(make, chunks), JSON.stringify(chunks)).toEqual(expected);
  }
}

/** The ScanError thrown for `text` (whole, or one character per chunk). */
function scanError(make: Make, chunks: string[]): ScanError {
  try {
    scan(make, chunks);
  } catch (error) {
    expect(error).toBeInstanceOf(ScanError);
    return error as ScanError;
  }
  throw new Error('expected a ScanError');
}

const json: Make = () => new JsonScanner();
const lines: Make = () => new LineScanner();

describe('JsonScanner: one array of documents', () => {
  it('splits an exported array into its documents with their start lines', () => {
    const text = '[\n{"_id":1,"a":"x"},\n{"_id":2,"b":[1,2,{"c":3}]}\n]\n';
    expectAnySplit(json, text, [
      { text: '{"_id":1,"a":"x"}', line: 2 },
      { text: '{"_id":2,"b":[1,2,{"c":3}]}', line: 3 },
    ]);
  });

  it('keeps commas, brackets, quotes and escapes inside strings out of the structure', () => {
    const doc = String.raw`{"s":"a, ] } [ { \" \\","t":"\\\"","u":"]"}`;
    const text = `[${doc} , {"k":"]"}]`;
    expectAnySplit(json, text, [
      { text: doc, line: 1 },
      { text: '{"k":"]"}', line: 1 },
    ]);
    // The scanned text is the document unchanged: it still parses to the same values.
    expect(JSON.parse(doc)).toEqual({ s: 'a, ] } [ { " \\', t: '\\"', u: ']' });
  });

  it('handles deeply nested brackets in an element', () => {
    const doc = '{"a":[[[{"b":[{}]}]]],"c":{"d":{"e":[]}}}';
    expectAnySplit(json, `[${doc}]`, [{ text: doc, line: 1 }]);
  });

  it('counts lines across multi-line elements', () => {
    const text = '[{\n  "a": 1\n},\n\n  {\n"b":\n2}\n]';
    expect(scan(json, [text])).toEqual([
      { text: '{\n  "a": 1\n}', line: 1 },
      { text: '{\n"b":\n2}', line: 5 },
    ]);
  });

  it('yields scalar and array elements as values of their own (they fail later, alone)', () => {
    expectAnySplit(json, '[1, "two", [3], null]', [
      { text: '1', line: 1 },
      { text: '"two"', line: 1 },
      { text: '[3]', line: 1 },
      { text: 'null', line: 1 },
    ]);
  });

  it('accepts an empty array (also with spaces) and an empty file', () => {
    expect(scan(json, ['[]'])).toEqual([]);
    expect(scan(json, [' [ \n ] \n'])).toEqual([]);
    expect(scan(json, [''])).toEqual([]);
    expect(scan(json, ['  \n\t '])).toEqual([]);
  });

  it('skips a byte order mark and CRLF line ends', () => {
    expectAnySplit(json, '\uFEFF[\r\n{"a":1},\r\n{"b":2}\r\n]\r\n', [
      { text: '{"a":1}', line: 2 },
      { text: '{"b":2}', line: 3 },
    ]);
  });

  it('a malformed element whose brackets balance comes out on its own', () => {
    expect(scan(json, ['[{"a":1},\n{"a": },\n{"a":3}]'])).toEqual([
      { text: '{"a":1}', line: 1 },
      { text: '{"a": }', line: 2 },
      { text: '{"a":3}', line: 3 },
    ]);
  });

  it('refuses text after the closing ]', () => {
    for (const chunks of [['[{"a":1}] {"b":2}'], [...'[{"a":1}]\nx']]) {
      expect(scanError(json, chunks).message).toMatch(/after the closing \]/);
    }
    expect(scanError(json, ['[{"a":1}]\n\nx']).line).toBe(3);
  });

  it('returns the values completed before a broken point, then throws on the next call', () => {
    const scanner = new JsonScanner();
    expect(scanner.feed('[{"a":1},\n{"b":2},\n}')).toEqual([
      { text: '{"a":1}', line: 1 },
      { text: '{"b":2}', line: 2 },
    ]);
    expect(() => scanner.feed('{"c":3}]')).toThrow(/^Line 3: unexpected \}/);
    expect(() => scanner.end()).toThrow(/^Line 3: unexpected \}/);
    expect(scanError(json, ['[{"a":1},\n}']).message).toBe('Line 2: unexpected }');
  });

  it('returns the array documents before text after the closing ], then throws it at the end', () => {
    const scanner = new JsonScanner();
    expect(scanner.feed('[{"a":1},\n{"b":2}]\nx')).toEqual([
      { text: '{"a":1}', line: 1 },
      { text: '{"b":2}', line: 2 },
    ]);
    const error = (() => {
      try {
        scanner.end();
      } catch (e) {
        return e;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(ScanError);
    expect(error).toMatchObject({
      line: 3,
      message: 'Line 3: unexpected text after the closing ]',
    });
  });

  it('refuses a missing value before a comma', () => {
    expect(scanError(json, ['[,{"a":1}]']).message).toMatch(/missing value before ,/);
    const error = scanError(json, ['[{"a":1},\n,{"b":2}]']);
    expect(error.line).toBe(2);
    expect(error.message).toBe('Line 2: missing value before ,');
    expect(error.name).toBe('ScanError');
  });

  it('refuses a file that ends before the closing ]', () => {
    expect(scanError(json, ['[{"a":1},\n{"b":2}']).message).toMatch(/before the closing \]/);
    expect(scanError(json, ['[']).message).toMatch(/before the closing \]/);
  });

  it('refuses a file that ends inside a string', () => {
    const error = scanError(json, ['[{"a":"open\n']);
    expect(error.message).toMatch(/inside a string/);
  });

  it('refuses a closing bracket that closes the array too early', () => {
    // `}` at the array's own level: it would close more than was opened.
    expect(scanError(json, ['[{"a":1}}]']).message).toMatch(/unexpected \}/);
  });
});

describe('JsonScanner: documents one after another (mongoexport)', () => {
  it('splits concatenated documents (newline, space or nothing between them)', () => {
    expectAnySplit(json, '{"_id":1}\n{"_id":2} {"_id":3}{"_id":4}\n', [
      { text: '{"_id":1}', line: 1 },
      { text: '{"_id":2}', line: 2 },
      { text: '{"_id":3}', line: 2 },
      { text: '{"_id":4}', line: 2 },
    ]);
  });

  it('reports the line where a multi-line document starts', () => {
    expect(scan(json, ['\n\n{\n"a": [1,\n2]\n}\n{"b":"x\\ny"}'])).toEqual([
      { text: '{\n"a": [1,\n2]\n}', line: 3 },
      { text: '{"b":"x\\ny"}', line: 7 },
    ]);
  });

  it('strings with braces and escaped quotes stay inside their document', () => {
    const a = String.raw`{"s":"} { \"]\" \\"}`;
    const b = '{"t":"{"}';
    expectAnySplit(json, `${a}\n${b}`, [
      { text: a, line: 1 },
      { text: b, line: 2 },
    ]);
  });

  it('bare scalars and arrays come out as values of their own', () => {
    expectAnySplit(json, '{"a":1} 42 true\n"str" [1,2] null{"b":2}', [
      { text: '{"a":1}', line: 1 },
      { text: '42', line: 1 },
      { text: 'true', line: 1 },
      { text: '"str"', line: 2 },
      { text: '[1,2]', line: 2 },
      { text: 'null', line: 2 },
      { text: '{"b":2}', line: 2 },
    ]);
  });

  it('a scalar at the end of the file is the last value', () => {
    expectAnySplit(json, '{"a":1}\n7', [
      { text: '{"a":1}', line: 1 },
      { text: '7', line: 2 },
    ]);
    expect(scan(json, ['"only"'])).toEqual([{ text: '"only"', line: 1 }]);
  });

  it('skips a byte order mark and CRLF line ends', () => {
    expectAnySplit(json, '\uFEFF{"a":1}\r\n{"b":2}\r\n', [
      { text: '{"a":1}', line: 1 },
      { text: '{"b":2}', line: 2 },
    ]);
  });

  it('a malformed document whose brackets balance comes out on its own', () => {
    expect(scan(json, ['{"a":1}\n{"a": }\n{"a":3}'])).toEqual([
      { text: '{"a":1}', line: 1 },
      { text: '{"a": }', line: 2 },
      { text: '{"a":3}', line: 3 },
    ]);
  });

  it('refuses a stray closing bracket', () => {
    const top = scanError(json, ['{"a":1}\n}']);
    expect(top.message).toBe('Line 2: unexpected }');
    expect(top.line).toBe(2);
    expect(scanError(json, ['{"a":1}]']).message).toMatch(/unexpected \]/);
    expect(scanError(json, ['{"a":1}}']).message).toMatch(/unexpected \}/);
    expect(scanError(json, ['1}']).message).toMatch(/unexpected \}/);
  });

  it('returns the documents completed before a stray bracket, then throws on the next call', () => {
    const scanner = new JsonScanner();
    expect(scanner.feed('{"a":1}\n{"b":2}\n}\n{"c":3}')).toEqual([
      { text: '{"a":1}', line: 1 },
      { text: '{"b":2}', line: 2 },
    ]);
    expect(() => scanner.end()).toThrow(/^Line 3: unexpected \}/);
  });

  it('a broken point with no value completed in its chunk throws at once', () => {
    const scanner = new JsonScanner();
    expect(scanner.feed('{"a":1}\n')).toEqual([{ text: '{"a":1}', line: 1 }]);
    expect(() => scanner.feed('}')).toThrow(/^Line 2: unexpected \}/);
  });

  it('refuses a file that ends inside a document', () => {
    for (const chunks of [['{"a":1}\n{"b":'], [...'{"a":{"b":1}']]) {
      expect(scanError(json, chunks).message).toMatch(/ends inside a document/);
    }
  });

  it('refuses a file that ends inside a string', () => {
    expect(scanError(json, ['{"a":"unterminated']).message).toMatch(/inside a string/);
  });

  it('feed returns each value as soon as its chunk completes it', () => {
    const scanner = new JsonScanner();
    expect(scanner.feed('{"a":')).toEqual([]);
    expect(scanner.feed('1}{"b"')).toEqual([{ text: '{"a":1}', line: 1 }]);
    expect(scanner.feed(':2}\n')).toEqual([{ text: '{"b":2}', line: 1 }]);
    expect(scanner.end()).toEqual([]);
  });
});

describe('LineScanner (JSON Lines)', () => {
  it('yields every non-empty line with its 1-based line number', () => {
    expectAnySplit(lines, '{"a":1}\n\n  {"b":2}  \n\n{"c":"x}\\n{"}\n', [
      { text: '{"a":1}', line: 1 },
      { text: '{"b":2}', line: 3 },
      { text: '{"c":"x}\\n{"}', line: 5 },
    ]);
  });

  it('keeps the last line without a trailing newline', () => {
    expectAnySplit(lines, '{"a":1}\n{"b":2}', [
      { text: '{"a":1}', line: 1 },
      { text: '{"b":2}', line: 2 },
    ]);
  });

  it('removes a byte order mark on the first line only and CR of CRLF line ends', () => {
    expectAnySplit(lines, '\uFEFF{"a":1}\r\n\r\n{"b":2}\r\n', [
      { text: '{"a":1}', line: 1 },
      { text: '{"b":2}', line: 3 },
    ]);
    // U+FEFF at the start of a later line is trimmed like other white space.
    expect(scan(lines, ['{"a":1}\n\uFEFF{"b":2}'])[1]).toEqual({ text: '{"b":2}', line: 2 });
  });

  it('broken lines come out unchanged (they fail alone when parsed)', () => {
    expect(scan(lines, ['{"a": }\n[1,2]\n42\n{"b":\n'])).toEqual([
      { text: '{"a": }', line: 1 },
      { text: '[1,2]', line: 2 },
      { text: '42', line: 3 },
      { text: '{"b":', line: 4 },
    ]);
  });

  it('an empty or blank file has no values', () => {
    expect(scan(lines, [''])).toEqual([]);
    expect(scan(lines, ['\n\r\n  \n'])).toEqual([]);
  });

  it('feed returns each line as soon as its newline arrives', () => {
    const scanner = new LineScanner();
    expect(scanner.feed('{"a"')).toEqual([]);
    expect(scanner.feed(':1}\n{"b":2}')).toEqual([{ text: '{"a":1}', line: 1 }]);
    expect(scanner.end()).toEqual([{ text: '{"b":2}', line: 2 }]);
    expect(scanner.end()).toEqual([]);
  });
});

/** Feeds `head`, then 10-character chunks until the scanner throws; the error and chunks fed. */
function growUntilError(scanner: Scanner, head: string, chunk: string) {
  const first = scanner.feed(head);
  let fed = 0;
  try {
    for (; fed < 1000; fed++) scanner.feed(chunk);
  } catch (error) {
    return { first, error, fed };
  }
  throw new Error('expected a ScanError');
}

describe('value size limit', () => {
  it('MAX_VALUE_CHARS leaves room for a 16 MiB document in EJSON', () => {
    expect(MAX_VALUE_CHARS).toBeGreaterThanOrEqual(3 * 16 * 1024 * 1024);
  });

  it.each([
    ['an array element', '[{"a":1},\n\n{"b":"', 3],
    ['a document in a sequence (unclosed {)', '{"a":1}\n\n{"b":"', 3],
    ['a bare scalar in a sequence', '{"a":1}\n\ntrue', 3],
  ])(
    'JsonScanner refuses %s that grows past the limit, naming its first line',
    (_w, head, line) => {
      const { first, error, fed } = growUntilError(new JsonScanner(100), head, 'x'.repeat(10));
      expect(first).toEqual([{ text: '{"a":1}', line: 1 }]);
      expect(error).toBeInstanceOf(ScanError);
      expect(error).toMatchObject({ line });
      expect((error as Error).message).toMatch(
        new RegExp(`^Line ${String(line)}: a value is longer than 100 characters`),
      );
      // It stops as soon as the value is too long, not at the end of the file.
      expect(fed).toBeLessThanOrEqual(10);
    },
  );

  it('JsonScanner refuses a value completed in one chunk that is too long', () => {
    expect(() => new JsonScanner(10).feed('{"a":"0123456789"}')).toThrow(
      /^Line 1: a value is longer than 10 /,
    );
    // Values completed before it in the same chunk still come out; the error follows.
    const scanner = new JsonScanner(10);
    expect(scanner.feed('[{"a":1},\n{"a":"0123456789"}]')).toEqual([{ text: '{"a":1}', line: 1 }]);
    expect(() => scanner.end()).toThrow(/^Line 2: a value is longer than 10 /);
  });

  it('JsonScanner accepts a value of exactly the limit, however it is cut', () => {
    const doc = '{"a":"12"}';
    expectAnySplit(() => new JsonScanner(doc.length), `[${doc}]`, [{ text: doc, line: 1 }]);
    expectAnySplit(() => new JsonScanner(doc.length), doc, [{ text: doc, line: 1 }]);
  });

  it('LineScanner refuses a line that grows past the limit (a minified file), naming it', () => {
    const { first, error, fed } = growUntilError(new LineScanner(100), '{"a":1}\n\n[{"b":', 'x,');
    expect(first).toEqual([{ text: '{"a":1}', line: 1 }]);
    expect(error).toBeInstanceOf(ScanError);
    expect(error).toMatchObject({ line: 3 });
    expect((error as Error).message).toMatch(/^Line 3: a value is longer than 100 characters/);
    expect(fed).toBeLessThanOrEqual(50);
  });

  it('LineScanner returns the lines before a too long one, then throws on the next call', () => {
    const scanner = new LineScanner(10);
    expect(scanner.feed('{"a":1}\n{"a":"0123456789"}\n{"b":2}\n')).toEqual([
      { text: '{"a":1}', line: 1 },
    ]);
    expect(() => scanner.feed('{"c":3}\n')).toThrow(/^Line 2: a value is longer than 10 /);
    expect(() => scanner.end()).toThrow(/^Line 2: a value is longer than 10 /);
    expect(() => new LineScanner(10).feed('{"a":"0123456789"}')).toThrow(/^Line 1: /);
  });

  it('LineScanner accepts a line of exactly the limit, however it is cut', () => {
    expectAnySplit(() => new LineScanner(7), '{"a":1}\n{"b":2}', [
      { text: '{"a":1}', line: 1 },
      { text: '{"b":2}', line: 2 },
    ]);
  });
});
