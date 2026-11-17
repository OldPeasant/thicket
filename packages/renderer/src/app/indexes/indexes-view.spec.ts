import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { IndexInfo, IndexStats } from '@thicket/contract';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import type { WorkspaceTab } from '../layout/workspace.service';
import { ConfirmService } from '../safety/confirm.service';
import { ProfileSafetyService } from '../safety/profile-safety.service';
import { READ_ONLY_HINT } from '../safety/write-control.directive';
import { formatBytes, IndexesView, indexesTabId, keyParts, toRows } from './indexes-view';

const TAB: WorkspaceTab = {
  id: 'indexes:p1:shop.orders',
  kind: 'indexes',
  title: 'orders indexes',
  data: { profileId: 'p1', db: 'shop', coll: 'orders', type: 'collection' },
} as WorkspaceTab;

function info(name: string, key: string, extra: Partial<IndexInfo> = {}): IndexInfo {
  return {
    name,
    key,
    unique: false,
    sparse: false,
    hidden: false,
    raw: `{"v":{"$numberInt":"2"},"key":${key},"name":"${name}"}`,
    ...extra,
  };
}

const ID = info('_id_', '{"_id":{"$numberInt":"1"}}');
const TTL = info('createdAt_1', '{"createdAt":{"$numberInt":"1"}}', { expireAfterSeconds: 3600 });
const PARTIAL = info('status_-1', '{"status":{"$numberInt":"-1"}}', {
  partialFilterExpression: '{"archived":false}',
  unique: true,
});
const HIDDEN = info('sku_hashed', '{"sku":"hashed"}', { hidden: true });

const STATS: IndexStats[] = [
  { name: '_id_', sizeBytes: 4096, accesses: 200, since: '2026-01-02T03:04:05.000Z' },
  { name: 'createdAt_1', sizeBytes: 20480, accesses: 50 },
  { name: 'status_-1', sizeBytes: 1536, accesses: 0 },
  { name: 'sku_hashed', sizeBytes: 0 },
];

