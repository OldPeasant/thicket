import { describe, expect, it } from 'vitest';

import { diffLines, LCS_CELL_LIMIT } from './line-diff';

describe('diffLines', () => {
  it('marks every line the same for equal inputs', () => {
    expect(diffLines(['a', 'b'], ['a', 'b'])).toEqual([
      { kind: 'same', left: 'a', right: 'a' },
      { kind: 'same', left: 'b', right: 'b' },
    ]);
  });

  it('pairs a replaced line as changed and keeps the lines around it aligned', () => {
    expect(diffLines(['{', 'a: 1', 'b: 2', '}'], ['{', 'a: 9', 'b: 2', '}'])).toEqual([
      { kind: 'same', left: '{', right: '{' },
      { kind: 'changed', left: 'a: 1', right: 'a: 9' },
      { kind: 'same', left: 'b: 2', right: 'b: 2' },
      { kind: 'same', left: '}', right: '}' },
    ]);
  });

  it('shows lines only one side has against a gap', () => {
    expect(diffLines(['{', 'a', 'x', 'b', '}'], ['{', 'a', 'b', 'y', '}'])).toEqual([
      { kind: 'same', left: '{', right: '{' },
      { kind: 'same', left: 'a', right: 'a' },
      { kind: 'left', left: 'x', right: null },
      { kind: 'same', left: 'b', right: 'b' },
      { kind: 'right', left: null, right: 'y' },
      { kind: 'same', left: '}', right: '}' },
    ]);
  });

  it('handles empty sides', () => {
    expect(diffLines([], ['a'])).toEqual([{ kind: 'right', left: null, right: 'a' }]);
    expect(diffLines(['a'], [])).toEqual([{ kind: 'left', left: 'a', right: null }]);
    expect(diffLines([], [])).toEqual([]);
  });

  it('falls back to pairing the differing middle for very big inputs', () => {
    const n = Math.ceil(Math.sqrt(LCS_CELL_LIMIT)) + 1;
    const left = ['{', ...Array.from({ length: n }, (_, i) => `l${i}`), '}'];
    const right = ['{', ...Array.from({ length: n }, (_, i) => `r${i}`), '}'];
    const rows = diffLines(left, right);
    expect(rows).toHaveLength(n + 2);
    expect(rows[0]?.kind).toBe('same');
    expect(rows[1]).toEqual({ kind: 'changed', left: 'l0', right: 'r0' });
    expect(rows.at(-1)?.kind).toBe('same');
  });
});
