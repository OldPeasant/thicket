import { TestBed } from '@angular/core/testing';
import type { FavoriteQuery, HistoryEntry, MethodName, SavedQuery } from '@thicket/contract';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../../api/testing';
import { QueryHistory } from './query-history.service';

const ORDERS = { profileId: 'p1', db: 'shop', coll: 'orders' };
const USERS = { profileId: 'p1', db: 'shop', coll: 'users' };

const query = (filter: string): SavedQuery => ({
  filter,
  projection: '',
  sort: '',
  collation: '',
  limit: '',
});
const entry = (filter: string): HistoryEntry => ({
  query: query(filter),
  at: '2026-01-01T00:00:00.000Z',
});
const favorite = (id: string, name: string): FavoriteQuery => ({
  id,
  name,
  query: query(`{ ${name}: 1 }`),
  at: '2026-01-01T00:00:00.000Z',
});

/** A promise resolved (or rejected) by the test. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('QueryHistory', () => {
  let fake: FakeThicketBridge;
  let history: QueryHistory;

  beforeEach(() => {
    fake = new FakeThicketBridge();
    TestBed.configureTestingModule({ providers: [provideFakeThicket(fake), QueryHistory] });
    history = TestBed.inject(QueryHistory);
  });

  /** Answers every request of `method` with the next deferred, in order. */
  const queue = <M extends MethodName>(method: M) => {
    const pending: ReturnType<typeof deferred<unknown>>[] = [];
    fake.handle(method, () => {
      const next = deferred<unknown>();
      pending.push(next);
      return next.promise as never;
    });
    return pending;
  };

  it('does nothing before a collection is loaded', async () => {
    await history.record(query('{ a: 1 }'));
    expect(await history.saveFavorite('F', query('{ a: 1 }'))).toBe(false);
    await history.deleteFavorite('f1');
    await history.clear();
    expect(fake.requests).toEqual([]);
  });

  it('loads the entries and favorites of the collection', async () => {
    fake.respond('history.list', {
      entries: [entry('{ a: 1 }')],
      favorites: [favorite('f1', 'A')],
    });
    await history.load(ORDERS);
    expect(fake.requestsFor('history.list').map((r) => r.params)).toEqual([ORDERS]);
    expect(history.entries()).toEqual([entry('{ a: 1 }')]);
    expect(history.favorites()).toEqual([favorite('f1', 'A')]);
    expect(history.error()).toBeNull();
  });

  it('sends only the five query fields', async () => {
    fake.respond('history.list', { entries: [], favorites: [] });
    fake.handle('history.add', () => ({ entries: [] }));
    await history.load(ORDERS);
    await history.record({ ...query('{ a: 1 }'), extra: 'x' } as SavedQuery);
    expect(fake.requestsFor('history.add')[0]?.params).toEqual({
      ...ORDERS,
      query: query('{ a: 1 }'),
    });
  });

  it('drops a list answer for a collection the tab no longer shows', async () => {
    const lists = queue('history.list');
    const first = history.load(ORDERS);
    const second = history.load(USERS);
    lists[1]?.resolve({ entries: [entry('{ users: 1 }')], favorites: [favorite('f2', 'U')] });
    await second;
    lists[0]?.resolve({ entries: [entry('{ orders: 1 }')], favorites: [favorite('f1', 'O')] });
    await first;
    expect(history.entries()).toEqual([entry('{ users: 1 }')]);
    expect(history.favorites()).toEqual([favorite('f2', 'U')]);
  });

  it('empties the lists at once when switching collection', async () => {
    fake.respond('history.list', {
      entries: [entry('{ a: 1 }')],
      favorites: [favorite('f1', 'A')],
    });
    await history.load(ORDERS);
    const lists = queue('history.list');
    const loading = history.load(USERS);
    expect(history.entries()).toEqual([]);
    expect(history.favorites()).toEqual([]);
    lists[0]?.resolve({ entries: [], favorites: [] });
    await loading;
  });

  it('drops an add, save, delete or clear answer that arrives after switching collection', async () => {
    fake.respond('history.list', { entries: [], favorites: [] });
    await history.load(ORDERS);
    const adds = queue('history.add');
    const saves = queue('history.saveFavorite');
    const deletes = queue('history.deleteFavorite');
    const clears = queue('history.clear');
    const recording = history.record(query('{ orders: 1 }'));
    const saving = history.saveFavorite('O', query('{ orders: 1 }'));
    const deleting = history.deleteFavorite('f9');
    const clearing = history.clear();
    await flush();
    expect(fake.requestsFor('history.add')[0]?.params).toMatchObject(ORDERS);

    fake.respond('history.list', { entries: [entry('{ users: 1 }')], favorites: [] });
    await history.load(USERS);
    adds[0]?.resolve({ entries: [entry('{ orders: 1 }')] });
    saves[0]?.resolve({ favorites: [favorite('f1', 'O')] });
    deletes[0]?.resolve({ favorites: [favorite('f3', 'Other')] });
    clears[0]?.resolve({ entries: [] });
    await recording;
    expect(await saving).toBe(false);
    await deleting;
    await clearing;
    expect(history.entries()).toEqual([entry('{ users: 1 }')]);
    expect(history.favorites()).toEqual([]);
  });

  it('does not show the error of a request for a collection the tab no longer shows', async () => {
    fake.respond('history.list', { entries: [], favorites: [] });
    await history.load(ORDERS);
    const adds = queue('history.add');
    const recording = history.record(query('{ orders: 1 }'));
    await flush();
    await history.load(USERS);
    adds[0]?.resolve({ error: { code: 'INTERNAL', message: 'disk full' } });
    await recording;
    expect(history.error()).toBeNull();
  });

  it('shows the latest history when the list answers after a query was recorded', async () => {
    // Main answers `history.add` before an earlier `history.list` that read the history first
    // (the store serializes list's two reads around the add), so the list answer is older.
    const lists = queue('history.list');
    fake.handle('history.add', () => ({ entries: [entry('{ ran: 1 }')] }));
    const loading = history.load(ORDERS);
    await history.record(query('{ ran: 1 }'));
    lists[0]?.resolve({ entries: [], favorites: [] });
    await loading;
    expect(history.entries()).toEqual([entry('{ ran: 1 }')]);
  });

  it('shows a failed request and clears the error on the next success', async () => {
    fake.fail('history.list', { code: 'INTERNAL', message: 'could not read history' });
    await history.load(ORDERS);
    expect(history.error()).toContain('could not read history');
    expect(history.entries()).toEqual([]);

    fake.fail('history.clear', { code: 'INTERNAL', message: 'busy' });
    await history.clear();
    expect(history.error()).toContain('busy');

    fake.handle('history.add', () => ({ entries: [entry('{ a: 1 }')] }));
    await history.record(query('{ a: 1 }'));
    expect(history.error()).toBeNull();
    expect(history.entries()).toEqual([entry('{ a: 1 }')]);
  });

  it('resolves saveFavorite true on success and false on failure', async () => {
    fake.respond('history.list', { entries: [], favorites: [] });
    await history.load(ORDERS);
    fake.handle('history.saveFavorite', () => ({ favorites: [favorite('f1', 'A')] }));
    expect(await history.saveFavorite('A', query('{ A: 1 }'))).toBe(true);
    expect(history.favorites()).toEqual([favorite('f1', 'A')]);

    fake.fail('history.saveFavorite', {
      code: 'INVALID_PARAMS',
      message: 'name must not be empty',
    });
    expect(await history.saveFavorite('', query('{}'))).toBe(false);
    expect(history.error()).toContain('name must not be empty');
    // A failure keeps what was shown.
    expect(history.favorites()).toEqual([favorite('f1', 'A')]);
  });

  it('a reload of the same collection clears an earlier error', async () => {
    fake.fail('history.list', { code: 'INTERNAL', message: 'denied' });
    await history.load(ORDERS);
    expect(history.error()).not.toBeNull();
    const lists = queue('history.list');
    const loading = history.load(ORDERS);
    expect(history.error()).toBeNull();
    lists[0]?.resolve({ entries: [entry('{ a: 1 }')], favorites: [] });
    await loading;
    expect(history.entries()).toEqual([entry('{ a: 1 }')]);
  });
});
