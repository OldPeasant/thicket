import { describe, expect, it } from 'vitest';

import {
  applyCompletion,
  completionLabel,
  ConsoleHistory,
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
