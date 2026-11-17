import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import type { WorkspaceTab } from '../layout/workspace.service';
import { MAX_EVENTS, WatchView } from './watch-view';
import { watchTabId, type WatchTabData } from './watch.model';

const ID = '{"$oid":"65a000000000000000000001"}';

const event = (operationType: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    _id: { _data: 'token' },
    operationType,
    clusterTime: { $timestamp: { t: 1_700_000_000, i: 1 } },
    wallTime: { $date: { $numberLong: '1700000000250' } },
    ns: { db: 'shop', coll: 'orders' },
    documentKey: { _id: JSON.parse(ID) as unknown },
    ...extra,
  });

const INSERT = event('insert', { fullDocument: { _id: JSON.parse(ID) as unknown, n: 1 } });
const UPDATE = event('update', {
  updateDescription: { updatedFields: { status: 'paid' }, removedFields: ['draft'] },
});
const DELETE = event('delete');

function tab(data: WatchTabData): WorkspaceTab {
  return {
    id: watchTabId(data.profileId, data.db, data.coll),
    kind: 'watch',
    title: 'Watch',
    data: { ...data },
  };
}

describe('WatchView', () => {
  let fake: FakeThicketBridge;
  let fixture: ComponentFixture<WatchView>;
  let view: WatchView;

  const el = () => fixture.nativeElement as HTMLElement;
  const all = (id: string) => [...el().querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
  const get = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const found = el().querySelector<T>(`[data-testid="${id}"]`);
    if (found === null) throw new Error(`no element ${id}`);
    return found;
  };
  const text = (e: Element | null) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const settle = async () => {
    for (let i = 0; i < 6; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
  };
  const sent = () => fake.requestsFor('admin.watch').map((r) => r.params);
  const create = async (data: WatchTabData = { profileId: 'p1', db: 'shop', coll: 'orders' }) => {
    fixture = TestBed.createComponent(WatchView);
    view = fixture.componentInstance;
    fixture.componentRef.setInput('tab', tab(data));
    await settle();
  };
  const push = async (...events: string[]) => {
    for (const e of events) fake.data('admin.watch', 's1', { event: e });
    await settle();
  };

  beforeEach(() => {
    fake = new FakeThicketBridge();
    fake.respond('admin.watch', { streamId: 's1' });
    TestBed.configureTestingModule({
      imports: [WatchView],
      providers: [provideZonelessChangeDetection(), provideFakeThicket(fake)],
    });
  });

  afterEach(() => fixture?.destroy());

  it('starts watching the collection and lists events newest first', async () => {
    await create();
    expect(sent()).toEqual([
      { profileId: 'p1', db: 'shop', coll: 'orders', fullDocument: 'updateLookup' },
    ]);
    expect(text(get('watch-call'))).toBe(
      `db.getSiblingDB("shop").orders.watch([], { fullDocument: 'updateLookup' })`,
    );
    expect(text(get('watch-waiting'))).toContain('Watching');

    await push(INSERT, UPDATE, DELETE);
    const rows = all('watch-event');
    expect(rows.map((r) => r.dataset['op'])).toEqual(['delete', 'update', 'insert']);
    expect(rows.map((r) => r.dataset['kind'])).toEqual(['delete', 'update', 'insert']);
    expect(text(rows[1] ?? null)).toContain('set status; unset draft');
    expect(text(rows[2] ?? null)).toContain('ObjectId("65a000000000000000000001")');
    // A collection tab doesn't repeat the namespace.
    expect(rows[0]?.querySelector('.ns')).toBeNull();
    expect(text(get('watch-count'))).toBe('3 events');
  });

  it('expands an event to the whole event in shell syntax', async () => {
    await create();
    await push(UPDATE);
    el().querySelector<HTMLButtonElement>('.toggle')?.click();
    await settle();
    expect(text(get('watch-event-text'))).toContain('operationType: "update"');
    expect(text(get('watch-event-text'))).toContain('status: "paid"');
  });

  it("shows a clear 'needs replica set' message for a standalone server", async () => {
    fake.fail('admin.watch', {
      code: 'UNSUPPORTED',
      message:
        'Change streams need a replica set or a sharded cluster; this server is a standalone.',
      detail: { reason: 'needsReplicaSet' },
    });
    await create();
    const notice = get('watch-needs-rs');
    expect(notice.getAttribute('role')).toBe('alert');
    expect(text(notice)).toContain('change streams need a replica set');
    expect(text(notice)).toContain('--replSet');
    expect(all('watch-error')).toEqual([]);
    expect(all('watch-start')).toHaveLength(1);
  });

  it('shows other failures as an error', async () => {
    fake.fail('admin.watch', { code: 'NOT_CONNECTED', message: 'Not connected' });
    await create();
    expect(text(get('watch-error'))).toContain('Not connected');
    expect(all('watch-needs-rs')).toEqual([]);
  });

  it('shows a stream error and lets the user start again', async () => {
    await create();
    fake.failStream('s1', { code: 'SERVER_ERROR', message: 'cursor killed' });
    await settle();
    expect(text(get('watch-error'))).toContain('cursor killed');
    get('watch-start').click();
    await settle();
    expect(sent()).toHaveLength(2);
  });

  it('says so when the server ends the stream', async () => {
    await create();
    await push(event('drop'), event('invalidate'));
    fake.end('s1', { delivered: 2 });
    await settle();
    expect(text(get('watch-ended'))).toContain('ended the change stream');
    expect(all('watch-event').map((r) => r.dataset['kind'])).toEqual(['other', 'other']);
  });

  it('stops (cancels the stream), clears and starts again', async () => {
    await create();
    await push(INSERT);
    get('watch-stop').click();
    await settle();
    expect(fake.cancels).toContain('s1');
    expect(text(get('watch-stopped'))).toContain('Stopped');
    get('watch-clear').click();
    await settle();
    expect(all('watch-event')).toEqual([]);
    expect(get<HTMLButtonElement>('watch-clear').disabled).toBe(true);
    get('watch-start').click();
    await settle();
    expect(sent()).toHaveLength(2);
  });

  it('restarts without the lookup when the option is switched off', async () => {
    await create();
    const box = get<HTMLInputElement>('watch-lookup');
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    await settle();
    expect(fake.cancels).toContain('s1');
    expect(sent().at(-1)).toEqual({ profileId: 'p1', db: 'shop', coll: 'orders' });
  });

  it('watches a deployment and shows the namespace of each event', async () => {
    await create({ profileId: 'p1' });
    expect(sent()).toEqual([{ profileId: 'p1', fullDocument: 'updateLookup' }]);
    expect(text(get('watch-call'))).toBe(
      `db.getMongo().watch([], { fullDocument: 'updateLookup' })`,
    );
    await push(INSERT);
    expect(text(el().querySelector('.ns'))).toBe('shop.orders');
  });

  it('opens the changed document as it is now', async () => {
    fake.respond('docs.get', {
      doc: '{"_id":{"$oid":"65a000000000000000000001"},"n":{"$numberInt":"2"}}',
      sliced: [],
    });
    await create();
    await push(INSERT);
    get('watch-open').click();
    await settle();
    expect(fake.requestsFor('docs.get').map((r) => r.params)).toEqual([
      { profileId: 'p1', db: 'shop', coll: 'orders', id: ID },
    ]);
    expect(text(get('watch-doc-text'))).toContain('n: 2');
    get('watch-doc-close').click();
    await settle();
    expect(all('watch-doc')).toEqual([]);
  });

  it('says when the changed document no longer exists', async () => {
    fake.respond('docs.get', { doc: null, sliced: [] });
    await create();
    await push(DELETE);
    get('watch-open').click();
    await settle();
    expect(text(get('watch-doc-missing'))).toContain('No document with this _id');
  });

  it(`keeps the newest ${MAX_EVENTS} events`, async () => {
    await create();
    await push(...Array.from({ length: MAX_EVENTS + 5 }, () => INSERT));
    expect(view.entries()).toHaveLength(MAX_EVENTS);
    expect(view.entries()[0]?.seq).toBe(MAX_EVENTS + 5);
    expect(text(get('watch-count'))).toContain(`showing the newest ${MAX_EVENTS}`);
  });

  it('switching the lookup while stopped does not start; Start then uses the new mode', async () => {
    await create();
    get('watch-stop').click();
    await settle();
    const box = get<HTMLInputElement>('watch-lookup');
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    await settle();
    expect(sent()).toHaveLength(1);
    expect(view.status()).toEqual({ state: 'stopped' });
    expect(all('watch-start')).toHaveLength(1);
    get('watch-start').click();
    await settle();
    expect(sent().at(-1)).toEqual({ profileId: 'p1', db: 'shop', coll: 'orders' });
  });

  it('switching the lookup back on restarts with updateLookup; an unchanged mode does nothing', async () => {
    await create();
    view.setFullDocument(false);
    await settle();
    view.setFullDocument(false);
    await settle();
    expect(sent()).toHaveLength(2);
    view.setFullDocument(true);
    await settle();
    expect(sent()).toHaveLength(3);
    expect(sent().at(-1)).toEqual({
      profileId: 'p1',
      db: 'shop',
      coll: 'orders',
      fullDocument: 'updateLookup',
    });
  });

  it('collapses an expanded event on a second click', async () => {
    await create();
    await push(UPDATE);
    el().querySelector<HTMLButtonElement>('.toggle')?.click();
    await settle();
    expect(all('watch-event-text')).toHaveLength(1);
    el().querySelector<HTMLButtonElement>('.toggle')?.click();
    await settle();
    expect(all('watch-event-text')).toEqual([]);
  });

  it('does not start without a profile', async () => {
    fixture = TestBed.createComponent(WatchView);
    view = fixture.componentInstance;
    fixture.componentRef.setInput('tab', { id: 'watch:x', kind: 'watch', title: 'Watch' });
    await settle();
    expect(sent()).toEqual([]);
    expect(view.status()).toEqual({ state: 'stopped' });
  });

  it('ignores events and errors of a stream replaced by a restart', async () => {
    let n = 0;
    fake.handle('admin.watch', () => ({ streamId: `s${++n}` }));
    await create();
    get('watch-stop').click();
    await settle();
    get('watch-start').click();
    await settle();
    expect(fake.cancels).toEqual(['s1']);
    // Late data and a late error of the cancelled stream change nothing.
    fake.data('admin.watch', 's1', { event: DELETE });
    fake.failStream('s1', { code: 'CANCELLED', message: 'The operation was cancelled' });
    await push();
    expect(all('watch-event')).toEqual([]);
    expect(all('watch-error')).toEqual([]);
    expect(text(get('watch-waiting'))).toContain('Watching');
    fake.data('admin.watch', 's2', { event: INSERT });
    await settle();
    expect(all('watch-event').map((r) => r.dataset['op'])).toEqual(['insert']);
  });

  describe('opening documents in quick succession', () => {
    const OTHER_ID = '{"$oid":"65a000000000000000000002"}';
    const OTHER = event('insert', {
      documentKey: { _id: JSON.parse(OTHER_ID) as unknown },
      fullDocument: { _id: JSON.parse(OTHER_ID) as unknown, n: 7 },
    });
    const docOf = (id: string, n: number) => `{"_id":${id},"n":{"$numberInt":"${n}"}}`;

    /** docs.get answers the test releases by hand, per requested id. */
    function deferredDocsGet() {
      const pending = new Map<string, (outcome: unknown) => void>();
      fake.handle(
        'docs.get',
        ({ id }) =>
          new Promise((resolve) => pending.set(id, resolve as (outcome: unknown) => void)),
      );
      return (id: string, outcome: unknown) => pending.get(id)?.(outcome);
    }

    it('shows the newest document when an older request answers last', async () => {
      const release = deferredDocsGet();
      await create();
      await push(INSERT, OTHER);
      // Newest first: [OTHER, INSERT]. Open INSERT, then OTHER.
      all('watch-open')[1]?.click();
      await settle();
      all('watch-open')[0]?.click();
      await settle();
      release(OTHER_ID, { doc: docOf(OTHER_ID, 7), sliced: [] });
      await settle();
      release(ID, { doc: docOf(ID, 1), sliced: [] });
      await settle();
      expect(text(get('watch-doc-text'))).toContain('n: 7');
      expect(text(get('watch-doc-text'))).not.toContain('n: 1');
    });

    it('a late failure of an older request does not replace the newer document', async () => {
      const release = deferredDocsGet();
      await create();
      await push(INSERT, OTHER);
      all('watch-open')[1]?.click();
      await settle();
      all('watch-open')[0]?.click();
      await settle();
      release(OTHER_ID, { doc: docOf(OTHER_ID, 7), sliced: [] });
      await settle();
      release(ID, { error: { code: 'SERVER_ERROR', message: 'boom' } });
      await settle();
      expect(text(get('watch-doc-text'))).toContain('n: 7');
      expect(el().textContent).not.toContain('boom');
    });

    it('closing the panel while a document loads keeps it closed when the answer arrives', async () => {
      const release = deferredDocsGet();
      await create();
      await push(INSERT);
      get('watch-open').click();
      await settle();
      get('watch-doc-close').click();
      await settle();
      release(ID, { doc: docOf(ID, 1), sliced: [] });
      await settle();
      expect(all('watch-doc')).toEqual([]);
    });

    it('shows a failed document load as an error', async () => {
      fake.fail('docs.get', { code: 'SERVER_ERROR', message: 'not authorized on shop' });
      await create();
      await push(INSERT);
      get('watch-open').click();
      await settle();
      expect(text(get('watch-doc'))).toContain('not authorized on shop');
    });
  });

  it('cancels the stream when the tab closes', async () => {
    await create();
    fixture.destroy();
    expect(fake.cancels).toContain('s1');
  });
});
