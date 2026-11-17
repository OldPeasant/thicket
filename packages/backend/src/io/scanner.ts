/**
 * Splits import files into the text of their documents without reading the whole file: chunks go
 * in, complete values (with the 1-based line where each one starts) come out.
 *
 * - {@link JsonScanner}: a JSON file that is either one array of documents (`[{…}, {…}]`, what
 *   `io.export` writes) or documents one after another (`{…}\n{…}`, `mongoexport`'s default).
 *   It only tracks strings and bracket depth, so a malformed document whose brackets balance
 *   (`{"a": }`) still comes out on its own and fails alone when parsed.
 * - {@link LineScanner}: JSON Lines, one document per non-empty line.
 *
 * Both refuse a value longer than {@link MAX_VALUE_CHARS} (`ScanError` naming the line where it
 * starts), so a file of the wrong shape (an unclosed `{`, a minified file read as JSON Lines, a
 * binary file) never makes them hold the whole file in memory.
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

/**
 * Most characters of one value. A document is at most 16 MiB of BSON; its EJSON text can be a few
 * times longer (type wrappers such as `{"$numberDouble":"…"}`, base64 binary), so 64 Mi characters
 * leave room for any valid document while bounding the memory a wrong file can take.
 */
export const MAX_VALUE_CHARS = 64 * 1024 * 1024;

const tooLarge = (line: number, max: number) =>
  new ScanError(
    `a value is longer than ${String(max)} characters (is the file in the chosen format?)`,
    line,
  );

const isSpace = (c: string) =>
  c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\uFEFF';

export interface Scanner {
  /**
   * Feeds the next chunk; returns the values completed by it. A broken structure throws
   * `ScanError`, after the values completed before it were returned (then by the next call).
   */
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

  /** Characters of the value being read, in `parts` and the current chunk. */
  private size = 0;

  /** A structure error found after values of the same chunk: thrown by the next call. */
  private failure: ScanError | undefined;

  /** @param maxValueChars longest value accepted (tests use a small one). */
  constructor(private readonly maxValueChars = MAX_VALUE_CHARS) {}

  feed(chunk: string): ScannedValue[] {
    if (this.failure) throw this.failure;
    const out: ScannedValue[] = [];
    try {
      this.scan(chunk, out);
    } catch (error) {
      // The values completed before the broken point still come out; the error follows.
      if (!(error instanceof ScanError) || out.length === 0) throw error;
      this.failure = error;
    }
    return out;
  }

  private scan(chunk: string, out: ScannedValue[]): void {
    // Start of the current value's text inside this chunk (-1: none started in this chunk).
    let from = this.parts ? 0 : -1;
    const close = (to: number) => {
      const parts = this.parts ?? [];
      if (from >= 0) {
        if (this.size + to - from > this.maxValueChars) {
          throw tooLarge(this.valueLine, this.maxValueChars);
        }
        parts.push(chunk.slice(from, to));
      }
      const text = parts.join('').trim();
      if (text.length > 0) out.push({ text, line: this.valueLine });
      this.parts = undefined;
      from = -1;
    };
    const open = (at: number) => {
      this.parts = [];
      this.size = 0;
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
    if (this.parts && from >= 0) {
      this.size += chunk.length - from;
      if (this.size > this.maxValueChars) throw tooLarge(this.valueLine, this.maxValueChars);
      this.parts.push(chunk.slice(from));
    }
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
    if (this.failure) throw this.failure;
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
  /** Parts of the line not ended yet (searched for `\n` only once, as their chunk came in). */
  private carry: string[] = [];
  private carryChars = 0;
  private line = 0;
  /** A line too long, found after values of the same chunk: thrown by the next call. */
  private failure: ScanError | undefined;

  /** @param maxValueChars longest line accepted (tests use a small one). */
  constructor(private readonly maxValueChars = MAX_VALUE_CHARS) {}

  feed(chunk: string): ScannedValue[] {
    if (this.failure) throw this.failure;
    const out: ScannedValue[] = [];
    let start = 0;
    try {
      for (let nl = chunk.indexOf('\n'); nl >= 0; nl = chunk.indexOf('\n', start)) {
        this.take(chunk.slice(start, nl));
        this.push(this.carry.join(''), out);
        this.carry = [];
        this.carryChars = 0;
        start = nl + 1;
      }
      if (start < chunk.length) this.take(chunk.slice(start));
    } catch (error) {
      if (!(error instanceof ScanError) || out.length === 0) throw error;
      this.failure = error;
    }
    return out;
  }

  end(): ScannedValue[] {
    if (this.failure) throw this.failure;
    const out: ScannedValue[] = [];
    if (this.carryChars > 0) this.push(this.carry.join(''), out);
    this.carry = [];
    this.carryChars = 0;
    return out;
  }

  /** Adds text to the current line, refusing a line longer than the limit. */
  private take(part: string): void {
    this.carryChars += part.length;
    if (this.carryChars > this.maxValueChars) {
      throw tooLarge(this.line + 1, this.maxValueChars);
    }
    this.carry.push(part);
  }

  private push(raw: string, out: ScannedValue[]): void {
    this.line++;
    const text = (this.line === 1 ? raw.replace(/^\uFEFF/, '') : raw).trim();
    if (text.length > 0) out.push({ text, line: this.line });
  }
}
