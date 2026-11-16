import { describe, expect, it } from 'vitest';

import { EMPTY_QUERY, parseLimit, parseQuery } from './query.util';

describe('parseQuery', () => {
  it('turns an empty query bar into an empty filter', () => {
    expect(parseQuery(EMPTY_QUERY)).toEqual({
      ok: true,
      query: { filter: '{}', sortSpec: [], emptyFilter: true },
    });
  });

  it('drops empty projection, sort and collation documents', () => {
    const parsed = parseQuery({ ...EMPTY_QUERY, projection: '{}', sort: ' {} ', collation: '{}' });
    expect(parsed).toEqual({ ok: true, query: { filter: '{}', sortSpec: [], emptyFilter: true } });
  });

  it('reads the paging sort, also from NumberLong and string directions', () => {
    const parsed = parseQuery({ ...EMPTY_QUERY, sort: '{ a: NumberLong(-1), b: "asc" }' });
    expect(parsed.ok && parsed.query.sortSpec).toEqual([
      { field: 'a', direction: -1 },
      { field: 'b', direction: 1 },
    ]);
  });

  it('marks $meta sorts and repeated keys as opaque', () => {
    const meta = parseQuery({ ...EMPTY_QUERY, sort: '{ s: { $meta: "textScore" } }' });
    expect(meta.ok && meta.query.sortSpec).toBeNull();
    const repeated = parseQuery({ ...EMPTY_QUERY, sort: '{ a: 1, a: -1 }' });
    expect(repeated.ok && repeated.query.sortSpec).toBeNull();
  });

  it('refuses a top level that is not a document', () => {
    const parsed = parseQuery({ ...EMPTY_QUERY, filter: '[1, 2]' });
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.errors.filter).toContain('Expected a document');
  });
});

describe('parseLimit', () => {
  it('reads whole numbers; empty and 0 mean no limit', () => {
    expect(parseLimit('')).toBeUndefined();
    expect(parseLimit(' 0 ')).toBeUndefined();
    expect(parseLimit('25')).toBe(25);
  });

  it('refuses anything else', () => {
    for (const bad of ['-1', '1.5', 'ten', '1e3']) expect(() => parseLimit(bad)).toThrow();
    expect(() => parseLimit('99999999999999999999')).toThrow('too large');
  });
});