/** A promise with its resolve function, to answer requests in a chosen order. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('IndexesView', () => {
  let fake: FakeThicketBridge;
  let fixture: ComponentFixture<IndexesView>;
  let view: IndexesView;
  let list: IndexInfo[];
  let confirm: ConfirmService;

  const el = () => fixture.nativeElement as HTMLElement;
  const all = <T extends HTMLElement = HTMLElement>(id: string, root: ParentNode = el()) => [
    ...root.querySelectorAll<T>(`[data-testid="${id}"]`),
  ];
  const q = <T extends HTMLElement = HTMLElement>(id: string, root: ParentNode = el()) =>
    root.querySelector<T>(`[data-testid="${id}"]`);
  const get = <T extends HTMLElement = HTMLElement>(id: string, root: ParentNode = el()): T => {
    const found = q<T>(id, root);
    if (found === null) throw new Error(`no element ${id}`);
    return found;
  };
  const row = (name: string): HTMLElement => {
    const found = el().querySelector<HTMLElement>(`[data-testid="idx-row"][data-name="${name}"]`);
    if (found === null) throw new Error(`no row ${name}`);
    return found;
  };
  const text = (e: Element | null) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const settle = async () => {
    for (let i = 0; i < 6; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
  };
  const click = async (button: HTMLElement) => {
    button.click();
    await settle();
  };
  const sent = (method: 'idx.drop' | 'idx.hide' | 'idx.list' | 'idx.stats') =>
    fake.requestsFor(method).map((r) => r.params as Record<string, unknown>);

  const setProfile = (readOnly: boolean, production = false) =>
    TestBed.inject(ProfileSafetyService).set({ id: 'p1', name: 'Local', readOnly, production });

  const create = async () => {
    fixture = TestBed.createComponent(IndexesView);
    view = fixture.componentInstance;
    fixture.componentRef.setInput('tab', TAB);
    await settle();
  };

  beforeEach(() => {
    fake = new FakeThicketBridge();
    list = [ID, TTL, PARTIAL, HIDDEN];
    fake.handle('idx.list', () => ({ indexes: list }));
    fake.respond('idx.stats', { indexes: STATS });
    fake.respond('idx.drop', {});
    fake.respond('idx.hide', {});
    TestBed.configureTestingModule({
      imports: [IndexesView],
      providers: [provideZonelessChangeDetection(), provideFakeThicket(fake)],
    });
    setProfile(false);
    confirm = TestBed.inject(ConfirmService);
  });

  describe('list and stats', () => {
    beforeEach(create);

    it('reads the list and the stats of the tab collection', () => {
      expect(sent('idx.list')).toEqual([{ profileId: 'p1', db: 'shop', coll: 'orders' }]);
      expect(sent('idx.stats')).toEqual([{ profileId: 'p1', db: 'shop', coll: 'orders' }]);
    });

    it('shows one row per index in server order with count, keys, options, size and uses', () => {
      expect(all('idx-row').map((r) => r.dataset['name'])).toEqual([
        '_id_',
        'createdAt_1',
        'status_-1',
        'sku_hashed',
      ]);
      expect(text(get('idx-count'))).toBe('4 indexes');
      expect(text(get('idx-key', row('createdAt_1')))).toBe('createdAt↑');
      expect(text(get('idx-key', row('status_-1')))).toBe('status↓');
      expect(text(get('idx-key', row('sku_hashed')))).toBe('skuhashed');
      expect(all('idx-tag', row('createdAt_1')).map(text)).toEqual(['TTL 3600 s']);
      expect(all('idx-tag', row('status_-1')).map(text)).toEqual(['unique', 'partial']);
      expect(text(get('idx-partial-filter', row('status_-1')))).toBe('{ archived: false }');
      expect(all('idx-tag', row('sku_hashed')).map(text)).toEqual(['hidden']);
      expect(row('sku_hashed').classList).toContain('hidden');
      expect(text(get('idx-size', row('_id_')))).toBe('4.0 KB');
      expect(text(get('idx-size', row('createdAt_1')))).toBe('20 KB');
      expect(text(get('idx-uses', row('_id_')))).toBe('200');
      expect(get('idx-uses', row('_id_')).getAttribute('title')).toMatch(/^since /);
      expect(get('idx-uses', row('createdAt_1')).getAttribute('title')).toBeNull();
      // Usage relative to the busiest index; no accesses → no meter and a dash.
      const fill = (name: string) =>
        row(name).querySelector<HTMLElement>('.meter .fill')?.style.width ?? null;
      expect(fill('_id_')).toBe('100%');
      expect(fill('createdAt_1')).toBe('25%');
      expect(fill('status_-1')).toBe('0%');
      expect(fill('sku_hashed')).toBeNull();
      expect(text(get('idx-uses', row('sku_hashed')))).toBe('—');
      expect(q('idx-stats-error')).toBeNull();
    });

    it('shows an unparseable "since" as it came', async () => {
      fake.respond('idx.stats', {
        indexes: [{ name: '_id_', sizeBytes: 1, accesses: 1, since: 'sometime' }],
      });
      await click(get('idx-refresh'));
      expect(get('idx-uses', row('_id_')).getAttribute('title')).toBe('sometime');
    });

    it('says "1 index" for a single index', async () => {
      list = [ID];
      await click(get('idx-refresh'));
      expect(text(get('idx-count'))).toBe('1 index');
    });

    it('_id_ has no hide or drop actions; others have both', () => {
      expect(q('idx-hide', row('_id_'))).toBeNull();
      expect(q('idx-drop', row('_id_'))).toBeNull();
      expect(get('idx-hide', row('createdAt_1')).getAttribute('aria-label')).toBe(
        'Hide createdAt_1',
      );
      expect(get('idx-hide', row('sku_hashed')).getAttribute('aria-label')).toBe(
        'Unhide sku_hashed',
      );
      expect(text(get('idx-hide', row('sku_hashed')))).toBe('Unhide');
      expect(get('idx-drop', row('createdAt_1')).getAttribute('aria-label')).toBe(
        'Drop createdAt_1',
      );
    });

    it('Refresh reads the list again', async () => {
      list = [ID, TTL];
      await click(get('idx-refresh'));
      expect(sent('idx.list')).toHaveLength(2);
      expect(all('idx-row')).toHaveLength(2);
    });
  });

  it('a failed idx.stats keeps the list and only empties sizes and uses', async () => {
    fake.fail('idx.stats', { code: 'SERVER_ERROR', message: 'not authorized on shop' });
    await create();
    expect(all('idx-row')).toHaveLength(4);
    expect(all('idx-size').map(text)).toEqual(['—', '—', '—', '—']);
    expect(all('idx-uses').map(text)).toEqual(['—', '—', '—', '—']);
    expect(el().querySelector('.meter')).toBeNull();
    expect(text(get('idx-stats-error'))).toContain('not authorized on shop');
    expect(q('idx-load-error')).toBeNull();
    // Tags and keys still come from the list.
    expect(all('idx-tag', row('createdAt_1')).map(text)).toEqual(['TTL 3600 s']);

    // The stats note goes away once stats work again.
    fake.respond('idx.stats', { indexes: STATS });
    await click(get('idx-refresh'));
    expect(q('idx-stats-error')).toBeNull();
    expect(text(get('idx-size', row('_id_')))).toBe('4.0 KB');
  });

  it('a failed idx.list shows the error, keeps the previous rows and ends loading', async () => {
    await create();
    fake.fail('idx.list', { code: 'NETWORK_ERROR', message: 'connection reset' });
    await click(get('idx-refresh'));
    expect(text(get('idx-load-error'))).toContain('connection reset');
    expect(all('idx-row')).toHaveLength(4);
    expect(view.loading()).toBe(false);
    expect(get<HTMLButtonElement>('idx-refresh').disabled).toBe(false);

    // A later successful reload clears the error.
    fake.handle('idx.list', () => ({ indexes: list }));
    await click(get('idx-refresh'));
    expect(q('idx-load-error')).toBeNull();
  });

  it('a failed first idx.list shows the error and no table', async () => {
    fake.fail('idx.list', { code: 'NETWORK_ERROR', message: 'connection refused' });
    await create();
    expect(text(get('idx-load-error'))).toContain('connection refused');
    expect(q('idx-list')).toBeNull();
    expect(q('idx-count')).toBeNull();
    expect(el().textContent).not.toContain('Reading indexes');
  });

  it('shows "Reading indexes…" while the first read is pending and disables Refresh', async () => {
    const pending = deferred<{ indexes: IndexInfo[] }>();
    fake.handle('idx.list', () => pending.promise);
    await create();
    expect(el().textContent).toContain('Reading indexes…');
    expect(get<HTMLButtonElement>('idx-refresh').disabled).toBe(true);
    pending.resolve({ indexes: [ID] });
    await settle();
    expect(el().textContent).not.toContain('Reading indexes…');
    expect(all('idx-row')).toHaveLength(1);
    expect(get<HTMLButtonElement>('idx-refresh').disabled).toBe(false);
  });

  describe('stale reload answers', () => {
    it('an older successful answer arriving last does not replace a newer one', async () => {
      const answers: ReturnType<typeof deferred<{ indexes: IndexInfo[] }>>[] = [];
      fake.handle('idx.list', () => {
        const d = deferred<{ indexes: IndexInfo[] }>();
        answers.push(d);
        return d.promise;
      });
      await create();
      const second = view.reload();
      await settle();
      expect(answers).toHaveLength(2);
      answers[1]?.resolve({ indexes: [ID, TTL] });
      await second;
      await settle();
      expect(all('idx-row')).toHaveLength(2);
      expect(view.loading()).toBe(false);

      answers[0]?.resolve({ indexes: [ID] });
      await settle();
      expect(all('idx-row')).toHaveLength(2);
      expect(view.loading()).toBe(false);
    });

    it('an older failure arriving last neither shows an error nor touches loading', async () => {
      const answers: ReturnType<typeof deferred<{ indexes: IndexInfo[] } | { error: never }>>[] =
        [];
      fake.handle('idx.list', () => {
        const d = deferred<{ indexes: IndexInfo[] } | { error: never }>();
        answers.push(d);
        return d.promise as never;
      });
      await create();
      void view.reload();
      void view.reload();
      await settle();
      expect(answers).toHaveLength(3);
      answers[0]?.resolve({ error: { code: 'NETWORK_ERROR', message: 'old failure' } as never });
      answers[1]?.resolve({ error: { code: 'NETWORK_ERROR', message: 'middle failure' } as never });
      await settle();
      expect(q('idx-load-error')).toBeNull();
      expect(view.loading()).toBe(true);
      answers[2]?.resolve({ indexes: [ID] });
      await settle();
      expect(view.loading()).toBe(false);
      expect(all('idx-row')).toHaveLength(1);
      expect(q('idx-load-error')).toBeNull();
    });

    it('switching to another collection ignores the answer for the previous one', async () => {
      const answers = new Map<string, ReturnType<typeof deferred<{ indexes: IndexInfo[] }>>>();
      fake.handle('idx.list', (params) => {
        const d = deferred<{ indexes: IndexInfo[] }>();
        answers.set(params.coll, d);
        return d.promise;
      });
      await create();
      fixture.componentRef.setInput('tab', {
        ...TAB,
        id: indexesTabId('p1', 'shop', 'customers'),
        data: { profileId: 'p1', db: 'shop', coll: 'customers', type: 'collection' },
      });
      await settle();
      expect(sent('idx.list').map((p) => p['coll'])).toEqual(['orders', 'customers']);
      answers.get('customers')?.resolve({ indexes: [ID] });
      await settle();
      answers.get('orders')?.resolve({ indexes: [ID, TTL, PARTIAL] });
      await settle();
      expect(all('idx-row').map((r) => r.dataset['name'])).toEqual(['_id_']);
      expect(el().querySelector('.ns')?.getAttribute('title')).toBe('shop.customers');
    });
  });

  it('a new tab object for the same collection does not read again', async () => {
    await create();
    fixture.componentRef.setInput('tab', { ...TAB, title: 'renamed tab' });
    await settle();
    expect(sent('idx.list')).toHaveLength(1);
  });

  describe('drop', () => {
    beforeEach(create);

    it('asks through the confirm dialog and sends nothing on cancel', async () => {
      await click(get('idx-drop', row('createdAt_1')));
      const request = confirm.current();
      expect(request).not.toBeNull();
      expect(request?.confirmLabel).toBe('Drop index');
      expect(request?.destructive).toBe(true);
      expect(request?.detail).toBe('Drops createdAt_1.');
      expect(request?.namespace).toBe('shop.orders');
      expect(sent('idx.drop')).toEqual([]);
      // While the dialog is open the row actions are busy.
      expect(get<HTMLButtonElement>('idx-hide', row('status_-1')).disabled).toBe(true);

      confirm.answer(false);
      await settle();
      expect(sent('idx.drop')).toEqual([]);
      expect(q('idx-message')).toBeNull();
      expect(view.busy()).toBeNull();
      expect(get<HTMLButtonElement>('idx-hide', row('status_-1')).disabled).toBe(false);
      expect(sent('idx.list')).toHaveLength(1);
    });

    it('sends idx.drop with confirmed after the user confirms, then reloads', async () => {
      await click(get('idx-drop', row('createdAt_1')));
      list = [ID, PARTIAL, HIDDEN];
      confirm.answer(true);
      await settle();
      expect(sent('idx.drop')).toEqual([
        { profileId: 'p1', db: 'shop', coll: 'orders', name: 'createdAt_1', confirmed: true },
      ]);
      expect(text(get('idx-message'))).toBe('Dropped index createdAt_1.');
      expect(get('idx-message').getAttribute('role')).toBe('status');
      expect(sent('idx.list')).toHaveLength(2);
      expect(all('idx-row').map((r) => r.dataset['name'])).toEqual([
        '_id_',
        'status_-1',
        'sku_hashed',
      ]);
    });

    it('shows a server error as an alert and keeps the list', async () => {
      fake.fail('idx.drop', { code: 'SERVER_ERROR', message: 'index not found with name' });
      await click(get('idx-drop', row('createdAt_1')));
      confirm.answer(true);
      await settle();
      expect(text(get('idx-message'))).toContain('index not found with name');
      expect(get('idx-message').getAttribute('role')).toBe('alert');
      expect(get('idx-message').classList).toContain('error');
      expect(sent('idx.list')).toHaveLength(1);
      expect(view.busy()).toBeNull();
    });

    it('ignores a second write while one is running', async () => {
      await click(get('idx-drop', row('createdAt_1')));
      await view.toggleHidden(view.rows()?.[2] ?? (null as never));
      await view.drop(view.rows()?.[2] ?? (null as never));
      confirm.answer(true);
      await settle();
      expect(sent('idx.drop').map((p) => p['name'])).toEqual(['createdAt_1']);
      expect(sent('idx.hide')).toEqual([]);
      expect(confirm.current()).toBeNull();
    });
  });

  describe('hide and unhide', () => {
    beforeEach(create);

    it('hides a visible index without asking on a non-production profile', async () => {
      await click(get('idx-hide', row('createdAt_1')));
      expect(confirm.current()).toBeNull();
      expect(sent('idx.hide')).toEqual([
        { profileId: 'p1', db: 'shop', coll: 'orders', name: 'createdAt_1', hidden: true },
      ]);
      expect(text(get('idx-message'))).toBe('Hid index createdAt_1.');
      expect(sent('idx.list')).toHaveLength(2);
    });

    it('unhides a hidden index', async () => {
      await click(get('idx-hide', row('sku_hashed')));
      expect(sent('idx.hide')).toEqual([
        { profileId: 'p1', db: 'shop', coll: 'orders', name: 'sku_hashed', hidden: false },
      ]);
      expect(text(get('idx-message'))).toBe('Unhid index sku_hashed.');
    });

    it('shows a hide failure', async () => {
      fake.fail('idx.hide', { code: 'SERVER_ERROR', message: 'cannot hide this index' });
      await click(get('idx-hide', row('createdAt_1')));
      expect(text(get('idx-message'))).toContain('cannot hide this index');
      expect(get('idx-message').getAttribute('role')).toBe('alert');
    });
  });

  it('asks before hiding on a production profile and sends nothing on cancel', async () => {
    setProfile(false, true);
    await create();
    await click(get('idx-hide', row('createdAt_1')));
    expect(confirm.current()?.title).toBe('Change index visibility');
    confirm.answer(false);
    await settle();
    expect(sent('idx.hide')).toEqual([]);
    expect(q('idx-message')).toBeNull();
  });

  describe('read-only profile', () => {
    beforeEach(async () => {
      setProfile(true);
      await create();
    });

    it('disables create, hide and drop with the read-only hint but still lists', () => {
      expect(all('idx-row')).toHaveLength(4);
      for (const button of [
        get<HTMLButtonElement>('idx-create'),
        ...all<HTMLButtonElement>('idx-hide'),
        ...all<HTMLButtonElement>('idx-drop'),
      ]) {
        expect(button.disabled).toBe(true);
        expect(button.getAttribute('title')).toBe(READ_ONLY_HINT);
      }
      expect(get<HTMLButtonElement>('idx-refresh').disabled).toBe(false);
    });

    it('refuses a drop called directly before anything is sent or asked', async () => {
      const target = view.rows()?.find((r) => r.name === 'createdAt_1');
      if (!target) throw new Error('no row');
      await view.drop(target);
      await settle();
      expect(confirm.current()).toBeNull();
      expect(sent('idx.drop')).toEqual([]);
      expect(text(get('idx-message'))).toContain('Local is read-only.');
    });
  });

  describe('create form', () => {
    beforeEach(create);

    it('opens the form, disables Create while open, and closes on cancel', async () => {
      expect(el().querySelector('app-index-create-form')).toBeNull();
      await click(get('idx-create'));
      expect(el().querySelector('app-index-create-form')).not.toBeNull();
      expect(get<HTMLButtonElement>('idx-create').disabled).toBe(true);
      await click(get('idx-create-cancel'));
      expect(el().querySelector('app-index-create-form')).toBeNull();
      expect(get<HTMLButtonElement>('idx-create').disabled).toBe(false);
    });

    it('after a create closes the form, reports it and reloads', async () => {
      fake.handle('idx.create', () => ({ name: 'email_1' }));
      await click(get('idx-create'));
      const field = get<HTMLInputElement>('idx-key-field');
      field.value = 'email';
      field.dispatchEvent(new Event('input'));
      await settle();
      await click(get('idx-create-submit'));
      expect(el().querySelector('app-index-create-form')).toBeNull();
      expect(text(get('idx-message'))).toBe('Created index email_1.');
      expect(sent('idx.list')).toHaveLength(2);
    });

    it('opening the form clears the last message', async () => {
      await click(get('idx-hide', row('createdAt_1')));
      expect(q('idx-message')).not.toBeNull();
      await click(get('idx-create'));
      expect(q('idx-message')).toBeNull();
    });
  });

  it('uses the tab title as the collection when the tab has no data', async () => {
    fixture = TestBed.createComponent(IndexesView);
    fixture.componentRef.setInput('tab', { id: 'x', kind: 'indexes', title: 'loose' } as never);
    await settle();
    expect(sent('idx.list')).toEqual([{ profileId: '', db: '', coll: 'loose' }]);
  });
});

describe('indexesTabId', () => {
  it('is stable per profile and namespace', () => {
    expect(indexesTabId('p1', 'shop', 'orders')).toBe('indexes:p1:shop.orders');
  });
});

describe('keyParts', () => {
  it('maps directions to asc/desc and keeps index types', () => {
    expect(
      keyParts(
        '{"a":{"$numberInt":"1"},"b":{"$numberInt":"-1"},"c":"text","d":"2dsphere","e":"hashed"}',
      ),
    ).toEqual([
      { field: 'a', kind: 'asc' },
      { field: 'b', kind: 'desc' },
      { field: 'c', kind: 'text' },
      { field: 'd', kind: '2dsphere' },
      { field: 'e', kind: 'hashed' },
    ]);
  });

  it('reads double, long and decimal directions by sign', () => {
    expect(
      keyParts(
        '{"a":{"$numberDouble":"-1.0"},"b":{"$numberLong":"1"},"c":{"$numberDecimal":"-1"},"d":{"$numberLong":"-1"}}',
      ),
    ).toEqual([
      { field: 'a', kind: 'desc' },
      { field: 'b', kind: 'asc' },
      { field: 'c', kind: 'desc' },
      { field: 'd', kind: 'desc' },
    ]);
  });

  it('counts other value types as ascending', () => {
    expect(keyParts('{"a":true}')).toEqual([{ field: 'a', kind: 'asc' }]);
  });

  it('shows unparseable keys as one "?" part', () => {
    expect(keyParts('not json')).toEqual([{ field: 'not json', kind: '?' }]);
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [10 * 1024 - 1, '10.0 KB'],
    [10 * 1024, '10 KB'],
    [1024 * 1024, '1.0 MB'],
    [5.25 * 1024 ** 3, '5.3 GB'],
    [2 * 1024 ** 4, '2.0 TB'],
    [2048 * 1024 ** 4, '2048 TB'],
  ])('%d -> %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe('toRows', () => {
  it('joins stats by name and computes usage relative to the busiest index', () => {
    const rows = toRows([ID, TTL, PARTIAL, HIDDEN], STATS);
    expect(rows.map((r) => [r.name, r.sizeBytes, r.accesses, r.usage, r.isId])).toEqual([
      ['_id_', 4096, 200, 1, true],
      ['createdAt_1', 20480, 50, 0.25, false],
      ['status_-1', 1536, 0, 0, false],
      ['sku_hashed', 0, null, null, false],
    ]);
    expect(rows[0]?.since).toBe('2026-01-02T03:04:05.000Z');
    expect(rows[1]?.since).toBeNull();
  });

  it('without stats leaves size, uses and usage empty', () => {
    expect(toRows([TTL], null)[0]).toMatchObject({
      sizeBytes: null,
      accesses: null,
      since: null,
      usage: null,
    });
  });

  it('gives 0 usage to every index when none was used', () => {
    const rows = toRows(
      [ID, TTL],
      [
        { name: '_id_', sizeBytes: 1, accesses: 0 },
        { name: 'createdAt_1', sizeBytes: 1, accesses: 0 },
      ],
    );
    expect(rows.map((r) => r.usage)).toEqual([0, 0]);
  });

  it('builds the option tags and the partial filter in shell syntax', () => {
    const all = info('combo', '{"a":{"$numberInt":"1"}}', {
      unique: true,
      sparse: true,
      expireAfterSeconds: 0,
      partialFilterExpression: '{"qty":{"$gt":{"$numberInt":"5"}}}',
      hidden: true,
      raw: '{"name":"combo","collation":{"locale":"fr","strength":{"$numberInt":"2"}}}',
    });
    const [r] = toRows([all], null);
    expect(r?.tags).toEqual([
      { label: 'unique' },
      { label: 'sparse' },
      { label: 'TTL 0 s', title: 'expireAfterSeconds' },
      { label: 'partial', title: 'partialFilterExpression' },
      { label: 'collation fr', title: '{ locale: "fr", strength: 2 }' },
    ]);
    expect(r?.partialFilter).toBe('{ qty: { $gt: 5 } }');
    expect(r?.hidden).toBe(true);
  });

  it('labels a collation without a string locale just "collation"', () => {
    const [r] = toRows([info('c', '{"a":1}', { raw: '{"collation":{"strength":2}}' })], null);
    expect(r?.tags.map((t) => t.label)).toEqual(['collation']);
  });

  it('ignores an unparseable raw spec and keeps an unparseable filter as text', () => {
    const [r] = toRows(
      [info('bad', '{"a":1}', { raw: 'nope', partialFilterExpression: 'not ejson' })],
      null,
    );
    expect(r?.tags.map((t) => t.label)).toEqual(['partial']);
    expect(r?.partialFilter).toBe('not ejson');
  });
});
