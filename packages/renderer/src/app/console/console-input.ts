/**
 * Pure helpers of the console input: when Enter runs the input, the input history, and applying
 * a completion. No Angular here, so the specs test them directly.
 */

/**
 * Whether `code` reads as a finished input: every bracket closed, no open string, template literal
 * or block comment. Enter runs a finished input and adds a line break to an unfinished one (like
 * mongosh's REPL), so a function can be typed over several lines.
 */
export function isInputComplete(code: string): boolean {
  if (code.trim() === '') return false;
  const stack: string[] = [];
  let i = 0;
  while (i < code.length) {
    const ch = code[i] as string;
    const next = code[i + 1];
    if (ch === '/' && next === '/') {
      const end = code.indexOf('\n', i);
      i = end < 0 ? code.length : end;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = code.indexOf('*/', i + 2);
      if (end < 0) return false;
      i = end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = stringEnd(code, i, ch);
      if (end < 0) return false;
      i = end;
      continue;
    }
    if (ch === '`') {
      const end = templateEnd(code, i);
      if (end < 0) return false;
      i = end;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') stack.push(ch);
    else if (ch === ')' || ch === ']' || ch === '}') {
      // A stray closing bracket is a syntax error: run it, mongosh reports it.
      if (stack.length === 0) return true;
      stack.pop();
    }
    i++;
  }
  return stack.length === 0;
}

/** Index after the closing quote of the string at `start`, -1 when it is not closed on its line. */
function stringEnd(code: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < code.length) {
    const ch = code[i];
    if (ch === '\\') i += 2;
    else if (ch === quote) return i + 1;
    else if (ch === '\n')
      return i; // an unterminated string: a syntax error mongosh reports
    else i++;
  }
  return -1;
}

/** Index after the closing backtick of the template literal at `start`, -1 when it is open. */
function templateEnd(code: string, start: number): number {
  let i = start + 1;
  while (i < code.length) {
    const ch = code[i];
    if (ch === '\\') i += 2;
    else if (ch === '`') return i + 1;
    else i++;
  }
  return -1;
}

/** Entries kept by a `ConsoleHistory`. */
export const HISTORY_LIMIT = 500;

/**
 * The inputs run in a console, newest last, and the position while stepping through them with
 * the arrow keys. Stepping back from the input being typed keeps it as the draft that stepping
 * forward past the newest entry brings back.
 */
export class ConsoleHistory {
  private items: string[] = [];
  /** Position while stepping: `items.length` is the draft. */
  private index = 0;
  private draft = '';

  constructor(private readonly limit = HISTORY_LIMIT) {}

  get entries(): readonly string[] {
    return this.items;
  }

  /** Records a run input (not repeated when it equals the newest entry) and stops stepping. */
  add(code: string): void {
    if (code.trim() !== '' && this.items[this.items.length - 1] !== code) {
      this.items.push(code);
      if (this.items.length > this.limit) this.items.splice(0, this.items.length - this.limit);
    }
    this.index = this.items.length;
    this.draft = '';
  }

  /** The older entry, or `null` at the oldest. `current` is what the input holds now. */
  previous(current: string): string | null {
    if (this.index === 0) return null;
    if (this.index === this.items.length) this.draft = current;
    this.index--;
    return this.items[this.index] ?? null;
  }

  /** The newer entry (the draft after the newest), or `null` when not stepping. */
  next(): string | null {
    if (this.index >= this.items.length) return null;
    this.index++;
    return this.index === this.items.length ? this.draft : (this.items[this.index] ?? null);
  }
}

/**
 * The input after choosing `completion`. mongosh completes the whole input up to the cursor
 * (`db.orders.fin` -> `db.orders.find`), so it replaces that part; the text after the cursor stays.
 */
export function applyCompletion(
  code: string,
  cursor: number,
  completion: string,
): { code: string; cursor: number } {
  return { code: completion + code.slice(cursor), cursor: completion.length };
}

/** The part of a completion the popup shows: its last word (`db.orders.find` -> `find`). */
export function completionLabel(completion: string): string {
  const match = /[\w$]+$/.exec(completion);
  return match ? match[0] : completion.trim();
}

/** Whether the caret at `cursor` is on the first line of `code` (ArrowUp steps the history). */
export function onFirstLine(code: string, cursor: number): boolean {
  return !code.slice(0, cursor).includes('\n');
}

/** Whether the caret at `cursor` is on the last line of `code` (ArrowDown steps the history). */
export function onLastLine(code: string, cursor: number): boolean {
  return !code.slice(cursor).includes('\n');
}
