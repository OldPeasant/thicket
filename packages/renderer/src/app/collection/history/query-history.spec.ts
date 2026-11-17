import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { FavoriteQuery, HistoryEntry, SavedQuery } from '@thicket/contract';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../../api/testing';
import type { WorkspaceTab } from '../../layout/workspace.service';
import { CollectionView } from '../collection-view';
import { describeQuery } from './query-history-menu';

const TAB: WorkspaceTab = {
  id: 'p1/shop.orders',
  kind: 'collection',
  title: 'orders',
  data: { profileId: 'p1', db: 'shop', coll: 'orders', type: 'collection' },
};

type Params = Record<string, unknown>;

/**
 * The collection view with main's `history.*` faked in memory (one collection; the store's own
 * rules — limit, dedupe, per collection — are covered by apps/desktop/src/history/store.spec.ts).
 */
describe('CollectionView query history and favorites', () => {
  let fake: FakeThicketBridge;
  let fixture: ComponentFixture<CollectionView>;
  let entries: HistoryEntry[];
  let favorites: FavoriteQuery[];
  let streams: number;

  const el = () => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(id: string) =>
    el().querySelector<T>(`[data-testid="${id}"]`);
  const all = (id: string) => [...el().querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
  const get = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const found = q<T>(id);
    if (found === null) throw new Error(`no element ${id}`);
    return found;
  };
  const settle = async () => {
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
  };
  const type = (id: string, value: string) => {
    const input = get<HTMLInputElement>(id);
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  const click = (id: string) => get<HTMLButtonElement>(id).click();
  const finds = () => fake.requestsFor('docs.find').map((r) => r.params as Params);
  const value = (id: string) => get<HTMLInputElement>(id).value;

  beforeEach(async () => {
    fake = new FakeThicketBridge();
    entries = [];
    favorites = [];
    streams = 0;
    fake.handle('docs.find', () => {
      const id = `s${++streams}`;
      setTimeout(() => {
        fake.data('docs.find', id, { docs: ['{"_id":{"$numberInt":"1"}}'] });
        fake.end(id, { delivered: 1 });
      });
      return { streamId: id };
    });
    fake.respond('docs.estimatedCount', { count: 1 });
    fake.handle('history.list', () => ({ entries, favorites }));
    fake.handle('history.add', (params) => {
      const query = (params as Params)['query'] as SavedQuery;
      entries = [
        { query, at: '2026-01-01T00:00:00.000Z' },
        ...entries.filter((e) => JSON.stringify(e.query) !== JSON.stringify(query)),
      ];
      return { entries };
    });
    fake.handle('history.clear', () => {
      entries = [];
      return { entries };
    });
    fake.handle('history.saveFavorite', (params) => {
      const { name, query } = params as { name: string; query: SavedQuery };
      favorites = [
        ...favorites.filter((f) => f.name !== name),
        { id: `f${favorites.length + 1}`, name, query, at: '2026-01-01T00:00:00.000Z' },
      ];
      return { favorites };
    });
    fake.handle('history.deleteFavorite', (params) => {
      favorites = favorites.filter((f) => f.id !== (params as Params)['id']);
      return { favorites };
    });
    TestBed.configureTestingModule({
      imports: [CollectionView],
      providers: [provideZonelessChangeDetection(), provideFakeThicket(fake)],
    });
    fixture = TestBed.createComponent(CollectionView);
    fixture.componentRef.setInput('tab', TAB);
    await settle();
  });

  it('loads the collection history on open without recording the opening query', () => {
    expect(fake.requestsFor('history.list').map((r) => r.params)).toEqual([
      { profileId: 'p1', db: 'shop', coll: 'orders' },
    ]);
    expect(fake.requestsFor('history.add')).toHaveLength(0);
    // The panel is closed until the History button is pressed.
    expect(q('history-panel')).toBeNull();
    expect(get('history-toggle').getAttribute('aria-expanded')).toBe('false');
  });

  it('shows a run query in the history; picking it fills the query bar and runs it', async () => {
    type('query-filter', '{ status: "open" }');
    type('query-sort', '{ total: -1 }');
    type('query-limit', '10');
    click('query-run');
    await settle();
    expect(fake.requestsFor('history.add').at(-1)?.params).toEqual({
      profileId: 'p1',
      db: 'shop',
      coll: 'orders',
      query: {
        filter: '{ status: "open" }',
        projection: '',
        sort: '{ total: -1 }',
        collation: '',
        limit: '10',
      },
    });

    click('history-toggle');
    await settle();
    expect(get('history-toggle').getAttribute('aria-expanded')).toBe('true');
    const shown = all('history-entry');
    expect(shown).toHaveLength(1);
    expect(shown[0]?.textContent).toContain(
      'find({ status: "open" }).sort({ total: -1 }).limit(10)',
    );

    // Change the bar, then re-run the recorded query from the history.
    click('query-reset');
    await settle();
    expect(value('query-filter')).toBe('');
    const before = finds().length;
    all('history-entry')[0]?.click();
    await settle();
    expect(value('query-filter')).toBe('{ status: "open" }');
    expect(value('query-sort')).toBe('{ total: -1 }');
    expect(value('query-limit')).toBe('10');
    expect(finds()).toHaveLength(before + 1);
    expect(finds().at(-1)).toMatchObject({ filter: '{"status":"open"}', sort: '{"total":-1}' });
    // Picking closes the panel.
    expect(q('history-panel')).toBeNull();
  });

  it('does not record a query that fails to parse', async () => {
    type('query-filter', '{ a: ');
    click('query-run');
    await settle();
    expect(fake.requestsFor('history.add')).toHaveLength(0);
  });

  it('saves the query bar as a favorite and re-runs it from the favorites', async () => {
    type('query-filter', '{ total: { $gt: 100 } }');
    type('query-projection', '{ total: 1 }');
    click('history-toggle');
    await settle();
    expect(q('history-favorites-empty')).not.toBeNull();
    expect(get<HTMLButtonElement>('history-favorite-save').disabled).toBe(true);

    type('history-favorite-name', '  Big orders ');
    await settle();
    click('history-favorite-save');
    await settle();
    expect(fake.requestsFor('history.saveFavorite').at(-1)?.params).toEqual({
      profileId: 'p1',
      db: 'shop',
      coll: 'orders',
      name: 'Big orders',
      query: {
        filter: '{ total: { $gt: 100 } }',
        projection: '{ total: 1 }',
        sort: '',
        collation: '',
        limit: '',
      },
    });
    // Saving neither runs nor records the query.
    expect(finds()).toHaveLength(1);
    expect(fake.requestsFor('history.add')).toHaveLength(0);
    expect(value('history-favorite-name')).toBe('');
    const favorite = all('history-favorite');
    expect(favorite).toHaveLength(1);
    expect(favorite[0]?.textContent).toContain('Big orders');
    expect(favorite[0]?.textContent).toContain('find({ total: { $gt: 100 } }, { total: 1 })');

    click('query-reset');
    await settle();
    all('history-favorite')[0]?.click();
    await settle();
    expect(value('query-filter')).toBe('{ total: { $gt: 100 } }');
    expect(value('query-projection')).toBe('{ total: 1 }');
    expect(finds().at(-1)).toMatchObject({
      filter: '{"total":{"$gt":{"$numberInt":"100"}}}',
      projection: '{"total":{"$numberInt":"1"}}',
    });
    // Running a favorite puts it in the history too.
    expect(fake.requestsFor('history.add')).toHaveLength(1);
  });

  it('Enter in the name field saves the favorite instead of running the query', async () => {
    click('history-toggle');
    await settle();
    type('history-favorite-name', 'All');
    get('history-favorite-name').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await settle();
    expect(fake.requestsFor('history.saveFavorite')).toHaveLength(1);
    expect(finds()).toHaveLength(1);
  });

  it('offers to replace a favorite of the same name, deletes favorites and clears history', async () => {
    favorites = [
      {
        id: 'f1',
        name: 'Open',
        query: { filter: '{}', projection: '', sort: '', collation: '', limit: '' },
        at: '',
      },
    ];
    entries = [
      { query: { filter: '{ a: 1 }', projection: '', sort: '', collation: '', limit: '' }, at: '' },
    ];
    // Reopening the tab on another collection and back reads the history again.
    fixture.componentRef.setInput('tab', { ...TAB, data: { ...TAB.data, coll: 'users' } });
    await settle();
    fixture.componentRef.setInput('tab', TAB);
    await settle();
    click('history-toggle');
    await settle();
    type('history-favorite-name', 'open');
    await settle();
    expect(get('history-favorite-save').textContent).toContain('Replace favorite');

    click('history-favorite-delete');
    await settle();
    expect(fake.requestsFor('history.deleteFavorite').at(-1)?.params).toMatchObject({ id: 'f1' });
    expect(all('history-favorite')).toHaveLength(0);

    expect(all('history-entry')).toHaveLength(1);
    click('history-clear');
    await settle();
    expect(fake.requestsFor('history.clear')).toHaveLength(1);
    expect(q('history-empty')).not.toBeNull();
  });

  it('shows a failed history request in the panel', async () => {
    fake.fail('history.saveFavorite', { code: 'INTERNAL', message: 'disk full' });
    click('history-toggle');
    await settle();
    type('history-favorite-name', 'x');
    await settle();
    click('history-favorite-save');
    await settle();
    expect(q('history-error')?.textContent).toContain('disk full');
    // The name stays so the user can try again.
    expect(value('history-favorite-name')).toBe('x');
  });

  it('Escape closes the panel and returns focus to the History button', async () => {
    document.body.appendChild(el());
    click('history-toggle');
    await settle();
    get('history-favorite-name').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await settle();
    expect(q('history-panel')).toBeNull();
    expect(document.activeElement).toBe(get('history-toggle'));
    el().remove();
  });
});

describe('describeQuery', () => {
  const empty = { filter: '', projection: '', sort: '', collation: '', limit: '' };
  it('reads as the mongosh chain', () => {
    expect(describeQuery(empty)).toBe('find({})');
    expect(
      describeQuery({
        filter: ' { a: 1 } ',
        projection: '{ a: 1 }',
        sort: '{ a: -1 }',
        collation: "{ locale: 'en' }",
        limit: '5',
      }),
    ).toBe("find({ a: 1 }, { a: 1 }).sort({ a: -1 }).collation({ locale: 'en' }).limit(5)");
  });
});
