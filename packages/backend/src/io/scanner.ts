/**
 * Splits import files into the text of their documents without reading the whole file: chunks go
 * in, complete values (with the 1-based line where each one starts) come out.
 *
 * - {@link JsonScanner}: a JSON file that is either one array of documents (`[{…}, {…}]`, what
 *   `io.export` writes) or documents one after another (`{…}\n{…}`, `mongoexport`'s default).
 *   It only tracks strings and bracket depth, so a malformed document whose brackets balance
 *   (`{"a": }`) still comes out on its own and fails alone when parsed.
 * - {@link LineScanner}: JSON Lines, one document per non-empty line.
 */

/** The text of one value in the file and the line where it starts. */
export interface ScannedValue {
  text: string;
  line: number;
}

/** The file's structure is broken (unbalanced brackets, text after the array, ...). */
export class ScanError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`Line ${String(line)}: ${message}`);
    this.name = 'ScanError';
  }
}

const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '﻿';

export interface Scanner {
  /** Feeds the next chunk; returns the values completed by it. */
  feed(chunk: string): ScannedValue[];
  /** The file ended; returns the last value, or throws `ScanError` for an unfinished one. */
  end(): ScannedValue[];
}

/** One JSON array of documents, or documents one after another. */
export class JsonScanner implements Scanner {
  private mode: 'start' | 'array' | 'sequence' | 'done' = 'start';
  private depth = 0;
  private inString = false;
  private escaped = false;
  private line = 1;
  /** Parts of the value being read (`undefined` between values). */
  private parts: string[] | undefined;
  private valueLine = 0;
  /** In a sequence: the current top-level value is a bare scalar (no brackets). */
  private scalar = false;

  feed(chunk: string): ScannedValue[] {
    const out: ScannedValue[] = [];
    // Start of the current value's text inside this chunk (-1: none started in this chunk).
    let from = this.parts ? 0 : -1;
    const close = (to: number) => {
      const parts = this.parts ?? [];
      if (from >= 0) parts.push(chunk.slice(from, to));
      const text = parts.join('').trim();
      if (text.length > 0) out.push({ text, line: this.valueLine });
      this.parts = undefined;
      from = -1;
    };
    const open = (at: number) => {
      this.parts = [];
      this.valueLine = this.line;
      from = at;
    };
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk.charAt(i);
      if (c === '\n') this.line++;
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (c === '\\') this.escaped = true;
        else if (c === '"') this.inString = false;
        continue;
      }
      if (this.mode === 'start') {
        if (isSpace(c)) continue;
        if (c === '[') {
          this.mode = 'array';
          this.depth = 1;
          continue;
        }
        this.mode = 'sequence';
      }
      if (this.mode === 'done') {
        if (!isSpace(c)) throw new ScanError('unexpected text after the closing ]', this.line);
        continue;
      }
      if (this.mode === 'array') {
        if (this.depth === 1) {
          if (c === ',' || c === ']') {
            if (this.parts) close(i);
            else if (c === ',') throw new ScanError('missing value before ,', this.line);
            if (c === ']') {
              this.depth = 0;
              this.mode = 'done';
            }
            continue;
          }
          if (!this.parts && !isSpace(c)) open(i);
        }
        this.track(c);
        continue;
      }
      // Sequence of top-level values.
      if (this.depth === 0) {
        if (this.scalar && (isSpace(c) || c === '{' || c === '[')) {
          close(i);
          this.scalar = false;
        }
        if (!this.parts) {
          if (isSpace(c)) continue;
          open(i);
          if (c !== '{' && c !== '[') {
            if (c === '}' || c === ']') throw new ScanError(`unexpected ${c}`, this.line);
            this.scalar = true;
          }
        }
      }
      this.track(c);
      if (this.depth === 0 && !this.scalar && this.parts) close(i + 1);
    }
    if (this.parts && from >= 0) this.parts.push(chunk.slice(from));
    return out;
  }

  /** Updates string and depth state for one character outside a string. */
  private track(c: string): void {
    if (c === '"') this.inString = true;
    else if (c === '{' || c === '[') this.depth++;
    else if (c === '}' || c === ']') {
      this.depth--;
      if (this.depth < (this.mode === 'array' ? 1 : 0)) {
        throw new ScanError(`unexpected ${c}`, this.line);
      }
    }
  }

  end(): ScannedValue[] {
    if (this.inString) throw new ScanError('the file ends inside a string', this.line);
    if (this.mode === 'array') throw new ScanError('the file ends before the closing ]', this.line);
    if (this.mode === 'sequence' && this.parts) {
      if (!this.scalar) throw new ScanError('the file ends inside a document', this.line);
      const text = this.parts.join('').trim();
      this.parts = undefined;
      return text.length > 0 ? [{ text, line: this.valueLine }] : [];
    }
    return [];
  }
}

/** JSON Lines: every non-empty line is one value. */
export class LineScanner implements Scanner {
  private carry = '';
  private line = 0;

  feed(chunk: string): ScannedValue[] {
    const out: ScannedValue[] = [];
    const text = this.carry + chunk;
    let start = 0;
    for (let nl = text.indexOf('\n'); nl >= 0; nl = text.indexOf('\n', start)) {
      this.push(text.slice(start, nl), out);
      start = nl + 1;
    }
    this.carry = text.slice(start);
    return out;
  }

  end(): ScannedValue[] {
    const out: ScannedValue[] = [];
    if (this.carry.length > 0) this.push(this.carry, out);
    this.carry = '';
    return out;
  }

  private push(raw: string, out: ScannedValue[]): void {
    this.line++;
    const text = (this.line === 1 ? raw.replace(/^﻿/, '') : raw).trim();
    if (text.length > 0) out.push({ text, line: this.line });
  }
}
