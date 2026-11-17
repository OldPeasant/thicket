import { describe, expect, it } from 'vitest';

import { EXIT_TEXT, isExitCommand, splitShellInput } from './split';

/** U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR (line terminators in JavaScript). */
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

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

  it.each([
    // CR-5: commands without arguments with a glued comment.
    ['quit/* now */', ['quit']],
    ['exit//bye\n1', ['exit', '\n1']],
    ['it/**/\nx', ['it', '\nx']],
    // `show profile` (one argument) and a glued comment.
    ['show profile//x\ny', ['show profile', '\ny']],
    // Two glued block comments in a row.
    ['show dbs/*a*//*b*/\nx', ['show dbs', '\nx']],
    // A `/` inside the argument and a glued comment after it.
    ['use a/b// c\nx', ['use a/b', '\nx']],
    ['show a/b/c', ['show a/b/c']],
    ['use a*/b', ['use a*/b']],
    // A trailing `/` stays in the argument; the `;` still ends the command.
    ['use a/;x', ['use a/', 'x']],
    // The comment starts at the first `//`: `a/// c` is `a` and the comment `/// c`.
    ['use a/// c\nx', ['use a', '\nx']],
    // A glued comment, then `;` after the comment's end.
    ['show profile 5/*a*/;x', ['show profile 5', 'x']],
    // After JavaScript at a statement start.
    ['x = 1; use t//c\ny', ['x = 1;', 'use t', '\ny']],
    // A comment after the `;` belongs to the next (JavaScript) piece, as with a space before it.
    ['use t;//c\nx', ['use t', '//c\nx']],
  ])('CR-5 glued comments end the argument: %j', (input, pieces) => {
    expect(splitShellInput(input)).toEqual(pieces);
  });

  it.each([
    // Code after a glued block comment on the line is not a command form.
    'use a/*b*/c',
    // A glued block comment that does not end on the line.
    'use a/*',
    'use a/*/b',
    // `//` inside a quoted argument: the argument is not an identifier, so not a command.
    'use "a//b"',
    // A command-like text inside a string or after a JavaScript line comment.
    'print("use t// c")',
    'db.c.find() // use t//x',
    // An argument starting with `/` is not an identifier.
    'use /x',
  ])('CR-5 not a command: %j', (input) => {
    expect(splitShellInput(input)).toEqual([input]);
  });

  it.each([
    ['many glued slashes', `use ${'a/'.repeat(20000)} x =`],
    ['many arguments then a bracket', `use ${'ab '.repeat(20000)}(`],
    ['only slashes', `show ${'/'.repeat(40000)}`],
    // TW-2: a run of block comments followed by code. Before 8712197 the lazy `.*?` of the
    // block-comment branch could also span several comments, so a failing match tried every
    // grouping (2^n, 3 to 6 s at 28). Kept at 28 comments so a regression ends in seconds.
    ['28 block comments then code', `use a${' /**/'.repeat(28)} x`],
    ['28 glued block comments then code', `use a${'/**/'.repeat(28)} x`],
  ])(
    'a long non-command line is rejected quickly (no catastrophic backtracking): %s',
    (_, input) => {
      const started = performance.now();
      expect(splitShellInput(input)).toEqual([input]);
      // Generous bound: linear matching takes milliseconds.
      expect(performance.now() - started).toBeLessThan(1000);
    },
  );

  // TW-2 fix (8712197): a block comment ends at its first `*/`, as in JavaScript and in
  // `skipBlockComment`; a line comment runs as far as `.` matches.
  it.each([
    // The comment is `/* x */`; `b */` after it is code, so the line is not a command form and
    // goes to mongosh whole (before the fix `/* x */ b */` was taken as one comment).
    ['use a /* x */ b */', ['use a /* x */ b */']],
    ['use a /* x */ /* y */ */', ['use a /* x */ /* y */ */']],
    ['use a /* x */ */\nq', ['use a /* x */ */\nq']],
    // Stars inside or before the end of a block comment.
    ['show dbs /***/;x', ['show dbs', 'x']],
    ['use a /* **/\nq', ['use a', '\nq']],
    ['use a /* * / */\nq', ['use a', '\nq']],
    ['use a /* x */ /** y **/ // z\r\nq', ['use a', '\nq']],
    // A line comment ends at a CR: a CR at the end of the input or before a line break is
    // trailing whitespace, a CR followed by code is not a command form.
    ['use a // c\r', ['use a']],
    ['use a // c\r// d\nq', ['use a', '\nq']],
    ['use a // c\rx', ['use a // c\rx']],
    // U+2028 / U+2029 end a line comment like a CR: at the end of the input they are trailing
    // whitespace; followed by code the line is not a command form (unchanged by the fix).
    [`use a // c${LS}`, ['use a']],
    [`use a // c${LS}x`, [`use a // c${LS}x`]],
    [`use a // c${PS}x`, [`use a // c${PS}x`]],
  ])(
    'a block comment ends at its first */, a line comment at the line end: %j',
    (input, pieces) => {
      expect(splitShellInput(input)).toEqual(pieces);
    },
  );

  it.each([
    // TW-2, line-comment part: before 8712197 `\/\/.*` could stop at any `//` or space and let
    // the next comment start there, so a line ended by a CR or U+2028 and then code tried every
    // grouping (18 ` //`: about 5 s) or every comment length (40000 spaces: about 3 s,
    // quadratic). These sizes keep a regression bounded to seconds; the fixed match takes < 2 ms.
    ['18 line comments then U+2028 and code', `use a${' //'.repeat(18)}${LS}x`],
    ['18 line comments then CR and code', `use a${' //'.repeat(18)}\rx`],
    ['a line comment of 40000 spaces then U+2028 and code', `use a //${' '.repeat(40000)}${LS}x`],
    ['a line comment of 40000 spaces then CR and code', `use a //${' '.repeat(40000)}\rx`],
    // Block-comment part with many comments, stars and unterminated openers.
    ['5000 block comments then code', `use a${' /**/'.repeat(5000)} x`],
    ['3000 starred block comments then code', `use a${' /***/ /* * */'.repeat(3000)} x`],
    ['5000 block comments with an inner /* then code', `use a${' /* /* */'.repeat(5000)} x`],
    ['10000 unterminated block comment openers', `use a${' /* /*'.repeat(10000)}`],
    ['an unterminated block comment of 40000 stars', `use a /*${'*'.repeat(40000)}`],
    ['20000 stray */ after a comment', `use a /**/${' */'.repeat(20000)}`],
    [
      '5000 block comments, a long line comment, U+2028 and code',
      `use a${' /**/'.repeat(5000)} //${' '.repeat(5000)}${LS}x`,
    ],
  ])('TW-2 fix: a failing command match stays linear: %s', (_, input) => {
    const started = performance.now();
    expect(splitShellInput(input)).toEqual([input]);
    // Generous bound: the fixed pattern takes about 1 ms for each of these inputs.
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('a command line with many trailing comments still splits (linear success path)', () => {
    const input = `use a${' /**/'.repeat(5000)}${' //'.repeat(1000)}\nq`;
    const started = performance.now();
    expect(splitShellInput(input)).toEqual(['use a', '\nq']);
    expect(performance.now() - started).toBeLessThan(1000);
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
