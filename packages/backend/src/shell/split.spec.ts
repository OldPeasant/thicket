import { describe, expect, it } from 'vitest';

import { EXIT_TEXT, isExitCommand, splitShellInput } from './split';

describe('splitShellInput', () => {
  it.each([
    [
      'use test; db.c.insertOne({a:1}); db.c.find()',
      ['use test', ' db.c.insertOne({a:1}); db.c.find()'],
    ],
    ['use test\ndb.c.find()', ['use test', '\ndb.c.find()']],
    ['db.c.find()\nit', ['db.c.find()\n', 'it']],
    ['show dbs', ['show dbs']],
    ['  show collections ;  ', ['show collections']],
    ['x = 1; use other; x', ['x = 1;', 'use other', ' x']],
  ])('splits shell commands out of %j', (input, pieces) => {
    expect(splitShellInput(input)).toEqual(pieces);
  });

  it.each([
    'function f(a) {\n  return a * 2;\n}\nf(21)',
    'const use = 1; use + 1',
    'var show = 2;\nshow = 3',
    'db.c.find({ a: "use test" })',
    'db.c.find({ a: /;use test/ })',
    '// use test\n1',
    '/* show dbs; */ 1',
    '`\nuse x\n`',
    'if (true) {\nuse\n}',
    'print("a;\\" use x")',
  ])('keeps JavaScript together: %j', (input) => {
    expect(splitShellInput(input)).toEqual([input]);
  });

  it.each([
    ['use test;use other', ['use test', 'use other']],
    ['show dbs\nshow collections', ['show dbs', 'show collections']],
    ['it;it', ['it', 'it']],
    ['quit;', ['quit']],
    ['exit', ['exit']],
    ['show profile 5', ['show profile 5']],
    ['use\ttest', ['use\ttest']],
    ['use test\r\ndb.c.find()', ['use test', '\ndb.c.find()']],
    ['x = a / 2; use t', ['x = a / 2;', 'use t']],
    ['x = `${ {a:1} }`; use t', ['x = `${ {a:1} }`;', 'use t']],
    ['f(\n)\nuse t\ng()', ['f(\n)\n', 'use t', '\ng()']],
    ['use test; // switch first', ['use test', ' // switch first']],
  ])('more statement starts: %j', (input, pieces) => {
    expect(splitShellInput(input)).toEqual(pieces);
  });

  it.each([
    // Regex literals: a `;` or `/` inside a class, escapes and flags do not end them.
    ['db.c.find({ a: /[;/]x\\/y/gi }); use t', ['db.c.find({ a: /[;/]x\\/y/gi });', 'use t']],
    // Template literals with an escaped backtick.
    ['x = `a\\`;use b`; use t', ['x = `a\\`;use b`;', 'use t']],
    // Strings with escaped quotes.
    ["x = 'it\\'s; use b'; use t", ["x = 'it\\'s; use b';", 'use t']],
    // Division after a closing bracket is not a regex.
    ['x = (4) / 2; use t', ['x = (4) / 2;', 'use t']],
  ])('skips literals before a later command: %j', (input, pieces) => {
    expect(splitShellInput(input)).toEqual(pieces);
  });

  it.each([
    // Unterminated literals and comments swallow the rest: no command is found in them.
    '/* open comment; use t',
    'x = /abc; use t',
    'x = `open; use t',
    // A string still open at the end of the input.
    'print("open string; use t',
  ])('unterminated literals keep the rest as JavaScript: %j', (input) => {
    expect(splitShellInput(input)).toEqual([input]);
  });

  it('a regex literal ends at a line break: a command on the next line is still found', () => {
    expect(splitShellInput('x = /abc\nuse t')).toEqual(['x = /abc\n', 'use t']);
  });

  it.each([
    // Not the command forms mongosh knows: left to the evaluator as JavaScript.
    'use',
    'use a b',
    'it 5',
    'show a b c',
    'use =x',
    'show(dbs)',
    'useful = 1',
    'iterate()',
    'x = { use: 1 }',
    'db.c.find()\n  .limit(1)',
  ])('not a shell command: %j', (input) => {
    expect(splitShellInput(input)).toEqual([input]);
  });

  it('a command line with a trailing comment still ends the command (the next lines run)', () => {
    // As one piece, mongosh's evaluator splits the whole input at whitespace and runs
    // `use("test", "//", "switch", "first", "db.c.find()")`: the find is silently dropped.
    expect(splitShellInput('use test // switch first\ndb.c.find()')).toEqual([
      'use test',
      '\ndb.c.find()',
    ]);
  });

  it.each([
    ['show dbs // list them\n1', ['show dbs', '\n1']],
    ['it // more\nx', ['it', '\nx']],
    ['it//more\nx', ['it', '\nx']],
    ['exit // bye', ['exit']],
    ['use test /* first */\ndb.c.find()', ['use test', '\ndb.c.find()']],
    ['use test /* a */ /* b */; x', ['use test', ' x']],
    ['show profile 5 // last 5', ['show profile 5']],
    ['quit /* now */', ['quit']],
  ])('trailing comments end a command and are dropped: %j', (input, pieces) => {
    expect(splitShellInput(input)).toEqual(pieces);
  });

  it.each([
    // Code after a block comment on the line is not a command form.
    'use test /* c */ db.x',
    // A block comment that does not end on the line.
    'use test /* open\n*/',
  ])('not a command with trailing code or an open comment: %j', (input) => {
    expect(splitShellInput(input)).toEqual([input]);
  });

  it.each([
    // CRLF line endings: the comment ends at the \r, which is consumed with the command like
    // trailing whitespace (as for `use test\r\n` without a comment); the next line still runs.
    ['use test // first\r\ndb.c.find()', ['use test', '\ndb.c.find()']],
    // An empty block comment, and one whose opening `/*/` does not close it.
    ['use test /**/\nx', ['use test', '\nx']],
    ['use test /*/ x */\ny', ['use test', '\ny']],
    // A `;` inside a trailing comment does not end the command early.
    ['use test /* a; b */\nx', ['use test', '\nx']],
    // Everything after `//` is a comment, `;` included: nothing else runs on that line.
    ['use test // a; db.c.drop()', ['use test']],
    // A block then a line comment.
    ['show dbs /* a */ // b\nx', ['show dbs', '\nx']],
    // A comment before the command at a statement start stays a JavaScript piece of its own
    // (mongosh evaluates it to nothing, like the `use test; // c` case above), the command is
    // still recognised.
    ['/* first */ use test // then\nx', ['/* first */', 'use test', '\nx']],
    ['// note\nuse test\nx', ['// note\n', 'use test', '\nx']],
    // A comment glued to an argument (no space) is still a comment, not part of the argument.
    ['use test// c\ndb.c.find()', ['use test', '\ndb.c.find()']],
    ['show dbs//x', ['show dbs']],
    ['show dbs/* x */', ['show dbs']],
    ['use test/* c */\nx', ['use test', '\nx']],
    ['show profile 5//last\nx', ['show profile 5', '\nx']],
    // A single `/` inside an argument is still part of it.
    ['use a/b\nx', ['use a/b', '\nx']],
  ])('trailing comment edge cases: %j', (input, pieces) => {
    expect(splitShellInput(input)).toEqual(pieces);
  });

  it('a command with a trailing comment between JavaScript lines splits into three pieces', () => {
    expect(splitShellInput('var a = 1\nuse test // switch\na + 1')).toEqual([
      'var a = 1\n',
      'use test',
      '\na + 1',
    ]);
  });

  it('drops empty input', () => {
    expect(splitShellInput('')).toEqual([]);
    expect(splitShellInput(' ;\n ; ')).toEqual([]);
  });
});

describe('isExitCommand', () => {
  it('recognises the exit and quit pieces of splitShellInput', () => {
    const pieces = splitShellInput('exit // bye\n1 + 1\nquit;');
    expect(pieces.map(isExitCommand)).toEqual([true, false, true]);
  });

  it.each(['exit()', 'quit(1)', 'exitCode', 'x = exit', 'exit 1', ''])(
    'not the command: %j',
    (piece) => {
      expect(isExitCommand(piece)).toBe(false);
    },
  );

  it('tells the user to close the tab instead', () => {
    expect(EXIT_TEXT).toContain('close the shell tab');
  });
});
