import { describe, expect, it } from 'vitest';

import { ScanError } from '../scanner';
import { CsvScanner, csvCell, csvLine, type CsvRecord } from './csv';

/** All records of `text` fed as one chunk. */
function scan(text: string, max?: number): CsvRecord[] {
  const scanner = new CsvScanner(max);
  return [...scanner.feed(text), ...scanner.end()];
}

/** All records of `chunks` fed one after another. */
function scanChunks(chunks: string[], max?: number): CsvRecord[] {
  const scanner = new CsvScanner(max);
  const out: CsvRecord[] = [];
  for (const chunk of chunks) out.push(...scanner.feed(chunk));
  out.push(...scanner.end());
  return out;
}

const cells = (records: CsvRecord[]) => records.map((r) => r.cells);

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('CsvScanner', () => {
  it('splits records and cells with their 1-based start lines', () => {
    expect(scan('name,qty\nwidget,3\ngadget,5\n')).toEqual([
      { cells: ['name', 'qty'], line: 1 },
      { cells: ['widget', '3'], line: 2 },
      { cells: ['gadget', '5'], line: 3 },
    ]);
  });

  it('returns the last record without a trailing line break at end()', () => {
    const scanner = new CsvScanner();
    expect(scanner.feed('a,b\n1,2')).toEqual([{ cells: ['a', 'b'], line: 1 }]);
    expect(scanner.end()).toEqual([{ cells: ['1', '2'], line: 2 }]);
  });

  it('an empty file has no records', () => {
    expect(scan('')).toEqual([]);
    expect(scan('\n\n\r\n')).toEqual([]);
  });

  it('keeps empty cells, also a trailing one after a comma', () => {
    expect(cells(scan('a,,c\n,,\nx,\n'))).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
      ['x', ''],
    ]);
    // A trailing comma at the very end of the file (no line break) too.
    expect(cells(scan('x,'))).toEqual([['x', '']]);
  });

  it('reads quoted cells with commas, doubled quotes and an empty quoted cell', () => {
    expect(cells(scan('"a,b","say ""hi""","",plain\n'))).toEqual([
      ['a,b', 'say "hi"', '', 'plain'],
    ]);
  });

  it('keeps a quote inside an unquoted cell as text (lenient)', () => {
    expect(cells(scan('5" pipe,ab"c\n'))).toEqual([['5" pipe', 'ab"c']]);
  });

  it('keeps edge spaces of unquoted and quoted cells', () => {
    expect(cells(scan(' a ," b "\n'))).toEqual([[' a ', ' b ']]);
  });

  it('a quote after a leading space is text, not the start of a quoted cell', () => {
    expect(cells(scan(' "b",c\n'))).toEqual([[' "b"', 'c']]);
  });

  it.each([
    ['LF', '\n'],
    ['CRLF', '\r\n'],
    ['CR', '\r'],
  ])('ends records at %s line breaks and counts the lines', (_name, eol) => {
    expect(scan(`a,b${eol}1,2${eol}${eol}3,4${eol}`)).toEqual([
      { cells: ['a', 'b'], line: 1 },
      { cells: ['1', '2'], line: 2 },
      { cells: ['3', '4'], line: 4 },
    ]);
  });

  it('ends a record at a line break right after a closing quote', () => {
    expect(scan('"a"\r\n"b"\n"c"\r"d"')).toEqual([
      { cells: ['a'], line: 1 },
      { cells: ['b'], line: 2 },
      { cells: ['c'], line: 3 },
      { cells: ['d'], line: 4 },
    ]);
  });

  it('keeps line breaks inside quotes as cell text and counts them for later lines', () => {
    expect(scan('note,n\n"line one\nline two",1\n"a\r\nb",2\nlast,3\n')).toEqual([
      { cells: ['note', 'n'], line: 1 },
      { cells: ['line one\nline two', '1'], line: 2 },
      { cells: ['a\r\nb', '2'], line: 4 },
      { cells: ['last', '3'], line: 6 },
    ]);
  });

  it('counts a CR-only line break inside quotes for the lines that follow', () => {
    // CR-only files: the quoted cell spans lines 2-3, so the next record starts on line 4.
    expect(scan('h\r"x\ry"\rz\r')).toEqual([
      { cells: ['h'], line: 1 },
      { cells: ['x\ry'], line: 2 },
      { cells: ['z'], line: 4 },
    ]);
  });

  it('skips blank lines between records, before the first and at the end', () => {
    expect(scan('\n\na\n\n\nb\n\n')).toEqual([
      { cells: ['a'], line: 3 },
      { cells: ['b'], line: 6 },
    ]);
  });

  it('a line of spaces is a record, not a blank line', () => {
    expect(cells(scan('a\n  \nb\n'))).toEqual([['a'], ['  '], ['b']]);
  });

  it('skips a byte order mark at the start of the file only', () => {
    expect(cells(scan('﻿name\nx\n'))).toEqual([['name'], ['x']]);
    // A BOM-like character later in the file is data.
    expect(cells(scanChunks(['a\n', '﻿b\n']))).toEqual([['a'], ['﻿b']]);
    // A BOM before a quoted first cell.
    expect(cells(scan('﻿"q,1",2\n'))).toEqual([['q,1', '2']]);
  });

  describe('chunk boundaries', () => {
    const text =
      '﻿id,"note, quoted",n\r\n' +
      '1,"say ""hi""\nsecond line",3\r\n' +
      '\r\n' +
      '2,,\r' +
      '3,"",x\n' +
      '"4","a""",\n';

    it('gives the same records wherever the text is cut into two chunks', () => {
      const whole = scan(text);
      expect(whole).toHaveLength(5);
      // From 1: a file stream never delivers an empty first chunk.
      for (let at = 1; at <= text.length; at++) {
        expect(scanChunks([text.slice(0, at), text.slice(at)]), `cut at ${String(at)}`).toEqual(
          whole,
        );
      }
    });

    it('gives the same records when fed one character at a time', () => {
      expect(scanChunks([...text])).toEqual(scan(text));
    });

    it('a CRLF cut between CR and LF is one line break', () => {
      expect(scanChunks(['a\r', '\nb\r', '\n'])).toEqual([
        { cells: ['a'], line: 1 },
        { cells: ['b'], line: 2 },
      ]);
    });

    it('a doubled quote cut between its two quotes stays one quote', () => {
      expect(cells(scanChunks(['"a"', '"b"\n']))).toEqual([['a"b']]);
    });
  });

  describe('errors', () => {
    it('refuses text after a closing quote, naming its line', () => {
      const error = thrown(() => scan('a\n"b"c\n'));
      expect(error).toBeInstanceOf(ScanError);
      expect((error as ScanError).line).toBe(2);
      expect((error as Error).message).toBe('Line 2: text after a closing quote');
    });

    it('refuses a space after a closing quote too', () => {
      expect(() => scan('"b" ,c\n')).toThrow(/text after a closing quote/);
    });

    it('returns the records before a broken one, then throws on the next call', () => {
      const scanner = new CsvScanner();
      expect(scanner.feed('a\nb\n"c"x\nd\n')).toEqual([
        { cells: ['a'], line: 1 },
        { cells: ['b'], line: 2 },
      ]);
      expect(() => scanner.feed('more\n')).toThrow(ScanError);
      expect(() => scanner.end()).toThrow(/Line 3: text after a closing quote/);
    });

    it('throws at once when no record came before the broken point', () => {
      const scanner = new CsvScanner();
      expect(() => scanner.feed('"a"b')).toThrow(ScanError);
    });

    it('refuses a file that ends inside a quoted cell, naming where the record starts', () => {
      const scanner = new CsvScanner();
      expect(scanner.feed('h\n1\n"open\nstill open\n')).toEqual([
        { cells: ['h'], line: 1 },
        { cells: ['1'], line: 2 },
      ]);
      const error = thrown(() => scanner.end());
      expect(error).toBeInstanceOf(ScanError);
      expect((error as Error).message).toBe('Line 3: the file ends inside a quoted cell');
    });

    it('a file ending right after a closing quote is complete', () => {
      expect(cells(scan('"a","b"'))).toEqual([['a', 'b']]);
    });

    it('accepts a record of exactly maxRecordChars characters and refuses a longer one', () => {
      // The separator counts: "abc,d" is 5 characters.
      expect(cells(scan('abc,d\n', 5))).toEqual([['abc', 'd']]);
      const error = thrown(() => scan('ok\nabc,de\n', 5));
      expect(error).toBeInstanceOf(ScanError);
      expect((error as ScanError).line).toBe(2);
      expect((error as Error).message).toMatch(/a record is longer than 5 characters/);
    });

    it('the record limit counts every record anew', () => {
      expect(cells(scan('abcde\nabcde\nabcde\n', 5))).toEqual([['abcde'], ['abcde'], ['abcde']]);
    });

    it('an unclosed quote hits the record limit instead of holding the whole file', () => {
      const scanner = new CsvScanner(10);
      expect(scanner.feed('h\n')).toEqual([{ cells: ['h'], line: 1 }]);
      expect(() => scanner.feed('"never closed, and the rest of the file\n')).toThrow(
        /Line 2: a record is longer than 10 characters/,
      );
    });

    it('a line of separators only hits the record limit (empty cells are no free ride)', () => {
      const scanner = new CsvScanner(10);
      expect(() => scanner.feed(','.repeat(1000))).toThrow(
        /Line 1: a record is longer than 10 characters/,
      );
    });

    it('a line of empty quoted cells hits the record limit too', () => {
      const scanner = new CsvScanner(10);
      expect(() => scanner.feed('"",'.repeat(1000))).toThrow(
        /Line 1: a record is longer than 10 characters/,
      );
    });

    it('a record of separators at the limit is still read', () => {
      expect(cells(scan(',,,,\n', 4))).toEqual([['', '', '', '', '']]);
    });

    it('counts cell text and separators but not the quotes around a cell', () => {
      // "ab","c" is ab + , + c = 4 characters of the record.
      expect(cells(scan('"ab","c"\n', 4))).toEqual([['ab', 'c']]);
      expect(() => scan('"ab","c"\n', 3)).toThrow(/Line 1: a record is longer than 3 characters/);
    });

    it('a line of separators fed in many small chunks hits the limit too', () => {
      const scanner = new CsvScanner(10);
      const feedAll = () => {
        for (let i = 0; i < 100; i++) scanner.feed(',,,');
      };
      expect(feedAll).toThrow(/Line 1: a record is longer than 10 characters/);
    });

    it('the separator count starts anew with every record', () => {
      expect(cells(scan(',,,,\n,,,,\n', 4))).toEqual([
        ['', '', '', '', ''],
        ['', '', '', '', ''],
      ]);
    });
  });
});

