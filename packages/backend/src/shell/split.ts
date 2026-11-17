/**
 * Splits console input into the pieces mongosh's evaluator takes one at a time. mongosh's REPL
 * gets input line by line, and its evaluator treats a whole input that starts with a shell
 * command (`use x`, `show dbs`, `it`, `exit`) as that command: `use test; db.c.find()` would
 * switch to the database `test;` and ignore the rest. So every shell command statement becomes a
 * piece of its own; the JavaScript between them stays together (multi-line functions, several
 * statements), so variables and functions behave as in one program.
 *
 * A shell command is recognised at a statement start (start of input, after `;` or a line break)
 * outside strings, comments, template literals, regex literals and brackets.
 */
export function splitShellInput(code: string): string[] {
  const pieces: string[] = [];
  let start = 0;
  let depth = 0;
  let i = 0;
  /** Last significant (non-space, non-comment) character, for the regex-literal heuristic. */
  let last = '';
  let atStatementStart = true;

  const pushJs = (end: number) => {
    const text = code.slice(start, end);
    if (text.trim() !== '' && !/^[\s;]*$/.test(text)) pieces.push(text);
  };

  while (i < code.length) {
    if (atStatementStart && depth === 0) {
      const command = commandAt(code, i);
      if (command) {
        pushJs(i);
        pieces.push(command.text);
        i = command.end;
        start = i;
        last = ';';
        continue;
      }
    }
    const ch = code[i] as string;
    const next = code[i + 1];
    if (ch === '\n') {
      if (depth === 0) atStatementStart = true;
      i++;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      i = skipLineComment(code, i);
      continue;
    }
    if (ch === '/' && next === '*') {
      i = skipBlockComment(code, i);
      continue;
    }
    atStatementStart = false;
    if (ch === '"' || ch === "'") {
      i = skipString(code, i, ch);
      last = ch;
      continue;
    }
    if (ch === '`') {
      i = skipTemplate(code, i);
      last = ch;
      continue;
    }
    if (ch === '/' && regexMayStart(last)) {
      i = skipRegex(code, i);
      last = '/';
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) atStatementStart = true;
    last = ch;
    i++;
  }
  pushJs(code.length);
  return pieces;
}

const COMMAND = /^(use|show|it|exit|quit)(?=$|[\s;])([^\S\n]+[^\s;]+)*[^\S\n]*(?:;|(?=\n)|$)/;

/** The shell command statement at `index`, if one starts there. */
function commandAt(code: string, index: number): { text: string; end: number } | undefined {
  let at = index;
  while (at < code.length && (code[at] === ' ' || code[at] === '\t' || code[at] === '\r')) at++;
  const match = COMMAND.exec(code.slice(at, lineEnd(code, at)));
  if (!match) return undefined;
  const word = match[1] as string;
  const text = match[0].replace(/;$/, '').trim();
  const args = text.slice(word.length).trim().split(/\s+/).filter(Boolean);
  // `it`, `exit` and `quit` take no argument; `use` exactly one; `show` one or two.
  if ((word === 'it' || word === 'exit' || word === 'quit') && args.length > 0) return undefined;
  if (word === 'use' && args.length !== 1) return undefined;
  if (word === 'show' && (args.length < 1 || args.length > 2)) return undefined;
  // An identifier argument; JS such as `use = 1` or `show + x` is not a command.
  if (!args.every((arg) => /^[^=+\-*/%&|^!<>?:,()[\]{}'"`.]/.test(arg))) return undefined;
  return { text, end: at + match[0].length };
}

function lineEnd(code: string, index: number): number {
  const end = code.indexOf('\n', index);
  return end < 0 ? code.length : end;
}

function skipLineComment(code: string, index: number): number {
  return lineEnd(code, index);
}

function skipBlockComment(code: string, index: number): number {
  const end = code.indexOf('*/', index + 2);
  return end < 0 ? code.length : end + 2;
}

function skipString(code: string, index: number, quote: string): number {
  let i = index + 1;
  while (i < code.length) {
    const ch = code[i];
    if (ch === '\\') i += 2;
    else if (ch === quote || ch === '\n') return i + 1;
    else i++;
  }
  return i;
}

function skipTemplate(code: string, index: number): number {
  let i = index + 1;
  while (i < code.length) {
    const ch = code[i];
    if (ch === '\\') {
      i += 2;
    } else if (ch === '`') {
      return i + 1;
    } else if (ch === '$' && code[i + 1] === '{') {
      // Skip the substitution, counting braces (nested strings in it are rare in a console).
      let depth = 1;
      i += 2;
      while (i < code.length && depth > 0) {
        if (code[i] === '{') depth++;
        else if (code[i] === '}') depth--;
        i++;
      }
    } else {
      i++;
    }
  }
  return i;
}

/** A `/` after one of these (or at the start) begins a regex literal, otherwise a division. */
function regexMayStart(last: string): boolean {
  return last === '' || '(,=:[!&|?{};+-*%<>~^'.includes(last);
}

function skipRegex(code: string, index: number): number {
  let i = index + 1;
  let inClass = false;
  while (i < code.length) {
    const ch = code[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '\n') return i;
    if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) {
      i++;
      while (i < code.length && /[a-z]/i.test(code[i] as string)) i++;
      return i;
    }
    i++;
  }
  return i;
}
