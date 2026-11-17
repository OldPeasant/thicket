import { MAX_VALUE_CHARS, ScanError } from '../scanner';

/**
 * CSV text (RFC 4180): comma-separated cells; a cell holding a comma, quote, line break or an
 * edge space is quoted with `"` (a quote inside doubled). Records end with `\n`, `\r\n` or `\r`;
 * quoted cells may span lines.
 */

/** One record of a CSV file and the 1-based line where it starts. */
export interface CsvRecord {
  cells: string[];
  line: number;
}

type State = 'cellStart' | 'unquoted' | 'quoted' | 'quoteSeen';

/**
 * Splits CSV text into records without reading the whole file: chunks go in, complete records
 * come out. Blank lines are skipped, a byte order mark at the start too. A quote inside an
 * unquoted cell is kept as text (lenient, like most readers); text after a closing quote is a
 * `ScanError`, and so is a record longer than `maxRecordChars` (a file of the wrong shape, e.g.
 * an unclosed quote, never makes it hold the whole file).
 */
export class CsvScanner {
  private state: State = 'cellStart';
  private cells: string[] = [];
  private cell = '';
  private size = 0;
  private line = 1;
  private recordLine = 1;
  /** The last character was a `\r` ending a line: a `\n` right after it belongs to it. */
  private afterCr = false;
  private first = true;
  private failure: ScanError | undefined;

  /** @param maxRecordChars longest record accepted (tests use a small one). */
  constructor(private readonly maxRecordChars = MAX_VALUE_CHARS) {}

  feed(chunk: string): CsvRecord[] {
    if (this.failure) throw this.failure;
    const out: CsvRecord[] = [];
    try {
      this.scan(chunk, out);
    } catch (error) {
      // The records completed before the broken point still come out; the error follows.
      if (!(error instanceof ScanError) || out.length === 0) throw error;
      this.failure = error;
    }
    return out;
  }

  /** The file ended: returns the last record, or throws `ScanError` inside an open quote. */
  end(): CsvRecord[] {
    if (this.failure) throw this.failure;
    if (this.state === 'quoted') {
      throw new ScanError('the file ends inside a quoted cell', this.recordLine);
    }
    const out: CsvRecord[] = [];
    if (this.state !== 'cellStart' || this.cells.length > 0) this.endRecord(out);
    return out;
  }

  private scan(chunk: string, out: CsvRecord[]): void {
    let text = chunk;
    if (this.first) {
      this.first = false;
      if (text.startsWith('﻿')) text = text.slice(1);
    }
    for (const c of text) {
      const crlf = this.afterCr && c === '\n';
      this.afterCr = false;
      if (this.state === 'quoted') {
        // Line breaks inside quotes are cell text, kept as written (counted for the line
        // numbers: `\r\n` once, a lone `\r` or `\n` once each).
        if (c === '"') this.state = 'quoteSeen';
        else this.append(c);
        if (c === '\r') {
          this.afterCr = true;
          this.line++;
        } else if (c === '\n' && !crlf) this.line++;
        continue;
      }
      if (crlf) continue;
      const newline = c === '\n' || c === '\r';
      if (newline) this.afterCr = c === '\r';
      switch (this.state) {
        case 'cellStart':
          if (newline) {
            // A blank line is no record; after a comma it ends a record with an empty last cell.
            if (this.cells.length > 0) this.endRecord(out);
          } else {
            if (this.cells.length === 0) this.recordLine = this.line;
            if (c === '"') this.state = 'quoted';
            else if (c === ',') this.separator();
            else {
              this.state = 'unquoted';
              this.append(c);
            }
          }
          break;
        case 'unquoted':
          if (newline) this.endRecord(out);
          else if (c === ',') this.separator();
          else this.append(c);
          break;
        case 'quoteSeen':
          if (c === '"') {
            this.state = 'quoted';
            this.append('"');
          } else if (c === ',') this.separator();
          else if (newline) this.endRecord(out);
          else throw new ScanError('text after a closing quote', this.line);
          break;
      }
      if (newline) this.line++;
    }
  }

  /** Counts `n` characters of the record against the limit. */
  private grow(n: number): void {
    this.size += n;
    if (this.size > this.maxRecordChars) {
      throw new ScanError(
        `a record is longer than ${String(this.maxRecordChars)} characters (is the file CSV?)`,
        this.recordLine,
      );
    }
  }

  private append(c: string): void {
    this.grow(c.length);
    this.cell += c;
  }

  /** A comma ends a cell; it counts as a character, so a line of separators is limited too. */
  private separator(): void {
    this.grow(1);
    this.endCell();
  }

  private endCell(): void {
    this.cells.push(this.cell);
    this.cell = '';
    this.state = 'cellStart';
  }

  private endRecord(out: CsvRecord[]): void {
    this.endCell();
    out.push({ cells: this.cells, line: this.recordLine });
    this.cells = [];
    this.size = 0;
  }
}

const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;

/** One cell as CSV text: quoted when it holds a comma, quote, line break or edge space. */
export function csvCell(text: string): string {
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * One record as a CSV line (with its `\n`). A record of one empty cell is written `""`: a blank
 * line would be read as no record.
 */
export function csvLine(cells: readonly string[]): string {
  if (cells.length === 1 && cells[0] === '') return '""\n';
  return `${cells.map(csvCell).join(',')}\n`;
}
