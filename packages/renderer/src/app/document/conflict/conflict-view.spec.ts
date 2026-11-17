import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { SlicedArray } from '@thicket/contract';
import { type BsonDocument, parseEJsonDocument, stringifyEJson } from '@thicket/core/bson';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../../api/testing';
import { ProfileSafetyService } from '../../safety/profile-safety.service';
import { DocumentActions } from '../document-actions.service';
import { DocumentEdits } from '../edit-session';
import { ConflictView } from './conflict-view';

const KEY = '{"$numberInt":"1"}';
const sku = (i: number) => `SKU-${String(i).padStart(6, '0')}`;
const skus = (from: number, n: number) => Array.from({ length: n }, (_, i) => sku(from + i));

// conflict-partial-docs: the conflict view on its own, with a fake host whose large document has
// cut arrays (`slicedOf`), so paths the collection view never produces (dotted paths, a server
// version without the array, local edits of the array) can be checked. All data is fictitious.
describe('ConflictView with a partly loaded (cut-array) document', () => {
  let fake: FakeThicketBridge;
  let edits: DocumentEdits;
  let actions: DocumentActions;
  let fixture: ComponentFixture<ConflictView>;
  let projection: string | undefined;
  /** The document's cut arrays as the host reports them (`undefined`: loaded whole). */
  let cut: readonly SlicedArray[] | undefined;

  const el = () => fixture.nativeElement as HTMLElement;
  const q = (id: string) => el().querySelector(`[data-testid="${id}"]`);
  const text = (id: string) => q(id)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const column = (id: 'conflict-local' | 'conflict-server') =>
    [...el().querySelectorAll(`[data-testid="${id}"]`)].map((c) => c.textContent ?? '').join('\n');
  const differing = () =>
    [...el().querySelectorAll('[data-testid="conflict-row"]')].filter(
      (r) => r.getAttribute('data-kind') !== 'same',
    );
  const doc = (value: Record<string, unknown>): BsonDocument =>
    parseEJsonDocument(JSON.stringify({ _id: { $numberInt: '1' }, ...value }));

  beforeEach(() => {
    fake = new FakeThicketBridge();
    projection = undefined;
    cut = [{ path: 'items', total: 50_000, loaded: 100 }];
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideFakeThicket(fake),
        DocumentEdits,
        DocumentActions,
      ],
    });
    TestBed.inject(ProfileSafetyService).set({
      id: 'p1',
      name: 'Local (fictitious)',
      readOnly: false,
      production: false,
    });
    edits = TestBed.inject(DocumentEdits);
    actions = TestBed.inject(DocumentActions);
    actions.setHost({
      profileId: 'p1',
      db: 'shop',
      coll: 'orders',
      projection: () => projection,
      slicedOf: () => (cut === undefined ? undefined : { above: 100, arrays: cut }),
      documentChanged: () => undefined,
    });
    fixture = TestBed.createComponent(ConflictView);
    fixture.componentRef.setInput('profileId', 'p1');
  });

  /** Edits `loaded` (as the explorer marks a cut document: partial) to `edited`, saves into a conflict. */
  async function conflictWith(
    loaded: BsonDocument,
    edited: BsonDocument,
    server: BsonDocument | null,
  ): Promise<void> {
    fake.fail('docs.update', {
      code: 'CONFLICT',
      message: 'changed (fictitious)',
      detail: { current: server === null ? null : stringifyEJson(server) },
    });
    edits.edit(loaded, edited, true);
    expect(await actions.save(KEY)).toBe(false);
    expect(actions.conflicts().has(KEY)).toBe(true);
    await settle();
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('compares only the loaded items of a cut array at a dotted path', async () => {
    cut = [{ path: 'order.lines', total: 300, loaded: 100 }];
    const loaded = doc({ name: 'large order', order: { ref: 'R-1', lines: skus(0, 100) } });
    const edited = doc({ name: 'renamed order', order: { ref: 'R-1', lines: skus(0, 100) } });
    const server = doc({
      name: 'renamed elsewhere',
      order: { ref: 'R-1', lines: skus(0, 300) },
    });
    await conflictWith(loaded, edited, server);

    const serverText = column('conflict-server');
    expect(serverText).toContain(sku(99));
    expect(serverText).not.toContain(sku(100));
    expect(serverText).not.toContain(sku(299));
    // Only the name differs: the never-loaded items 100-299 are no difference.
    expect(differing()).toHaveLength(1);
    expect(text('conflict-count')).toBe('1 differing line');
    expect(text('conflict-cut-note')).toBe(
      'order.lines: read page by page, so only the first 100 items are compared (the server has 300 items).',
    );
    // The sibling field of the cut array is kept as it is.
    expect(serverText).toMatch(/ref: ['"]R-1['"]/);
  });

  it('notes a cut array the server version no longer has, and shows the loaded items as differences', async () => {
    const loaded = doc({ name: 'large order', items: skus(0, 100) });
    const edited = doc({ name: 'renamed order', items: skus(0, 100) });
    const server = doc({ name: 'renamed elsewhere' });
    await conflictWith(loaded, edited, server);

    expect(text('conflict-cut-note')).toBe(
      'items: read page by page, so only the first 100 items are compared.',
    );
    expect(text('conflict-cut-note')).not.toContain('the server has');
    // The local items are a real difference (the server has no array any more).
    expect(column('conflict-local')).toContain(sku(42));
    expect(column('conflict-server')).not.toContain(sku(42));
    expect(differing().length).toBeGreaterThan(100);
  });

  it('leaves a server value that is no array at the cut path as it is', async () => {
    const loaded = doc({ name: 'large order', items: skus(0, 100) });
    const edited = doc({ name: 'renamed order', items: skus(0, 100) });
    const server = doc({ name: 'renamed elsewhere', items: 'replaced by a string (fictitious)' });
    await conflictWith(loaded, edited, server);

    expect(text('conflict-cut-note')).toBe(
      'items: read page by page, so only the first 100 items are compared.',
    );
    expect(column('conflict-server')).toContain('replaced by a string (fictitious)');
  });

  it('leaves a server value that is no object on the way to a dotted cut path as it is', async () => {
    cut = [{ path: 'order.lines', total: 300, loaded: 100 }];
    const loaded = doc({ name: 'large order', order: { ref: 'R-1', lines: skus(0, 100) } });
    const edited = doc({ name: 'renamed order', order: { ref: 'R-1', lines: skus(0, 100) } });
    const server = doc({ name: 'renamed elsewhere', order: 'archived (fictitious)' });
    await conflictWith(loaded, edited, server);

    expect(text('conflict-cut-note')).toBe(
      'order.lines: read page by page, so only the first 100 items are compared.',
    );
    expect(column('conflict-server')).toContain('archived (fictitious)');
    expect(column('conflict-local')).toContain(sku(42));
  });

  it('names one note line per cut array, with singular wording and thousands separators', async () => {
    cut = [
      { path: 'items', total: 50_000, loaded: 100 },
      { path: 'tags', total: 1_200, loaded: 1 },
    ];
    const loaded = doc({ name: 'large order', items: skus(0, 100), tags: ['t-0'] });
    const edited = doc({ name: 'renamed order', items: skus(0, 100), tags: ['t-0'] });
    const server = doc({
      name: 'renamed elsewhere',
      items: skus(0, 1_234),
      tags: Array.from({ length: 1 }, (_, i) => `t-${i}`),
    });
    await conflictWith(loaded, edited, server);

    const lines = [...el().querySelectorAll('[data-testid="conflict-cut-note"] li')].map((li) =>
      li.textContent?.trim(),
    );
    expect(lines).toEqual([
      'items: read page by page, so only the first 100 items are compared (the server has 1,234 items).',
      'tags: read page by page, so only the first 1 item are compared (the server has 1 item).',
    ]);
    expect(differing()).toHaveLength(1);
  });

  it('with no edits left, still shows only the loaded part of the cut array, and only Keep server', async () => {
    const loaded = doc({ name: 'large order', items: skus(0, 100) });
    const edited = doc({ name: 'renamed order', items: skus(0, 100) });
    const server = doc({ name: 'renamed elsewhere', items: skus(0, 300) });
    await conflictWith(loaded, edited, server);
    edits.undo();
    await settle();

    expect(edits.get(KEY)).toBeUndefined();
    expect(text('conflict-count')).toBe('No unsaved edits left');
    const serverText = column('conflict-server');
    expect(serverText).toContain(sku(99));
    expect(serverText).not.toContain(sku(100));
    expect(text('conflict-cut-note')).toContain('(the server has 300 items)');
    expect(q('conflict-keep-server')).not.toBeNull();
    expect(q('conflict-overwrite')).toBeNull();
    expect(q('conflict-merge')).toBeNull();
  });

  it('offers neither Overwrite nor Merge, with the partial-load note, under a top-level projection too', async () => {
    projection = '{"name":{"$numberInt":"1"},"items":{"$numberInt":"1"}}';
    const loaded = doc({ name: 'large order', items: skus(0, 100) });
    const edited = doc({ name: 'renamed order', items: skus(0, 100) });
    await conflictWith(loaded, edited, doc({ name: 'renamed elsewhere', items: skus(0, 300) }));

    expect(text('conflict-note')).toContain('loaded only partly');
    expect(text('conflict-note')).toContain('long arrays are read page by page');
    expect(text('conflict-note')).not.toContain('was loaded with a projection');
    expect(text('conflict-note')).toContain(
      'Keep the server version, then edit single values again',
    );
    // Exactly one note, and the cut note is shown next to it (review CR-2).
    expect(el().querySelectorAll('[data-testid="conflict-note"]')).toHaveLength(1);
    expect(q('conflict-cut-note')).not.toBeNull();
    expect(q('conflict-overwrite')).toBeNull();
    expect(q('conflict-merge')).toBeNull();
  });

  it('a deleted server version: the partial-load note, no insert-again, and re-inserting is refused', async () => {
    const loaded = doc({ name: 'large order', items: skus(0, 100) });
    const edited = doc({ name: 'renamed order', items: skus(0, 100) });
    await conflictWith(loaded, edited, null);

    expect(text('conflict-title')).toContain('Deleted on the server');
    expect(q('conflict-cut-note')).toBeNull();
    // One note, naming the partial load, not a projection (review CR-1).
    expect(el().querySelectorAll('[data-testid="conflict-note"]')).toHaveLength(1);
    expect(text('conflict-note')).toContain('loaded only partly');
    expect(text('conflict-note')).toContain('long arrays are read page by page');
    expect(text('conflict-note')).toContain('would lose the data that was not loaded');
    expect(text('conflict-note')).not.toContain("query's projection");
    // Insert again could only be refused, so it is not offered; Keep it deleted is.
    expect(q('conflict-overwrite')).toBeNull();
    expect(q('conflict-merge')).toBeNull();
    expect(text('conflict-keep-server')).toBe('Keep it deleted');
    // Called directly, re-inserting is still refused before any write.
    expect(await actions.overwrite(KEY)).toBe(false);
    expect(actions.message()?.text).toContain('Not inserted');
    expect(actions.message()?.text).toContain('long arrays are read page by page');
    expect(actions.message()?.text).not.toContain('with a projection active');
    expect(fake.requestsFor('docs.insert')).toHaveLength(0);
    expect(actions.conflicts().has(KEY)).toBe(true);
  });

  it('a deleted cut document under a top-level projection still names the partial load', async () => {
    // Cut arrays win over an active projection (task ASSUMPTION): the view blocks insert-again and
    // the refusal uses the partial-load wording, not "with a projection active".
    projection = '{"name":{"$numberInt":"1"},"items":{"$numberInt":"1"}}';
    const loaded = doc({ name: 'large order', items: skus(0, 100) });
    await conflictWith(loaded, doc({ name: 'renamed order', items: skus(0, 100) }), null);

    expect(el().querySelectorAll('[data-testid="conflict-note"]')).toHaveLength(1);
    expect(text('conflict-note')).toContain('Inserting your version again is not available');
    expect(text('conflict-note')).not.toContain("query's projection");
    expect(q('conflict-overwrite')).toBeNull();
    expect(text('conflict-keep-server')).toBe('Keep it deleted');
    expect(await actions.overwrite(KEY)).toBe(false);
    expect(actions.message()?.text).toContain('loaded only partly');
    expect(actions.message()?.text).not.toContain('with a projection active');
    expect(fake.requestsFor('docs.insert')).toHaveLength(0);
  });

  it('a deleted server version under a projection keeps the projection wording when not cut', async () => {
    // Not a large document: no cut arrays, so the projection is what made it partial.
    cut = undefined;
    projection = '{"name":{"$numberInt":"1"}}';
    const loaded = doc({ name: 'small order' });
    await conflictWith(loaded, doc({ name: 'renamed order' }), null);

    // The view follows the service's rule (conflict-reinsert-rule): no insert-again, one note why.
    expect(actions.reinsertBlocker(KEY)).toBe('projection');
    expect(el().querySelectorAll('[data-testid="conflict-note"]')).toHaveLength(1);
    expect(text('conflict-note')).toContain('Inserting your version again is not available');
    expect(text('conflict-note')).toContain('with a projection');
    expect(text('conflict-note')).not.toContain('Overwrite and Merge manually');
    expect(q('conflict-overwrite')).toBeNull();
    expect(q('conflict-merge')).toBeNull();
    expect(text('conflict-keep-server')).toBe('Keep it deleted');

    expect(await actions.overwrite(KEY)).toBe(false);
    expect(actions.message()?.text).toContain('with a projection active');
    expect(fake.requestsFor('docs.insert')).toHaveLength(0);
  });

  it('a deleted document loaded with a projection that was cleared since offers no insert-again', async () => {
    cut = undefined;
    projection = '{"name":{"$numberInt":"1"}}';
    const loaded = doc({ name: 'small order' });
    await conflictWith(loaded, doc({ name: 'renamed order' }), null);
    // The projection is cleared: the edited document stays partial (an edit re-renders the view).
    projection = undefined;
    edits.edit(loaded, doc({ name: 'renamed again' }), true);
    await settle();

    expect(actions.reinsertBlocker(KEY)).toBe('partial');
    expect(el().querySelectorAll('[data-testid="conflict-note"]')).toHaveLength(1);
    expect(text('conflict-note')).toContain('Inserting your version again is not available');
    expect(text('conflict-note')).toContain('Keep it deleted');
    expect(q('conflict-overwrite')).toBeNull();
    expect(text('conflict-keep-server')).toBe('Keep it deleted');
    expect(await actions.overwrite(KEY)).toBe(false);
    expect(actions.message()?.text).toContain('loaded only partly');
    expect(fake.requestsFor('docs.insert')).toHaveLength(0);
  });

  it('a deleted whole document without a projection still offers insert-again', async () => {
    cut = undefined;
    const loaded = doc({ name: 'small order' });
    fake.fail('docs.update', {
      code: 'CONFLICT',
      message: 'changed (fictitious)',
      detail: { current: null },
    });
    edits.edit(loaded, doc({ name: 'renamed order' }), false);
    expect(await actions.save(KEY)).toBe(false);
    await settle();

    expect(actions.reinsertBlocker(KEY)).toBeNull();
    expect(q('conflict-note')).toBeNull();
    expect(text('conflict-overwrite')).toBe('Insert your version again');
  });

  it('a deleted partial document without an active projection gets the partial-load wording', async () => {
    // Edited under a projection that was cleared since (partial sticks), not cut.
    cut = undefined;
    const loaded = doc({ name: 'small order' });
    await conflictWith(loaded, doc({ name: 'renamed order' }), null);
    expect(await actions.overwrite(KEY)).toBe(false);
    expect(actions.message()?.text).toContain('Not inserted');
    expect(actions.message()?.text).toContain('loaded only partly');
    expect(actions.message()?.text).not.toContain('with a projection active');
    expect(fake.requestsFor('docs.insert')).toHaveLength(0);
  });

  it('a document blocked by a projection shows only the projection note (review CR-2)', async () => {
    // Not cut; a dotted projection hides parts of fields, so Overwrite and Merge are blocked.
    cut = undefined;
    projection = '{"order.ref":{"$numberInt":"1"}}';
    const loaded = doc({ order: { ref: 'R-1' } });
    await conflictWith(loaded, doc({ order: { ref: 'R-2' } }), doc({ order: { ref: 'R-3' } }));

    expect(actions.resolveBlocker(KEY)).toBe('projection');
    expect(el().querySelectorAll('[data-testid="conflict-note"]')).toHaveLength(1);
    expect(text('conflict-note')).toContain('was loaded with a projection');
    expect(text('conflict-note')).not.toContain('Only the fields loaded');
    expect(q('conflict-overwrite')).toBeNull();
    expect(q('conflict-merge')).toBeNull();
  });

  it('a partial document under a top-level projection (not blocked) keeps the compare note', async () => {
    cut = undefined;
    projection = '{"name":{"$numberInt":"1"}}';
    const loaded = doc({ name: 'small order' });
    await conflictWith(loaded, doc({ name: 'renamed order' }), doc({ name: 'renamed elsewhere' }));

    expect(actions.resolveBlocker(KEY)).toBeNull();
    expect(el().querySelectorAll('[data-testid="conflict-note"]')).toHaveLength(1);
    expect(text('conflict-note')).toContain('Only the fields loaded');
    expect(q('conflict-overwrite')).not.toBeNull();
  });

  describe('when the cut array was edited locally (raw editor) after the conflict', () => {
    const loaded = doc({ name: 'large order', items: skus(0, 100) });
    const server = doc({ name: 'renamed elsewhere', items: skus(0, 300) });

    it('shorter: shows no never-loaded server items', async () => {
      await conflictWith(loaded, doc({ name: 'renamed order', items: skus(0, 100) }), server);
      edits.edit(loaded, doc({ name: 'renamed order', items: skus(0, 98) }), true);
      await settle();

      const serverText = column('conflict-server');
      expect(serverText).not.toContain(sku(100));
      expect(serverText).not.toContain(sku(299));
      // The two loaded items removed locally are still a difference (observation O-1).
      expect(serverText).toContain(sku(98));
      expect(serverText).toContain(sku(99));
      expect(text('conflict-cut-note')).toBe(
        'items: read page by page, so only the first 100 items are compared (the server has 300 items).',
      );
    });

    it('longer: never-loaded server items are neither shown nor counted as differences', async () => {
      await conflictWith(loaded, doc({ name: 'renamed order', items: skus(0, 100) }), server);
      // Two items appended locally: they are new, not a change of the server's items 100 and 101.
      const appended = [...skus(0, 100), 'NEW-A (fictitious)', 'NEW-B (fictitious)'];
      edits.edit(loaded, doc({ name: 'renamed order', items: appended }), true);
      await settle();

      const serverText = column('conflict-server');
      expect(serverText).toContain(sku(99));
      // Items 100 and 101 were never loaded (criterion 1).
      expect(serverText).not.toContain(sku(100));
      expect(serverText).not.toContain(sku(101));
      // The appended items are only in the local version (a gap on the server side); the other
      // differences are the name and the last loaded item's line (it gains a comma locally).
      const serverCells = differing().map((r) =>
        r.querySelector('[data-testid="conflict-server"]'),
      );
      expect(serverCells.filter((c) => c?.classList.contains('gap'))).toHaveLength(2);
      expect(differing()).toHaveLength(4);
      expect(serverCells.map((c) => c?.textContent ?? '').join('\n')).toContain(sku(99));
      expect(text('conflict-cut-note')).toBe(
        'items: read page by page, so only the first 100 items are compared (the server has 300 items).',
      );
    });
  });
});
