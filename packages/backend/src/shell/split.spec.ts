import { describe, expect, it } from 'vitest';

import { splitShellInput } from './split';

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

  it('drops empty input', () => {
    expect(splitShellInput('')).toEqual([]);
    expect(splitShellInput(' ;\n ; ')).toEqual([]);
  });
});
