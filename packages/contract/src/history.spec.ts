import { describe, expect, it } from 'vitest';

import {
  HISTORY_LIMIT,
  MAX_FAVORITE_NAME_LENGTH,
  MAX_QUERY_FIELD_LENGTH,
  parseParams,
  parseResult,
  route,
} from './index';

const TARGET = { profileId: 'p1', db: 'shop', coll: 'orders' };
const QUERY = { filter: '{ a: 1 }', projection: '', sort: '', collation: '', limit: '' };

describe('history.* params', () => {
  it('keeps 50 entries per collection', () => {
    expect(HISTORY_LIMIT).toBe(50);
  });

  it('are served by main', () => {
    for (const method of [
      'history.list',
      'history.add',
      'history.clear',
      'history.saveFavorite',
      'history.deleteFavorite',
    ]) {
      expect([method, route(method)]).toEqual([method, 'main']);
    }
  });

  it('accept the query bar text as typed, including invalid shell syntax', () => {
    const typed = { ...QUERY, filter: '{ a: ', limit: 'ten' };
    expect(parseParams('history.add', { ...TARGET, query: typed })).toEqual({
      ok: true,
      data: { ...TARGET, query: typed },
    });
  });

  it('refuse a query with an unknown or missing field', () => {
    expect(
      parseParams('history.add', { ...TARGET, query: { ...QUERY, hint: '{ a: 1 }' } }).ok,
    ).toBe(false);
    const withoutLimit: Partial<typeof QUERY> = { ...QUERY };
    delete withoutLimit.limit;
    expect(parseParams('history.add', { ...TARGET, query: withoutLimit }).ok).toBe(false);
    expect(parseParams('history.add', { ...TARGET, query: { ...QUERY, limit: 10 } }).ok).toBe(
      false,
    );
  });

  it('refuse a query field longer than MAX_QUERY_FIELD_LENGTH', () => {
    const at = { ...QUERY, filter: 'x'.repeat(MAX_QUERY_FIELD_LENGTH) };
    const over = { ...QUERY, filter: 'x'.repeat(MAX_QUERY_FIELD_LENGTH + 1) };
    expect(parseParams('history.add', { ...TARGET, query: at }).ok).toBe(true);
    const result = parseParams('history.saveFavorite', { ...TARGET, name: 'n', query: over });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_PARAMS');
      expect(result.error.detail).toEqual([expect.objectContaining({ path: ['query', 'filter'] })]);
    }
  });

  it('trim the favorite name and limit its length', () => {
    expect(
      parseParams('history.saveFavorite', { ...TARGET, name: '  Open orders ', query: QUERY }),
    ).toMatchObject({ ok: true, data: { name: 'Open orders' } });
    const longest = 'n'.repeat(MAX_FAVORITE_NAME_LENGTH);
    expect(
      parseParams('history.saveFavorite', { ...TARGET, name: ` ${longest} `, query: QUERY }).ok,
    ).toBe(true);
    const tooLong = parseParams('history.saveFavorite', {
      ...TARGET,
      name: `${longest}n`,
      query: QUERY,
    });
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.error.message).toContain('at most 200 characters');
    const blank = parseParams('history.saveFavorite', { ...TARGET, name: '\t ', query: QUERY });
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.error.message).toContain('name must not be empty');
  });

  it('require the collection and refuse unknown keys', () => {
    expect(parseParams('history.list', TARGET).ok).toBe(true);
    expect(parseParams('history.list', { ...TARGET, coll: '' }).ok).toBe(false);
    expect(parseParams('history.list', { ...TARGET, extra: 1 }).ok).toBe(false);
    expect(parseParams('history.clear', { profileId: 'p1', db: 'shop' }).ok).toBe(false);
    expect(parseParams('history.deleteFavorite', TARGET).ok).toBe(false);
  });
});

describe('history.* results', () => {
  it('refuse an entry without its time or a favorite without a name', () => {
    expect(parseResult('history.add', { entries: [{ query: QUERY, at: 'x' }] }).ok).toBe(true);
    expect(parseResult('history.add', { entries: [{ query: QUERY }] }).ok).toBe(false);
    expect(
      parseResult('history.saveFavorite', {
        favorites: [{ id: 'f1', name: '', query: QUERY, at: 'x' }],
      }).ok,
    ).toBe(false);
  });
});