describe('csvCell and csvLine', () => {
  it('writes plain text unquoted', () => {
    expect(csvCell('widget')).toBe('widget');
    expect(csvCell('')).toBe('');
    expect(csvCell('-5')).toBe('-5');
    expect(csvCell('a b')).toBe('a b');
  });

  it.each([
    ['a comma', 'a,b', '"a,b"'],
    ['a quote', 'say "hi"', '"say ""hi"""'],
    ['a LF', 'a\nb', '"a\nb"'],
    ['a CR', 'a\rb', '"a\rb"'],
    ['a leading space', ' a', '" a"'],
    ['a trailing space', 'a ', '"a "'],
    ['a leading tab', '\ta', '"\ta"'],
  ])('quotes a cell with %s', (_what, text, expected) => {
    expect(csvCell(text)).toBe(expected);
  });

  it('writes a line that the scanner reads back to the same cells', () => {
    const row = ['plain', 'a,b', 'say "hi"', 'two\nlines', ' edge ', '', 'cr\r\nlf'];
    const line = csvLine(row);
    expect(line.endsWith('\n')).toBe(true);
    expect(cells(scan(line))).toEqual([row]);
  });

  it('writes a record of one empty cell as "" so that it is no blank line', () => {
    expect(csvLine([''])).toBe('""\n');
    expect(csvLine(['', ''])).toBe(',\n');
    expect(csvLine(['x'])).toBe('x\n');
    const text = csvLine(['email']) + csvLine(['a@x']) + csvLine(['']) + csvLine(['b@x']);
    expect(cells(scan(text))).toEqual([['email'], ['a@x'], [''], ['b@x']]);
  });
});
