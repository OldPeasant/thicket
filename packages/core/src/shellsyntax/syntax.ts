import { ShellSyntaxError } from './errors';

/**
 * Syntax tree of the shell-syntax subset of JavaScript: object and array literals, strings,
 * numbers, regex literals, a few keywords and calls of named constructors. Nothing here runs
 * code; `value.ts` maps the tree to the BSON model and decides which constructors exist.
 */
export type Node =
  | {
      readonly kind: 'object';
      readonly pos: number;
      readonly entries: readonly { readonly key: string; readonly value: Node }[];
    }
  | { readonly kind: 'array'; readonly pos: number; readonly items: readonly Node[] }
  | { readonly kind: 'string'; readonly pos: number; readonly value: string }
  | NumberNode
  | {
      readonly kind: 'regex';
      readonly pos: number;
      readonly pattern: string;
      readonly flags: string;
    }
  /** `true`, `false`, `null`, `undefined`, `NaN`, `Infinity` or a bare `MinKey`/`MaxKey`. */
  | { readonly kind: 'word'; readonly pos: number; readonly name: string }
  | {
      readonly kind: 'call';
      readonly pos: number;
      /** Callee, dotted for static helpers (`Binary.createFromBase64`). */
      readonly name: string;
      readonly args: readonly Node[];
    };

export interface NumberNode {
  readonly kind: 'number';
  readonly pos: number;
  /** The literal's value, sign applied (so `-0` is `-0`). */
  readonly value: number;
  /** Exact value of an integer literal (`12`, `0x1f`, `5n`, with sign); null for `1.5`, `1e3`. */
  readonly exact: bigint | null;
  /** Literal text without `_` separators, sign included (`-1.50`); used for Decimal128. */
  readonly text: string;
  /** A BigInt literal (`5n`). */
  readonly bigint: boolean;
}

const MAX_DEPTH = 500;

const ID_START = /[\p{ID_Start}$_]/uy;
const IDENT = /[\p{ID_Start}$_][\p{ID_Continue}$\u200c\u200d]*/uy;
const ID_PART = /[\p{ID_Continue}$\u200c\u200d]/uy;
const NUMBER =
  /(?:0[xX][\da-fA-F](?:_?[\da-fA-F])*|0[oO][0-7](?:_?[0-7])*|0[bB][01](?:_?[01])*|(?:(?:0|[1-9](?:_?\d)*)(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?)n?/y;
const SPACE = /[\t\v\f \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff\n\r\u2028\u2029]/;
const LINE_BREAK = /[\n\r\u2028\u2029]/;

/** Words that read as code; named in the error so the user sees why the text was refused. */
const CODE_WORDS = new Set([
  'function',
  'this',
  'new',
  'class',
  'async',
  'await',
  'yield',
  'return',
  'typeof',
  'void',
  'delete',
  'import',
  'super',
  'arguments',
  'eval',
  'var',
  'let',
  'const',
  'if',
  'for',
  'while',
  'do',
  'throw',
  'try',
]);

const WORDS = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'NaN',
  'Infinity',
  'MinKey',
  'MaxKey',
]);

