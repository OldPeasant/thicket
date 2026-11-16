import { BsonModelError } from '../bson/model';

/** A place in the source text. `line` and `column` are 1-based; columns count UTF-16 units. */
export interface SourcePosition {
  /** 0-based offset into the text (UTF-16 code units, as in editors and `String#slice`). */
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

/**
 * A syntax or value error in shell-syntax text, with the position the raw editor and the query
 * bar mark. `message` ends with "(line L, column C)"; `reason` is the message without it.
 */
export class ShellSyntaxError extends BsonModelError implements SourcePosition {
  readonly offset: number;
  readonly line: number;
  readonly column: number;

  constructor(
    readonly reason: string,
    text: string,
    offset: number,
  ) {
    const { line, column } = positionAt(text, offset);
    super(`${reason} (line ${line}, column ${column})`);
    this.offset = offset;
    this.line = line;
    this.column = column;
  }
}

/** Line and column of `offset`; `\n`, `\r\n` and `\r` end a line. */
export function positionAt(text: string, offset: number): SourcePosition {
  const end = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < end; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 0x0a || (ch === 0x0d && text.charCodeAt(i + 1) !== 0x0a)) {
      line++;
      lineStart = i + 1;
    }
  }
  return { offset: end, line, column: end - lineStart + 1 };
}
