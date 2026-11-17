import { describe, expect, it } from 'vitest';

import {
  applyCompletion,
  completionLabel,
  ConsoleHistory,
  HISTORY_LIMIT,
  isInputComplete,
  onFirstLine,
  onLastLine,
} from './console-input';

describe('isInputComplete', () => {
  it.each([
    ['db.orders.countDocuments()', true],
    ['use shop', true],
    ['', false],
    ['   ', false],
    ['function f(a) {', false],
    ['function f(a) {\n  return a * 2;\n}', true],
    ['db.c.find({ a: [1, 2', false],
    ["'unterminated", true],
    ['"a ( b"', true],
    ['`open ${x}', false],
    ['`done ${x}`', true],
    ['/* open comment', false],
    ['x = 1 // { not counted', true],
    ['x = "\\"("', true],
    [')', true],
  ])('%j -> %s', (code, expected) => {
    expect(isInputComplete(code)).toBe(expected);
  });
});

describe('ConsoleHistory', () => {
  it('steps through entries and restores the draft', () => {
    const h = new ConsoleHistory();
    h.add('a');
    h.add('b');
    expect(h.previous('draft')).toBe('b');
    expect(h.previous('b')).toBe('a');
    expect(h.previous('a')).toBeNull();
    expect(h.next()).toBe('b');
    expect(h.next()).toBe('draft');
    expect(h.next()).toBeNull();
  });

  it('skips blanks and repeats, and keeps only the newest entries', () => {
    const h = new ConsoleHistory(2);
    h.add('  ');
    h.add('a');
    h.add('a');
    h.add('b');
    h.add('c');
    expect(h.entries).toEqual(['b', 'c']);
  });

  it('has nothing to step through while empty', () => {
    const h = new ConsoleHistory();
    expect(h.previous('typed')).toBeNull();
    expect(h.next()).toBeNull();
  });

  it('running an input stops stepping and forgets the draft', () => {
    const h = new ConsoleHistory();
    h.add('a');
    h.add('b');
    expect(h.previous('draft')).toBe('b');
    expect(h.previous('b')).toBe('a');
    h.add('a');
    // Stepping starts again at the newest entry; the old draft is gone.
    expect(h.entries).toEqual(['a', 'b', 'a']);
    expect(h.next()).toBeNull();
    expect(h.previous('')).toBe('a');
    expect(h.next()).toBe('');
  });

  it('keeps HISTORY_LIMIT entries by default', () => {
    const h = new ConsoleHistory();
    for (let i = 0; i < HISTORY_LIMIT + 3; i++) h.add(`x = ${i}`);
    expect(h.entries).toHaveLength(HISTORY_LIMIT);
    expect(h.entries[0]).toBe('x = 3');
  });
});

describe('isInputComplete edge cases', () => {
  it.each([
    ['`a\\`(`', true],
    ['x = `line1\nline2`', true],
    ["x = 'a'\n{", false],
    ["x = 'open\nf(", false],
    ['x = 1 /* { */', true],
    ['f(\n  // )\n', false],
    ['[1, 2]]', true],
    // Regex literals (CR-2): brackets and slashes inside them do not count.
    ['db.c.find({ name: /^\\(/ })', true],
    ['db.c.find({ p: /\\// })', true],
    ['db.c.find({ p: /[/(]/i })', true],
    ['db.c.find({ p: /a(/ ', false],
    ['x = a / b / (c', false],
    ['x = (a) / 2 / (3)', true],
    ['/{/.test(s)', true],
  ])('%j -> %s', (code, expected) => {
    expect(isInputComplete(code)).toBe(expected);
  });
});

describe('completion helpers', () => {
  it('replaces the input up to the cursor and keeps the rest', () => {
    expect(applyCompletion('db.orders.fin()', 13, 'db.orders.find')).toEqual({
      code: 'db.orders.find()',
      cursor: 14,
    });
  });

  it('labels a completion by its last word', () => {
    expect(completionLabel('db.orders.findOne')).toBe('findOne');
    expect(completionLabel('use $x')).toBe('$x');
    expect(completionLabel('show ')).toBe('show');
  });

  it('knows whether the caret is on the first or last line', () => {
    expect(onFirstLine('a\nb', 1)).toBe(true);
    expect(onFirstLine('a\nb', 2)).toBe(false);
    expect(onLastLine('a\nb', 1)).toBe(false);
    expect(onLastLine('a\nb', 2)).toBe(true);
  });
});