/** Parses one value (optionally followed by `;`) into a syntax tree. */
export function parseSyntax(text: string): Node {
  let pos = 0;

  const fail = (reason: string, at = pos): never => {
    throw new ShellSyntaxError(reason, text, at);
  };

  /** Error for an unexpected character after a complete value. */
  const unexpectedAfterValue = (expected: string): never => {
    const ch = text[pos] ?? '';
    if (ch === '.' || ch === '(' || ch === '[') {
      fail('Property access and calls on values are not allowed');
    }
    if (/[+\-*/%&|^<>=?!]/.test(ch)) fail('Operators are not allowed');
    return fail(
      expected
        ? `Expected ${expected} but found ${describe(pos)}`
        : `Unexpected ${describe(pos)} after the value`,
    );
  };

  const skipTrivia = (): void => {
    while (pos < text.length) {
      const ch = text[pos] as string;
      if (SPACE.test(ch)) {
        pos++;
      } else if (text.startsWith('//', pos)) {
        while (pos < text.length && !LINE_BREAK.test(text[pos] as string)) pos++;
      } else if (text.startsWith('/*', pos)) {
        const end = text.indexOf('*/', pos + 2);
        if (end < 0) fail('Unterminated comment');
        pos = end + 2;
      } else {
        return;
      }
    }
  };

  const describe = (at: number): string => {
    if (at >= text.length) return 'end of input';
    IDENT.lastIndex = at;
    const word = IDENT.exec(text)?.[0] ?? text.slice(at, at + 1);
    return `"${word}"`;
  };

  const identifier = (): string | null => {
    IDENT.lastIndex = pos;
    const m = IDENT.exec(text);
    if (!m) return null;
    pos = IDENT.lastIndex;
    return m[0];
  };

  const hexDigits = (count: number): number => {
    const digits = text.slice(pos, pos + count);
    if (!/^[\da-fA-F]+$/.test(digits) || digits.length !== count) fail('Invalid escape sequence');
    pos += count;
    return parseInt(digits, 16);
  };

  const parseString = (): string => {
    const quote = text[pos];
    const start = pos;
    pos++;
    let out = '';
    for (;;) {
      if (pos >= text.length) fail('Unterminated string', start);
      const ch = text[pos] as string;
      if (ch === quote) break;
      if (ch === '\n' || ch === '\r') fail('Unterminated string', start);
      if (ch !== '\\') {
        out += ch;
        pos++;
        continue;
      }
      const escapePos = pos;
      pos++;
      const e = text[pos] as string | undefined;
      pos++;
      switch (e) {
        case undefined:
          return fail('Unterminated string', start);
        case 'n':
          out += '\n';
          break;
        case 'r':
          out += '\r';
          break;
        case 't':
          out += '\t';
          break;
        case 'b':
          out += '\b';
          break;
        case 'f':
          out += '\f';
          break;
        case 'v':
          out += '\v';
          break;
        case 'x':
          out += String.fromCharCode(hexDigits(2));
          break;
        case 'u': {
          if (text[pos] === '{') {
            const close = text.indexOf('}', pos);
            const digits = close < 0 ? '' : text.slice(pos + 1, close);
            const cp = /^[\da-fA-F]{1,8}$/.test(digits) ? parseInt(digits, 16) : NaN;
            if (!(cp <= 0x10ffff)) fail('Invalid escape sequence', escapePos);
            out += String.fromCodePoint(cp);
            pos = close + 1;
          } else {
            out += String.fromCharCode(hexDigits(4));
          }
          break;
        }
        case '\r':
          if (text[pos] === '\n') pos++;
          break;
        case '\n':
        case '\u2028':
        case '\u2029':
          break; // line continuation
        default:
          if (e === '0' && !/\d/.test(text[pos] ?? '')) {
            out += '\0';
          } else if (/\d/.test(e)) {
            fail('Octal escape sequences are not allowed', escapePos);
          } else {
            out += e;
          }
      }
    }
    pos++;
    return out;
  };

  /** A regex literal starting at `/`. */
  const parseRegex = (): Node => {
    const start = pos;
    const end = scanRegexBody(text, pos + 1);
    if (end < 0) fail('Unterminated regular expression', start);
    const pattern = text.slice(start + 1, end);
    pos = end + 1;
    const flagsStart = pos;
    while (pos < text.length) {
      ID_PART.lastIndex = pos;
      if (!ID_PART.test(text)) break;
      pos = ID_PART.lastIndex;
    }
    return { kind: 'regex', pos: start, pattern, flags: text.slice(flagsStart, pos) };
  };

  const parseNumber = (sign: '' | '-' | '+', start: number): NumberNode => {
    NUMBER.lastIndex = pos;
    const m = NUMBER.exec(text);
    if (!m) return fail('Invalid number');
    pos = NUMBER.lastIndex;
    ID_START.lastIndex = pos;
    if (/\d/.test(text[pos] ?? '') || ID_START.test(text)) fail('Invalid number', start);
    const raw = m[0].replace(/_/g, '');
    const bigint = raw.endsWith('n');
    const body = bigint ? raw.slice(0, -1) : raw;
    const integer = /^0[xXoObB]/.test(body) || /^\d+$/.test(body);
    if (bigint && !integer) fail('Invalid number', start);
    const negative = sign === '-';
    const magnitude = integer ? BigInt(body) : null;
    const value = Number(body);
    return {
      kind: 'number',
      pos: start,
      value: negative ? -value : value,
      exact: magnitude === null ? null : negative ? -magnitude : magnitude,
      text: negative ? `-${body}` : body,
      bigint,
    };
  };

  const parseArgs = (depth: number): Node[] => {
    const args: Node[] = [];
    pos++; // (
    for (;;) {
      skipTrivia();
      if (text[pos] === ')') break;
      args.push(parseValue(depth + 1));
      skipTrivia();
      if (text[pos] === ',') {
        pos++;
      } else if (text[pos] !== ')') {
        unexpectedAfterValue('"," or ")"');
      }
    }
    pos++;
    return args;
  };

  const parseCallee = (start: number): string => {
    let name = identifier();
    if (name === null) return fail(`Expected a constructor name after "new"`);
    while (text[pos] === '.') {
      pos++;
      const part = identifier();
      if (part === null) fail(`Expected a name after "."`);
      name += `.${part}`;
    }
    const head = name.split('.')[0] as string;
    if (CODE_WORDS.has(head)) fail(`"${head}" is code, which is not allowed here`, start);
    return name;
  };

  const parseWordOrCall = (depth: number): Node => {
    const start = pos;
    let isNew = false;
    IDENT.lastIndex = pos;
    if (IDENT.exec(text)?.[0] === 'new') {
      isNew = true;
      pos += 3;
      skipTrivia();
    }
    const nameStart = pos;
    const name = parseCallee(start);
    skipTrivia();
    if (text[pos] === '(') return { kind: 'call', pos: start, name, args: parseArgs(depth) };
    if (isNew) return { kind: 'call', pos: start, name, args: [] };
    if (WORDS.has(name)) {
      pos = nameStart + name.length;
      return { kind: 'word', pos: start, name };
    }
    return fail(
      `Unknown name "${name}": write text in quotes; only literals and constructors such as ObjectId("…") are allowed`,
      start,
    );
  };

  const parseObject = (depth: number): Node => {
    const start = pos;
    pos++;
    const entries: { key: string; value: Node }[] = [];
    for (;;) {
      skipTrivia();
      const ch = text[pos];
      if (ch === '}') break;
      const keyPos = pos;
      let key: string;
      let bare = false;
      if (ch === '"' || ch === "'") {
        key = parseString();
      } else if (ch === '[') {
        return fail('Computed keys are not allowed');
      } else if (text.startsWith('...', pos)) {
        return fail('Spread syntax is not allowed');
      } else if (/[\d.]/.test(ch ?? '')) {
        const n = parseNumber('', pos);
        key = n.bigint ? String(n.exact) : String(n.value);
      } else {
        const name = identifier();
        if (name === null) return fail(`Expected a key or "}" but found ${describe(pos)}`);
        key = name;
        bare = true;
      }
      skipTrivia();
      if (text[pos] !== ':') {
        if (bare && (text[pos] === ',' || text[pos] === '}')) {
          fail(`Shorthand property "${key}" refers to a variable, which is not allowed`, keyPos);
        }
        if (text[pos] === '(') fail('Methods are not allowed', keyPos);
        fail(`Expected ":" after key "${key}" but found ${describe(pos)}`);
      }
      pos++;
      entries.push({ key, value: parseValue(depth + 1) });
      skipTrivia();
      if (text[pos] === ',') {
        pos++;
      } else if (text[pos] !== '}') {
        unexpectedAfterValue('"," or "}"');
      }
    }
    pos++;
    return { kind: 'object', pos: start, entries };
  };

  const parseArray = (depth: number): Node => {
    const start = pos;
    pos++;
    const items: Node[] = [];
    for (;;) {
      skipTrivia();
      if (text[pos] === ']') break;
      if (text[pos] === ',') fail('Empty array elements are not allowed');
      items.push(parseValue(depth + 1));
      skipTrivia();
      if (text[pos] === ',') {
        pos++;
      } else if (text[pos] !== ']') {
        unexpectedAfterValue('"," or "]"');
      }
    }
    pos++;
    return { kind: 'array', pos: start, items };
  };

  const parseValue = (depth: number): Node => {
    if (depth > MAX_DEPTH) fail('Nesting is too deep');
    skipTrivia();
    const start = pos;
    const ch = text[pos];
    if (ch === undefined) return fail('Expected a value but found end of input');
    switch (ch) {
      case '{':
        return parseObject(depth);
      case '[':
        return parseArray(depth);
      case '"':
      case "'":
        return { kind: 'string', pos: start, value: parseString() };
      case '`':
        return fail('Template literals are not allowed; use "…" or \'…\'');
      case '/':
        return parseRegex();
      case '(':
        return fail('Parentheses and functions are not allowed');
      case '-':
      case '+': {
        pos++;
        skipTrivia();
        if (/[\d.]/.test(text[pos] ?? '')) return parseNumber(ch, start);
        IDENT.lastIndex = pos;
        const word = IDENT.exec(text)?.[0];
        if (word === 'Infinity' || word === 'NaN') {
          pos += word.length;
          const value = word === 'NaN' ? NaN : ch === '-' ? -Infinity : Infinity;
          return { kind: 'number', pos: start, value, exact: null, text: '', bigint: false };
        }
        return fail(`Expected a number after "${ch}"`);
      }
    }
    if (/[\d.]/.test(ch)) return parseNumber('', start);
    ID_START.lastIndex = pos;
    if (ID_START.test(text)) return parseWordOrCall(depth);
    return fail(`Unexpected ${describe(pos)}`);
  };

  const value = parseValue(0);
  skipTrivia();
  if (text[pos] === ';') {
    pos++;
    skipTrivia();
  }
  if (pos < text.length) unexpectedAfterValue('');
  return value;
}

/**
 * End index (the closing `/`) of a regex literal body starting at `from`, or -1 if the body is
 * not terminated on its line.
 */
export function scanRegexBody(text: string, from: number): number {
  let inClass = false;
  for (let i = from; i < text.length; i++) {
    const ch = text[i] as string;
    if (LINE_BREAK.test(ch)) return -1;
    if (ch === '\\') {
      i++;
      if (i >= text.length || LINE_BREAK.test(text[i] as string)) return -1;
    } else if (ch === '[') {
      inClass = true;
    } else if (ch === ']') {
      inClass = false;
    } else if (ch === '/' && !inClass) {
      return i;
    }
  }
  return -1;
}
