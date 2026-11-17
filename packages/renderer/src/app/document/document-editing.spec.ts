import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { Request } from '@thicket/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api/api-error';
import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import { CollectionView } from '../collection/collection-view';
import { EditModeService } from '../explorer/services/edit-mode.service';
import type { WorkspaceTab } from '../layout/workspace.service';
import { ConfirmService, type ConfirmRequest } from '../safety/confirm.service';
import { ProfileSafetyService } from '../safety/profile-safety.service';
import { READ_ONLY_HINT } from '../safety/write-control.directive';

const TAB: WorkspaceTab = {
  id: 'p1/shop.orders',
  kind: 'collection',
  title: 'orders',
  data: { profileId: 'p1', db: 'shop', coll: 'orders', type: 'collection' },
};

/** `{_id: i, total: 10 * i, qty: i}` as canonical EJSON. */
function orderText(i: number, total = 10 * i, qty = i): string {
  return `{"_id":{"$numberInt":"${i}"},"total":{"$numberInt":"${total}"},"qty":{"$numberInt":"${qty}"}}`;
}

// The edit session through the collection tab: edits typed into the document list, the change
// count in the diff bar and the document's header, undo/redo, Revert, Save (docs.update through
// WriteGuard, the confirm dialog on production profiles), conflicts, insert, clone and delete,
// and read-only profiles.
describe('Editing documents in a collection tab', () => {
  let fake: FakeThicketBridge;
  let fixture: ComponentFixture<CollectionView>;
  let confirms: ConfirmRequest[];
  let confirmAnswer: boolean;

  const el = () => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(id: string, root: ParentNode = el()) =>
    root.querySelector<T>(`[data-testid="${id}"]`);
  const get = <T extends HTMLElement = HTMLElement>(id: string, root: ParentNode = el()): T => {
    const found = q<T>(id, root);
    if (found === null) throw new Error(`no element ${id}`);
    return found;
  };
  const text = (id: string, root: ParentNode = el()) => q(id, root)?.textContent?.trim() ?? '';
  const button = (id: string, root: ParentNode = el()) => get<HTMLButtonElement>(id, root);
  const docItem = (n: number) => {
    const item = el().querySelectorAll<HTMLElement>('[data-testid="result-doc"]')[n];
    if (item === undefined) throw new Error(`no document ${n}`);
    return item;
  };
  const input = (doc: number, key: string) => {
    const found = docItem(doc).querySelector<HTMLInputElement>(
      `.field[data-node$=".${key}"] app-bson-input input`,
    );
    if (found === null) throw new Error(`no input ${key} in document ${doc}`);
    return found;
  };

  const settle = async () => {
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
  };
  const click = async (id: string, root: ParentNode = el()) => {
    button(id, root).click();
    await settle();
  };
  /** Types into a number field of document `doc` (applied on blur, as the explorer does). */
  const typeInto = async (doc: number, key: string, value: string) => {
    const target = input(doc, key);
    target.value = value;
    target.dispatchEvent(new Event('blur'));
    await settle();
  };
  const key = async (k: string, init: KeyboardEventInit = {}) => {
    get('edit-bar').dispatchEvent(
      new KeyboardEvent('keydown', { key: k, ctrlKey: true, bubbles: true, ...init }),
    );
    await settle();
  };
  const updates = () =>
    fake.requestsFor('docs.update').map((r: Request) => r.params as Record<string, unknown>);

  beforeEach(async () => {
    fake = new FakeThicketBridge();
    let streams = 0;
    fake.handle('docs.find', () => {
      const id = `s${++streams}`;
      setTimeout(() => {
        fake.data('docs.find', id, { docs: [orderText(1), orderText(2), orderText(3)] });
        fake.end(id, { delivered: 3 });
      });
      return { streamId: id };
    });
    fake.respond('docs.estimatedCount', { count: 3 });
    fake.respond('docs.update', { modified: true });
    fake.respond('docs.get', { doc: orderText(1, 15, 4), sliced: [] });
    confirms = [];
    confirmAnswer = true;
    TestBed.configureTestingModule({
      imports: [CollectionView],
      providers: [provideZonelessChangeDetection(), provideFakeThicket(fake)],
    });
    vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockImplementation((request) => {
      confirms.push(request);
      return Promise.resolve(confirmAnswer);
    });
    TestBed.inject(ProfileSafetyService).set({
      id: 'p1',
      name: 'Local',
      readOnly: false,
      production: false,
    });
    fixture = TestBed.createComponent(CollectionView);
    fixture.componentRef.setInput('tab', TAB);
    await settle();
    await click('view-list');
    await click('edit-mode');
  });

  afterEach(() => {
    TestBed.inject(EditModeService).reset();
    vi.restoreAllMocks();
  });

  it('counts the changes of the edited document in the diff bar and its header', async () => {
    expect(q('edit-count')).toBeNull();
    expect(button('edit-save').disabled).toBe(true);
    expect(button('edit-revert').disabled).toBe(true);
    expect(docItem(0).querySelector('[data-testid="doc-changes"]')).toBeNull();

    await typeInto(0, 'total', '15');
    expect(text('edit-count')).toBe('1 change');
    expect(text('doc-changes', docItem(0))).toBe('1 change');
    expect(get('doc-header', docItem(0)).hasAttribute('data-modified')).toBe(true);
    expect(button('edit-save').disabled).toBe(false);

    await typeInto(0, 'qty', '4');
    expect(text('edit-count')).toBe('2 changes');
    expect(text('doc-changes', docItem(0))).toBe('2 changes');

    // A second document: the bar counts over both, each header its own.
    await typeInto(2, 'qty', '9');
    expect(text('edit-count')).toBe('3 changes in 2 documents');
    expect(text('doc-changes', docItem(2))).toBe('1 change');
    expect(q('doc-changes', docItem(1))).toBeNull();

    // Typing the loaded value back is no change any more.
    await typeInto(2, 'qty', '3');
    expect(text('edit-count')).toBe('2 changes');
    expect(q('doc-changes', docItem(2))).toBeNull();
    // Nothing was sent.
    expect(updates()).toHaveLength(0);
  });

  it('undoes and redoes edits, with the buttons and the keys', async () => {
    expect(button('edit-undo').disabled).toBe(true);
    expect(button('edit-redo').disabled).toBe(true);
    await typeInto(0, 'total', '15');
    await typeInto(0, 'qty', '4');
    expect(text('edit-count')).toBe('2 changes');

    await click('edit-undo');
    expect(text('edit-count')).toBe('1 change');
    expect(input(0, 'qty').value).toBe('1');
    expect(input(0, 'total').value).toBe('15');
    expect(button('edit-redo').disabled).toBe(false);

    await click('edit-undo');
    expect(q('edit-count')).toBeNull();
    expect(input(0, 'total').value).toBe('10');
    expect(button('edit-undo').disabled).toBe(true);

    await click('edit-redo');
    await click('edit-redo');
    expect(text('edit-count')).toBe('2 changes');
    expect(input(0, 'qty').value).toBe('4');
    expect(button('edit-redo').disabled).toBe(true);

    // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y outside text fields.
    await key('z');
    expect(text('edit-count')).toBe('1 change');
    await key('Z', { shiftKey: true });
    expect(text('edit-count')).toBe('2 changes');
    await key('z');
    await key('y');
    expect(text('edit-count')).toBe('2 changes');

    // A new edit after an undo drops the redo history.
    await click('edit-undo');
    await typeInto(1, 'qty', '7');
    expect(button('edit-redo').disabled).toBe(true);
    expect(text('edit-count')).toBe('2 changes in 2 documents');
  });

  it('reverts one document from its header, and every document from the bar', async () => {
    await typeInto(0, 'total', '15');
    await typeInto(1, 'qty', '7');
    expect(text('edit-count')).toBe('2 changes in 2 documents');

    await click('doc-revert', docItem(0));
    expect(text('edit-count')).toBe('1 change');
    expect(input(0, 'total').value).toBe('10');
    expect(input(1, 'qty').value).toBe('7');
    // The reverted document's edits left the undo history: undo goes to the other document.
    await click('edit-undo');
    expect(q('edit-count')).toBeNull();
    expect(input(0, 'total').value).toBe('10');

    await click('edit-redo');
    await typeInto(2, 'total', '31');
    expect(text('edit-count')).toBe('2 changes in 2 documents');
    await click('edit-revert');
    expect(q('edit-count')).toBeNull();
    expect(input(1, 'qty').value).toBe('2');
    expect(input(2, 'total').value).toBe('30');
    expect(button('edit-undo').disabled).toBe(true);
    expect(updates()).toHaveLength(0);
  });

  it('saves the minimal $set with the conflict filter and shows the server version', async () => {
    await typeInto(0, 'total', '15');
    await typeInto(0, 'qty', '4');
    await click('edit-save');

    expect(updates()).toEqual([
      {
        profileId: 'p1',
        db: 'shop',
        coll: 'orders',
        id: '{"$numberInt":"1"}',
        update: '{"$set":{"total":{"$numberInt":"15"},"qty":{"$numberInt":"4"}}}',
        expected: '{"total":{"$eq":{"$numberInt":"10"}},"qty":{"$eq":{"$numberInt":"1"}}}',
      },
    ]);
    // Not a production profile: no dialog, no `confirmed`.
    expect(confirms).toHaveLength(0);
    expect(fake.requestsFor('docs.get').at(-1)?.params).toMatchObject({ id: '{"$numberInt":"1"}' });
    expect(q('edit-count')).toBeNull();
    expect(text('edit-message')).toBe('Saved 1.');
    expect(input(0, 'total').value).toBe('15');
    expect(button('edit-undo').disabled).toBe(true);
  });

  it('saves the value still being typed in a field with Ctrl+S', async () => {
    const field = input(0, 'total');
    field.focus();
    field.value = '15';
    field.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    await settle();
    expect(updates().map((u) => u['update'])).toEqual(['{"$set":{"total":{"$numberInt":"15"}}}']);
    expect(q('edit-count')).toBeNull();
  });

  it('asks first on a production profile, showing the $set operation', async () => {
    TestBed.inject(ProfileSafetyService).set({
      id: 'p1',
      name: 'Prod',
      readOnly: false,
      production: true,
    });
    await settle();
    await typeInto(0, 'total', '15');

    confirmAnswer = false;
    await click('edit-save');
    expect(confirms).toHaveLength(1);
    expect(confirms[0]?.operation).toContain('updateOne(');
    expect(confirms[0]?.operation).toContain('$set: {');
    expect(confirms[0]?.operation).toContain('total: 15');
    expect(confirms[0]?.connection).toEqual({ name: 'Prod', production: true });
    // Cancelled: nothing sent, the edits stay.
    expect(updates()).toHaveLength(0);
    expect(text('edit-count')).toBe('1 change');

    confirmAnswer = true;
    await click('doc-save', docItem(0));
    expect(confirms).toHaveLength(2);
    expect(fake.requestsFor('docs.update').at(-1)?.params).toMatchObject({ confirmed: true });
    expect(q('edit-count')).toBeNull();
  });

  it('keeps the edits and reports a conflict when the document changed on the server', async () => {
    fake.fail('docs.update', {
      code: 'CONFLICT',
      message: 'The document changed',
      detail: { current: orderText(1, 99, 1) },
    });
    await typeInto(0, 'total', '15');
    await click('edit-save');
    expect(updates()).toHaveLength(1);
    expect(text('edit-count')).toBe('1 change');
    expect(text('edit-message')).toContain('changed on the server');
    expect(text('doc-conflict', docItem(0))).toBe('Changed on the server');
    expect(input(0, 'total').value).toBe('15');

    // Reverting clears the conflict too.
    await click('doc-revert', docItem(0));
    expect(q('doc-conflict', docItem(0))).toBeNull();
  });

  describe('conflict view', () => {
    /** Edits total of order 1 to 15 and saves into a conflict with server total 99. */
    const conflict = async (current: string | null = orderText(1, 99, 1)) => {
      fake.fail('docs.update', { code: 'CONFLICT', message: 'x', detail: { current } });
      await typeInto(0, 'total', '15');
      await click('edit-save');
      fake.respond('docs.update', { modified: true });
    };
    const rows = () => [...el().querySelectorAll<HTMLElement>('[data-testid="conflict-row"]')];

    it('shows both versions side by side with the differing line highlighted', async () => {
      expect(q('conflict-view')).toBeNull();
      await conflict();
      expect(text('conflict-title')).toBe('Changed on the server since you loaded it');
      expect(text('conflict-count')).toBe('1 differing line');
      const changed = rows().filter((r) => r.dataset['kind'] !== 'same');
      expect(changed).toHaveLength(1);
      expect(text('conflict-local', changed[0])).toContain('total: 15');
      expect(text('conflict-server', changed[0])).toContain('total: 99');
      expect(get('conflict-local', changed[0]).classList).toContain('diff');
      expect(get('conflict-server', changed[0]).classList).toContain('diff');
      const sameRow = rows().find((r) => r.textContent?.includes('qty: 1'));
      expect(sameRow?.dataset['kind']).toBe('same');
    });

    it('Overwrite writes the local version, checked against the new server version', async () => {
      await conflict();
      await click('conflict-overwrite');
      expect(updates().at(-1)).toMatchObject({
        update: '{"$set":{"total":{"$numberInt":"15"}}}',
        expected: '{"total":{"$eq":{"$numberInt":"99"}}}',
      });
      expect(q('conflict-view')).toBeNull();
      expect(q('edit-count')).toBeNull();
    });

    it('Keep server version discards the local edits', async () => {
      fake.respond('docs.get', { doc: orderText(1, 99, 1), sliced: [] });
      await conflict();
      await click('conflict-keep-server');
      expect(updates()).toHaveLength(1);
      expect(q('conflict-view')).toBeNull();
      expect(q('edit-count')).toBeNull();
      expect(input(0, 'total').value).toBe('99');
    });

    it('Merge manually saves the edited merged document', async () => {
      await conflict();
      await click('conflict-merge');
      const area = get<HTMLTextAreaElement>('conflict-merge-text');
      expect(area.value).toContain('total: 15');
      area.value = '{ _id: 1, total: 15, qty: 5 }';
      area.dispatchEvent(new Event('input'));
      await click('conflict-merge-save');
      expect(updates().at(-1)).toMatchObject({
        update: '{"$set":{"total":{"$numberInt":"15"},"qty":{"$numberInt":"5"}}}',
        expected: '{"total":{"$eq":{"$numberInt":"99"}},"qty":{"$eq":{"$numberInt":"1"}}}',
      });
      expect(q('conflict-view')).toBeNull();
    });

    it('Merge manually shows a syntax error and sends nothing', async () => {
      await conflict();
      await click('conflict-merge');
      const area = get<HTMLTextAreaElement>('conflict-merge-text');
      area.value = '{ _id: 1, total: ';
      area.dispatchEvent(new Event('input'));
      await click('conflict-merge-save');
      expect(q('conflict-merge-error')).not.toBeNull();
      expect(updates()).toHaveLength(1);
      await click('conflict-merge-cancel');
      expect(q('conflict-merge-text')).toBeNull();
      expect(q('conflict-view')).not.toBeNull();
    });

    it('offers to insert again or keep it deleted when the server deleted the document', async () => {
      await conflict(null);
      expect(text('conflict-title')).toBe('Deleted on the server since you loaded it');
      expect(q('conflict-merge')).toBeNull();
      expect(text('conflict-overwrite')).toBe('Insert your version again');
      expect(text('conflict-keep-server')).toBe('Keep it deleted');
    });

    it('Insert your version again inserts the local version and closes the view', async () => {
      fake.respond('docs.insert', { insertedIds: ['{"$numberInt":"1"}'] });
      await conflict(null);
      await click('conflict-overwrite');
      expect(fake.requestsFor('docs.insert').map((r: Request) => r.params)).toEqual([
        expect.objectContaining({ docs: [orderText(1, 15, 1)] }),
      ]);
      expect(q('conflict-view')).toBeNull();
      expect(q('edit-count')).toBeNull();
    });

    it('Keep it deleted removes the document from the page', async () => {
      await conflict(null);
      await click('conflict-keep-server');
      expect(q('conflict-view')).toBeNull();
      expect(el().querySelectorAll('[data-testid="result-doc"]')).toHaveLength(2);
      expect(fake.requestsFor('docs.insert')).toHaveLength(0);
    });

    it('asks before Overwrite on a production profile; cancelling keeps the conflict view', async () => {
      await conflict();
      TestBed.inject(ProfileSafetyService).set({
        id: 'p1',
        name: 'Prod',
        readOnly: false,
        production: true,
      });
      await settle();
      confirmAnswer = false;
      await click('conflict-overwrite');
      expect(confirms).toHaveLength(1);
      expect(confirms[0]?.operation).toContain('total: 15');
      expect(updates()).toHaveLength(1);
      expect(q('conflict-view')).not.toBeNull();
      expect(text('edit-count')).toBe('1 change');

      confirmAnswer = true;
      await click('conflict-overwrite');
      expect(confirms).toHaveLength(2);
      expect(fake.requestsFor('docs.update').at(-1)?.params).toMatchObject({
        confirmed: true,
        expected: '{"total":{"$eq":{"$numberInt":"99"}}}',
      });
      expect(q('conflict-view')).toBeNull();
    });

    it('disables Overwrite and Merge on a read-only profile, but not Keep server version', async () => {
      await conflict();
      TestBed.inject(ProfileSafetyService).set({
        id: 'p1',
        name: 'Reports',
        readOnly: true,
        production: false,
      });
      await settle();
      expect(button('conflict-overwrite').disabled).toBe(true);
      expect(button('conflict-overwrite').title).toBe(READ_ONLY_HINT);
      expect(button('conflict-merge').disabled).toBe(true);
      expect(button('conflict-keep-server').disabled).toBe(false);
    });

    it('says when the server already has the local version', async () => {
      await conflict(orderText(1, 15, 1));
      expect(text('conflict-count')).toBe('No differences');
      expect(rows().every((r) => r.dataset['kind'] === 'same')).toBe(true);
    });

    it('shows the local version live as it is edited further', async () => {
      await conflict();
      await typeInto(0, 'qty', '4');
      expect(text('conflict-count')).toBe('2 differing lines');
      const changed = rows().filter((r) => r.dataset['kind'] !== 'same');
      expect(changed.map((r) => text('conflict-local', r))).toEqual(
        expect.arrayContaining([expect.stringContaining('qty: 4')]),
      );
    });

    it('offers only Keep server version once every edit was undone', async () => {
      fake.respond('docs.get', { doc: orderText(1, 99, 1), sliced: [] });
      await conflict();
      await key('z');
      expect(q('edit-count')).toBeNull();
      expect(text('conflict-count')).toBe('No unsaved edits left');
      expect(q('conflict-overwrite')).toBeNull();
      expect(q('conflict-merge')).toBeNull();
      await click('conflict-keep-server');
      expect(q('conflict-view')).toBeNull();
      expect(input(0, 'total').value).toBe('99');
      expect(updates()).toHaveLength(1);
    });

    it('keeps the merge editor open when the merged document changes the _id', async () => {
      await conflict();
      await click('conflict-merge');
      const area = get<HTMLTextAreaElement>('conflict-merge-text');
      area.value = '{ _id: 2, total: 15, qty: 1 }';
      area.dispatchEvent(new Event('input'));
      await click('conflict-merge-save');
      expect(updates()).toHaveLength(1);
      expect(text('edit-message')).toMatch(/must keep the _id/);
      expect(q('conflict-merge-text')).not.toBeNull();
    });

    it('shows the newer server version when the merged save conflicts again', async () => {
      await conflict();
      await click('conflict-merge');
      fake.fail('docs.update', {
        code: 'CONFLICT',
        message: 'x',
        detail: { current: orderText(1, 123, 1) },
      });
      await click('conflict-merge-save');
      expect(updates()).toHaveLength(2);
      expect(q('conflict-merge-text')).not.toBeNull();
      const changed = rows().filter((r) => r.dataset['kind'] !== 'same');
      expect(text('conflict-server', changed[0])).toContain('total: 123');
    });

    describe('when the conflict being merged goes away or changes (CR-7)', () => {
      /** Opens the merge editor and types `text` into it. */
      const startMerge = async (text: string) => {
        await click('conflict-merge');
        const area = get<HTMLTextAreaElement>('conflict-merge-text');
        area.value = text;
        area.dispatchEvent(new Event('input'));
        await settle();
      };
      /** The conflict view offers the three resolutions, not the merge editor. */
      const expectResolutions = () => {
        expect(q('conflict-merge-text')).toBeNull();
        expect(q('conflict-merge-cancel')).toBeNull();
        expect(q('conflict-merge-save')).toBeNull();
        expect(q('conflict-keep-server')).not.toBeNull();
        expect(q('conflict-overwrite')).not.toBeNull();
        expect(q('conflict-merge')).not.toBeNull();
      };
      /** Edits total of order 1 to `total` and saves into a conflict with server total 99. */
      const conflictAgain = async (total: string) => {
        fake.fail('docs.update', {
          code: 'CONFLICT',
          message: 'x',
          detail: { current: orderText(1, 99, 1) },
        });
        await typeInto(0, 'total', total);
        await click('edit-save');
        fake.respond('docs.update', { modified: true });
      };

      it('closes on a revert from the document header; a later conflict starts afresh', async () => {
        await conflict();
        await startMerge('{ _id: 1, total: 15, qty: 77 }');
        await click('doc-revert', docItem(0));
        expect(q('conflict-view')).toBeNull();

        await conflictAgain('16');
        expect(q('conflict-view')).not.toBeNull();
        expectResolutions();
        await click('conflict-merge');
        const area = get<HTMLTextAreaElement>('conflict-merge-text');
        expect(area.value).toContain('total: 16');
        expect(area.value).not.toContain('qty: 77');
        expect(q('conflict-merge-error')).toBeNull();
      });

      it('closes on Revert all from the edit bar', async () => {
        await conflict();
        await startMerge('{ _id: 1, total: 15, qty: 77 }');
        await click('edit-revert');
        expect(q('conflict-view')).toBeNull();

        await conflictAgain('17');
        expectResolutions();
        await click('conflict-merge');
        expect(get<HTMLTextAreaElement>('conflict-merge-text').value).toContain('total: 17');
      });

      it('closes when a save from the edit bar succeeds', async () => {
        await conflict();
        await startMerge('{ _id: 1, total: 15, qty: 77 }');
        await click('edit-save');
        expect(updates()).toHaveLength(2);
        expect(q('conflict-view')).toBeNull();
        expect(q('edit-count')).toBeNull();

        await conflictAgain('18');
        expectResolutions();
        await click('conflict-merge');
        const area = get<HTMLTextAreaElement>('conflict-merge-text');
        expect(area.value).toContain('total: 18');
        expect(area.value).not.toContain('qty: 77');
      });

      it('closes when Save merged finds the document deleted, offering the deleted actions', async () => {
        await conflict();
        await startMerge('{ _id: 1, total: 15, qty: 77 }');
        fake.fail('docs.update', { code: 'CONFLICT', message: 'x', detail: { current: null } });
        await click('conflict-merge-save');
        expect(updates()).toHaveLength(2);
        expect(text('conflict-title')).toBe('Deleted on the server since you loaded it');
        expect(q('conflict-merge-text')).toBeNull();
        expect(q('conflict-merge-save')).toBeNull();
        expect(q('conflict-merge-cancel')).toBeNull();
        expect(text('conflict-keep-server')).toBe('Keep it deleted');
        expect(q('conflict-merge')).toBeNull();
      });

      it('stays closed when the deleted conflict changes in place to a readable version', async () => {
        // The conflict entry is replaced, not removed: only the closing effect clears the merge.
        await conflict();
        await startMerge('{ _id: 1, total: 15, qty: 77 }');
        fake.fail('docs.update', { code: 'CONFLICT', message: 'x', detail: { current: null } });
        await click('conflict-merge-save');
        expect(text('conflict-title')).toBe('Deleted on the server since you loaded it');

        await conflictAgain('19');
        expect(updates()).toHaveLength(3);
        expect(text('conflict-title')).toBe('Changed on the server since you loaded it');
        expectResolutions();
        await click('conflict-merge');
        const area = get<HTMLTextAreaElement>('conflict-merge-text');
        expect(area.value).toContain('total: 19');
        expect(area.value).not.toContain('qty: 77');
      });

      it('closes when Save merged finds a server version it cannot read', async () => {
        await conflict();
        await startMerge('{ _id: 1, total: 15, qty: 77 }');
        fake.fail('docs.get', { code: 'SERVER_ERROR', message: 'connection reset' });
        fake.fail('docs.update', { code: 'CONFLICT', message: 'x', detail: { current: 42 } });
        await click('conflict-merge-save');
        expect(updates()).toHaveLength(2);
        expect(text('conflict-title')).toMatch(/could not be read/);
        expect(q('conflict-merge-text')).toBeNull();
        expect(q('conflict-merge-save')).toBeNull();
        expect(text('conflict-keep-server')).toBe('Keep server version');
      });

      it('does not show an earlier merge syntax error on a later conflict', async () => {
        await conflict();
        await startMerge('{ _id: 1, total: ');
        await click('conflict-merge-save');
        expect(q('conflict-merge-error')).not.toBeNull();
        expect(updates()).toHaveLength(1);
        await click('doc-revert', docItem(0));
        expect(q('conflict-view')).toBeNull();

        await conflictAgain('19');
        expectResolutions();
        await click('conflict-merge');
        expect(q('conflict-merge-error')).toBeNull();
        const area = get<HTMLTextAreaElement>('conflict-merge-text');
        expect(area.getAttribute('aria-invalid')).toBeNull();
        expect(area.value).toContain('total: 19');
        expect(area.value).not.toBe('{ _id: 1, total: ');
      });

      describe('with a second conflict on another document', () => {
        const ID1 = '{"$numberInt":"1"}';
        const ID2 = '{"$numberInt":"2"}';
        const section = (id: string) => {
          const found = el().querySelector<HTMLElement>(
            `[data-testid="conflict-view"][data-key='${id}']`,
          );
          if (found === null) throw new Error(`no conflict view for ${id}`);
          return found;
        };
        const merged = '{ _id: 1, total: 15, qty: 77 }';

        /** Conflicts on order 1 (server total 99) and order 2 (server total 98), merging order 1. */
        const twoConflictsMergingFirst = async () => {
          fake.handle('docs.update', (params) => {
            const id = (params as { id: string }).id;
            const current = id === ID1 ? orderText(1, 99, 1) : orderText(2, 98, 2);
            throw new ApiError({ code: 'CONFLICT', message: 'x', detail: { current } });
          });
          await typeInto(0, 'total', '15');
          await typeInto(1, 'total', '25');
          await click('edit-save');
          await click('doc-save', docItem(1));
          fake.respond('docs.update', { modified: true });
          expect(
            [...el().querySelectorAll<HTMLElement>('[data-testid="conflict-view"]')].map(
              (v) => v.dataset['key'],
            ),
          ).toEqual([ID1, ID2]);
          await click('conflict-merge', section(ID1));
          const area = get<HTMLTextAreaElement>('conflict-merge-text', section(ID1));
          area.value = merged;
          area.dispatchEvent(new Event('input'));
          await settle();
        };
        /** The merge editor of order 1 is still open with the typed text and saves it. */
        const expectMergeKeptAndSaves = async () => {
          expect(el().querySelectorAll('[data-testid="conflict-view"]')).toHaveLength(1);
          expect(get<HTMLTextAreaElement>('conflict-merge-text', section(ID1)).value).toBe(merged);
          expect(q('conflict-merge-save', section(ID1))).not.toBeNull();
          await click('conflict-merge-save', section(ID1));
          expect(updates().at(-1)).toMatchObject({
            id: ID1,
            update: '{"$set":{"total":{"$numberInt":"15"},"qty":{"$numberInt":"77"}}}',
            expected: '{"total":{"$eq":{"$numberInt":"99"}},"qty":{"$eq":{"$numberInt":"1"}}}',
          });
          expect(q('conflict-view')).toBeNull();
        };

        it('keeps the open editor and its text when the other document is reverted', async () => {
          await twoConflictsMergingFirst();
          await click('doc-revert', docItem(1));
          await expectMergeKeptAndSaves();
        });

        it('keeps the open editor and its text when the other conflict keeps the server version', async () => {
          await twoConflictsMergingFirst();
          fake.respond('docs.get', { doc: orderText(2, 98, 2), sliced: [] });
          await click('conflict-keep-server', section(ID2));
          expect(input(1, 'total').value).toBe('98');
          await expectMergeKeptAndSaves();
        });

        it('keeps the open editor and its text when the other conflict is overwritten', async () => {
          await twoConflictsMergingFirst();
          await click('conflict-overwrite', section(ID2));
          expect(updates().at(-1)).toMatchObject({ id: ID2 });
          await expectMergeKeptAndSaves();
        });

        it('keeps the open editor when the other conflict finds its document deleted', async () => {
          await twoConflictsMergingFirst();
          fake.fail('docs.update', { code: 'CONFLICT', message: 'x', detail: { current: null } });
          await click('conflict-overwrite', section(ID2));
          fake.respond('docs.update', { modified: true });
          expect(text('conflict-title', section(ID2))).toBe(
            'Deleted on the server since you loaded it',
          );
          expect(get<HTMLTextAreaElement>('conflict-merge-text', section(ID1)).value).toBe(merged);
          await click('conflict-keep-server', section(ID2));
          await expectMergeKeptAndSaves();
        });
      });
    });

    it('lists one conflict view per conflicting document', async () => {
      fake.fail('docs.update', {
        code: 'CONFLICT',
        message: 'x',
        detail: { current: orderText(1, 99, 1) },
      });
      await typeInto(0, 'total', '15');
      await typeInto(1, 'total', '25');
      await click('edit-save');
      await click('doc-save', docItem(1));
      const views = el().querySelectorAll<HTMLElement>('[data-testid="conflict-view"]');
      expect([...views].map((v) => v.dataset['key'])).toEqual([
        '{"$numberInt":"1"}',
        '{"$numberInt":"2"}',
      ]);
    });

    it('with a projection compares only the loaded fields and says so', async () => {
      const projection = get<HTMLInputElement>('query-projection');
      projection.value = '{ total: 1, qty: 1 }';
      projection.dispatchEvent(new Event('input'));
      await click('query-run');
      expect(fake.requestsFor('docs.find').at(-1)?.params).toMatchObject({
        projection: '{"total":{"$numberInt":"1"},"qty":{"$numberInt":"1"}}',
      });
      // The server version has a field the projection hid: it is neither shown nor unset.
      await conflict(
        '{"_id":{"$numberInt":"1"},"total":{"$numberInt":"99"},"qty":{"$numberInt":"1"},"secret":"hidden-by-projection"}',
      );
      expect(el().textContent).toContain('Only the fields loaded with the query');
      expect(get('conflict-view').textContent).not.toContain('hidden-by-projection');
      expect(text('conflict-count')).toBe('1 differing line');
      await click('conflict-overwrite');
      expect(updates().at(-1)).toMatchObject({
        update: '{"$set":{"total":{"$numberInt":"15"}}}',
        expected: '{"total":{"$eq":{"$numberInt":"99"}}}',
      });
    });

    // TW-1: a CONFLICT whose detail cannot be read is not a deletion.
    it('does not claim the document was deleted when the conflict detail is malformed', async () => {
      fake.fail('docs.update', { code: 'CONFLICT', message: 'x', detail: { current: 42 } });
      await typeInto(0, 'total', '15');
      await click('edit-save');
      expect(text('edit-message')).toContain('changed on the server');
      expect(q('conflict-view')).not.toBeNull();
      expect(text('conflict-title')).not.toBe('Deleted on the server since you loaded it');
      expect(q('conflict-overwrite')?.textContent?.trim()).not.toBe('Insert your version again');
    });

    it('reads the server version again for a malformed conflict detail and shows it', async () => {
      fake.respond('docs.get', { doc: orderText(1, 99, 1), sliced: [] });
      fake.fail('docs.update', { code: 'CONFLICT', message: 'x', detail: { current: 42 } });
      await typeInto(0, 'total', '15');
      await click('edit-save');
      expect(text('conflict-title')).toBe('Changed on the server since you loaded it');
      const changed = rows().filter((r) => r.dataset['kind'] !== 'same');
      expect(text('conflict-server', changed[0])).toContain('total: 99');
      expect(q('conflict-overwrite')).not.toBeNull();
    });

    it('offers only Keep server version when the server version cannot be read', async () => {
      fake.fail('docs.get', { code: 'SERVER_ERROR', message: 'connection reset' });
      fake.fail('docs.update', { code: 'CONFLICT', message: 'x', detail: { current: 42 } });
      await typeInto(0, 'total', '15');
      await click('edit-save');
      expect(text('conflict-title')).toBe(
        'Changed on the server; its current version could not be read',
      );
      expect(rows()).toHaveLength(0);
      expect(q('conflict-overwrite')).toBeNull();
      expect(q('conflict-merge')).toBeNull();
      expect(text('conflict-keep-server')).toBe('Keep server version');
      await click('conflict-keep-server');
      expect(q('conflict-view')).toBeNull();
      // The document stays on the page as loaded.
      expect(el().querySelectorAll('[data-testid="result-doc"]')).toHaveLength(3);
      expect(input(0, 'total').value).toBe('10');
    });

    it('hides Overwrite and Merge under a projection of parts of fields, and says why', async () => {
      const projection = get<HTMLInputElement>('query-projection');
      projection.value = '{ total: 1, qty: 1, "addr.city": 1 }';
      projection.dispatchEvent(new Event('input'));
      await click('query-run');
      await conflict();
      expect(text('conflict-note')).toMatch(/^Overwrite and Merge manually are not available/);
      expect(text('conflict-note')).toContain('clear the projection, run the query again');
      expect(q('conflict-overwrite')).toBeNull();
      expect(q('conflict-merge')).toBeNull();
      expect(button('conflict-keep-server').disabled).toBe(false);
      expect(updates()).toHaveLength(1);
    });

    it('hides Overwrite and Merge for a document edited under a projection cleared since', async () => {
      const projection = get<HTMLInputElement>('query-projection');
      projection.value = '{ total: 1, qty: 1 }';
      projection.dispatchEvent(new Event('input'));
      await click('query-run');
      await typeInto(0, 'total', '15');
      // The projection is cleared and the query run again; the unsaved edit survives.
      projection.value = '';
      projection.dispatchEvent(new Event('input'));
      await click('query-run');
      expect(fake.requestsFor('docs.find').at(-1)?.params).not.toHaveProperty('projection');
      expect(text('edit-count')).toBe('1 change');
      fake.fail('docs.update', {
        code: 'CONFLICT',
        message: 'x',
        detail: { current: orderText(1, 99, 1) },
      });
      await click('edit-save');
      expect(text('conflict-title')).toBe('Changed on the server since you loaded it');
      expect(text('conflict-note')).toMatch(/^Overwrite and Merge manually are not available/);
      expect(q('conflict-overwrite')).toBeNull();
      expect(q('conflict-merge')).toBeNull();
      expect(button('conflict-keep-server').disabled).toBe(false);
    });

    // TW-2 through the UI: edited under a dotted projection, then a top-level projection is run.
    it('never unsets a sub-field hidden when the document was edited, after a top-level projection is run', async () => {
      const withAddr = (total: number, addr: string) =>
        `{"_id":{"$numberInt":"1"},"total":{"$numberInt":"${total}"},"addr":${addr}}`;
      let page = withAddr(10, '{"city":"Bonn"}');
      let streams = 100;
      fake.handle('docs.find', () => {
        const id = `s${++streams}`;
        setTimeout(() => {
          fake.data('docs.find', id, { docs: [page] });
          fake.end(id, { delivered: 1 });
        });
        return { streamId: id };
      });
      const projection = get<HTMLInputElement>('query-projection');
      projection.value = '{ total: 1, "addr.city": 1 }';
      projection.dispatchEvent(new Event('input'));
      await click('query-run');
      await typeInto(0, 'total', '15');
      // A top-level projection: the server now returns the whole addr; the unsaved edit stays.
      page = withAddr(10, '{"city":"Bonn","street":"Hauptstr. 1"}');
      projection.value = '{ total: 1, addr: 1 }';
      projection.dispatchEvent(new Event('input'));
      await click('query-run');
      expect(text('edit-count')).toBe('1 change');
      fake.fail('docs.update', {
        code: 'CONFLICT',
        message: 'x',
        detail: { current: withAddr(99, '{"city":"Bonn","street":"Hauptstr. 1"}') },
      });
      await click('edit-save');
      fake.respond('docs.update', { modified: true });
      expect(text('conflict-title')).toBe('Changed on the server since you loaded it');
      const overwrite = q<HTMLButtonElement>('conflict-overwrite');
      if (overwrite !== null) {
        overwrite.click();
        await settle();
      }
      // Either Overwrite is not offered, or it leaves addr.street alone.
      for (const update of updates().slice(1)) {
        expect(String(update['update'])).not.toContain('street');
      }
    });

    // TW-2 fix: the edit remembers that its projection hid parts of fields.
    it('hides Overwrite and Merge for a document edited under a dotted projection, after a top-level one is run', async () => {
      const withAddr = (total: number, addr: string) =>
        `{"_id":{"$numberInt":"1"},"total":{"$numberInt":"${total}"},"addr":${addr}}`;
      let page = withAddr(10, '{"city":"Bonn"}');
      let streams = 200;
      fake.handle('docs.find', () => {
        const id = `s${++streams}`;
        setTimeout(() => {
          fake.data('docs.find', id, { docs: [page] });
          fake.end(id, { delivered: 1 });
        });
        return { streamId: id };
      });
      const projection = get<HTMLInputElement>('query-projection');
      projection.value = '{ total: 1, "addr.city": 1 }';
      projection.dispatchEvent(new Event('input'));
      await click('query-run');
      await typeInto(0, 'total', '15');
      page = withAddr(10, '{"city":"Bonn","street":"Hauptstr. 1"}');
      projection.value = '{ total: 1, addr: 1 }';
      projection.dispatchEvent(new Event('input'));
      await click('query-run');
      fake.fail('docs.update', {
        code: 'CONFLICT',
        message: 'x',
        detail: { current: withAddr(99, '{"city":"Bonn","street":"Hauptstr. 1"}') },
      });
      await click('edit-save');
      expect(text('conflict-title')).toBe('Changed on the server since you loaded it');
      expect(q('conflict-overwrite')).toBeNull();
      expect(q('conflict-merge')).toBeNull();
      expect(q('conflict-keep-server')).not.toBeNull();
    });

    // Round 3: the flag from a tree edit under a dotted projection survives undo/redo and a later
    // edit under a top-level projection.
    it('keeps Overwrite and Merge hidden after undo, redo and a further edit under a top-level projection', async () => {
      const withAddr = (total: number, addr: string) =>
        `{"_id":{"$numberInt":"1"},"total":{"$numberInt":"${total}"},"addr":${addr}}`;
      let page = withAddr(10, '{"city":"Bonn"}');
      let streams = 300;
      fake.handle('docs.find', () => {
        const id = `s${++streams}`;
        setTimeout(() => {
          fake.data('docs.find', id, { docs: [page] });
          fake.end(id, { delivered: 1 });
        });
        return { streamId: id };
      });
      const projection = get<HTMLInputElement>('query-projection');
      projection.value = '{ total: 1, "addr.city": 1 }';
      projection.dispatchEvent(new Event('input'));
      await click('query-run');
      await typeInto(0, 'total', '15');
      page = withAddr(10, '{"city":"Bonn","street":"Hauptstr. 1"}');
      projection.value = '{ total: 1, addr: 1 }';
      projection.dispatchEvent(new Event('input'));
      await click('query-run');
      await typeInto(0, 'total', '16');
      expect(text('edit-count')).toBe('1 change');
      // Undo both edits (the document is no longer modified), then redo the first one.
      await click('edit-undo');
      await click('edit-undo');
      expect(q('edit-count')).toBeNull();
      await click('edit-redo');
      expect(text('edit-count')).toBe('1 change');
      fake.fail('docs.update', {
        code: 'CONFLICT',
        message: 'x',
        detail: { current: withAddr(99, '{"city":"Bonn","street":"Hauptstr. 1"}') },
      });
      await click('edit-save');
      fake.respond('docs.update', { modified: true });
      expect(text('conflict-title')).toBe('Changed on the server since you loaded it');
      expect(text('conflict-note')).toMatch(/^Overwrite and Merge manually are not available/);
      expect(q('conflict-overwrite')).toBeNull();
      expect(q('conflict-merge')).toBeNull();
      expect(updates()).toHaveLength(1);
    });

    it('offers Overwrite for a document edited under a top-level projection, and writes it', async () => {
      const projection = get<HTMLInputElement>('query-projection');
      projection.value = '{ total: 1, qty: 1 }';
      projection.dispatchEvent(new Event('input'));
      await click('query-run');
      await conflict();
      expect(q('conflict-note')?.textContent ?? '').not.toMatch(/not available/);
      await click('conflict-overwrite');
      expect(updates().at(-1)).toMatchObject({
        update: '{"$set":{"total":{"$numberInt":"15"}}}',
        expected: '{"total":{"$eq":{"$numberInt":"99"}}}',
      });
      expect(q('conflict-view')).toBeNull();
    });

    // Round 4 (TW-3 fix): under a top-level projection addr is loaded whole, so a sub-field the
    // server added to it is a server change the user is shown; Overwrite/Merge write the local
    // version and unset it.
    describe('under a top-level projection, with a sub-field the server added to a loaded field', () => {
      const withAddr = (total: number, addr: string) =>
        `{"_id":{"$numberInt":"1"},"total":{"$numberInt":"${total}"},"addr":${addr}}`;
      const serverAddr = '{"city":"Bonn","street":"Hauptstr. 1"}';

      beforeEach(async () => {
        let streams = 400;
        fake.handle('docs.find', () => {
          const id = `s${++streams}`;
          setTimeout(() => {
            fake.data('docs.find', id, { docs: [withAddr(10, '{"city":"Bonn"}')] });
            fake.end(id, { delivered: 1 });
          });
          return { streamId: id };
        });
        fake.respond('docs.get', { doc: withAddr(15, '{"city":"Bonn"}'), sliced: [] });
        const projection = get<HTMLInputElement>('query-projection');
        projection.value = '{ total: 1, addr: 1 }';
        projection.dispatchEvent(new Event('input'));
        await click('query-run');
        fake.fail('docs.update', {
          code: 'CONFLICT',
          message: 'x',
          detail: { current: withAddr(99, serverAddr) },
        });
        await typeInto(0, 'total', '15');
        await click('edit-save');
        fake.respond('docs.update', { modified: true });
      });

      it('shows the added sub-field on the server side and offers Overwrite and Merge', () => {
        expect(text('conflict-title')).toBe('Changed on the server since you loaded it');
        const server = rows()
          .map((r) => text('conflict-server', r))
          .join('\n');
        expect(server).toMatch(/street: ['"]Hauptstr\. 1['"]/);
        expect(text('conflict-note')).toMatch(
          /^Only the fields loaded with the query's projection/,
        );
        expect(text('conflict-note')).not.toMatch(/not available/);
        expect(q('conflict-overwrite')).not.toBeNull();
        expect(q('conflict-merge')).not.toBeNull();
      });

      it('Overwrite writes the local version and unsets the sub-field', async () => {
        await click('conflict-overwrite');
        expect(updates()).toHaveLength(2);
        const update = updates()[1];
        expect(update?.['update']).toBe(
          '{"$set":{"total":{"$numberInt":"15"}},"$unset":{"addr.street":""}}',
        );
        expect(String(update?.['expected'])).toContain('"total":{"$eq":{"$numberInt":"99"}}');
        expect(fake.requestsFor('docs.replace')).toHaveLength(0);
        expect(q('conflict-view')).toBeNull();
        expect(q('edit-count')).toBeNull();
        expect(text('edit-message')).not.toMatch(/projection|Not saved/);
      });

      it('Merge manually saves the merged text and unsets what it leaves out', async () => {
        await click('conflict-merge');
        const area = get<HTMLTextAreaElement>('conflict-merge-text');
        expect(area.value).not.toContain('street');
        await click('conflict-merge-save');
        expect(updates()).toHaveLength(2);
        expect(updates()[1]?.['update']).toBe(
          '{"$set":{"total":{"$numberInt":"15"}},"$unset":{"addr.street":""}}',
        );
        expect(q('conflict-view')).toBeNull();
        expect(text('edit-message')).not.toMatch(/projection|Not saved/);
      });

      it('Merge manually keeps a server sub-field the user types into the merge', async () => {
        await click('conflict-merge');
        const area = get<HTMLTextAreaElement>('conflict-merge-text');
        area.value = `{ _id: 1, total: 15, addr: { city: 'Bonn', street: 'Hauptstr. 1' } }`;
        area.dispatchEvent(new Event('input'));
        await settle();
        await click('conflict-merge-save');
        expect(updates()).toHaveLength(2);
        expect(updates()[1]?.['update']).toBe('{"$set":{"total":{"$numberInt":"15"}}}');
        expect(q('conflict-view')).toBeNull();
      });
    });

    it('with a projection shows the whole server version once every edit was undone', async () => {
      const projection = get<HTMLInputElement>('query-projection');
      projection.value = '{ total: 1, qty: 1 }';
      projection.dispatchEvent(new Event('input'));
      await click('query-run');
      await conflict(
        '{"_id":{"$numberInt":"1"},"total":{"$numberInt":"99"},"qty":{"$numberInt":"1"},"note":"n"}',
      );
      await key('z');
      expect(text('conflict-count')).toBe('No unsaved edits left');
      const server = rows()
        .map((r) => text('conflict-server', r))
        .join('\n');
      expect(server).toContain('total: 99');
      expect(server).toMatch(/note: ['"]n['"]/);
      expect(q('conflict-note')).toBeNull();
    });

    it('gives the merge editor an id unique to the tab, and its label points to it', async () => {
      await conflict();
      await click('conflict-merge');
      const area = get<HTMLTextAreaElement>('conflict-merge-text');
      expect(area.id).toMatch(/^coll-view-\d+-conflicts-merge-0$/);
      const label = el().querySelector<HTMLLabelElement>('.merge-label');
      expect(label?.htmlFor).toBe(area.id);
    });

    it('tells screen readers which lines differ and on which side', async () => {
      await conflict();
      await typeInto(0, 'qty', '4');
      const changed = rows().filter((r) => r.dataset['kind'] === 'changed');
      const srText = (cell: string, row: HTMLElement) =>
        get(cell, row).querySelector('.sr-only')?.textContent ?? null;
      expect(changed.length).toBeGreaterThan(0);
      for (const row of changed) {
        expect(srText('conflict-local', row)).toBe('Changed: ');
        expect(srText('conflict-server', row)).toBe('Changed: ');
      }
      const same = rows().filter((r) => r.dataset['kind'] === 'same');
      expect(same.every((r) => r.querySelector('.sr-only') === null)).toBe(true);
    });

    it('labels lines only one side has for screen readers', async () => {
      await conflict(
        '{"_id":{"$numberInt":"1"},"total":{"$numberInt":"10"},"qty":{"$numberInt":"1"},"note":"n"}',
      );
      const serverOnly = rows().find((r) => r.dataset['kind'] === 'right');
      expect(serverOnly).toBeDefined();
      expect(
        get('conflict-server', serverOnly as HTMLElement).querySelector('.sr-only')?.textContent,
      ).toBe('Only on the server: ');
      expect(get('conflict-local', serverOnly as HTMLElement).querySelector('.sr-only')).toBeNull();
    });
  });

  it('reports other save errors and keeps the edits', async () => {
    fake.fail('docs.update', { code: 'SERVER_ERROR', message: 'Document failed validation' });
    await typeInto(0, 'total', '15');
    await click('edit-save');
    expect(text('edit-message')).toContain('Document failed validation');
    expect(text('edit-count')).toBe('1 change');
  });

  it('inserts an empty document with a new ObjectId', async () => {
    fake.respond('docs.insert', { insertedIds: ['{"$oid":"0123456789abcdef01234567"}'] });
    await click('doc-insert');
    expect(el().querySelectorAll('[data-testid="draft"]')).toHaveLength(1);
    await click('draft-insert');
    const params = fake.requestsFor('docs.insert').at(-1)?.params as { docs: string[] };
    expect(params.docs).toHaveLength(1);
    expect(params.docs[0]).toMatch(/^\{"_id":\{"\$oid":"[0-9a-f]{24}"\}\}$/);
    expect(q('draft')).toBeNull();
    expect(text('edit-message')).toContain('Inserted ObjectId("0123456789abcdef01234567")');
  });

  it('clones a document as shown, with a new _id; a draft can be discarded', async () => {
    fake.respond('docs.insert', { insertedIds: ['{"$oid":"0123456789abcdef01234567"}'] });
    await typeInto(1, 'qty', '7');
    await click('doc-clone', docItem(1));
    expect(text('drafts')).toContain('Copy of 2');
    await click('draft-insert');
    const sent = (fake.requestsFor('docs.insert').at(-1)?.params as { docs: string[] }).docs[0];
    expect(sent).toMatch(
      /^\{"_id":\{"\$oid":"[0-9a-f]{24}"\},"total":\{"\$numberInt":"20"\},"qty":\{"\$numberInt":"7"\}\}$/,
    );
    // The original keeps its own unsaved edit.
    expect(text('edit-count')).toBe('1 change');

    await click('doc-insert');
    await click('draft-discard');
    expect(q('draft')).toBeNull();
    expect(fake.requestsFor('docs.insert')).toHaveLength(1);
  });

  it('deletes a document only after the confirm dialog', async () => {
    fake.respond('docs.delete', { deleted: true });
    confirmAnswer = false;
    await click('doc-delete', docItem(1));
    expect(confirms[0]?.operation).toContain('deleteOne({ _id: 2 })');
    expect(confirms[0]?.destructive).toBe(true);
    expect(fake.requestsFor('docs.delete')).toHaveLength(0);
    expect(el().querySelectorAll('[data-testid="result-doc"]')).toHaveLength(3);

    confirmAnswer = true;
    await click('doc-delete', docItem(1));
    expect(fake.requestsFor('docs.delete').at(-1)?.params).toMatchObject({
      id: '{"$numberInt":"2"}',
      confirmed: true,
    });
    expect(el().querySelectorAll('[data-testid="result-doc"]')).toHaveLength(2);
    expect(text('edit-message')).toBe('Deleted 2.');
  });

  it('disables every edit control on a read-only profile', async () => {
    await typeInto(0, 'total', '15');
    TestBed.inject(ProfileSafetyService).set({
      id: 'p1',
      name: 'Reports',
      readOnly: true,
      production: false,
    });
    await settle();
    for (const id of ['edit-mode', 'doc-insert', 'edit-save']) {
      expect(button(id).disabled, id).toBe(true);
      expect(button(id).title, id).toBe(READ_ONLY_HINT);
    }
    for (const id of ['doc-save', 'doc-clone', 'doc-delete']) {
      expect(button(id, docItem(0)).disabled, id).toBe(true);
    }
    // The explorer leaves edit mode and shows no inputs; its own toggle says read-only.
    const viewEditMode = fixture.debugElement.injector.get(EditModeService);
    expect(viewEditMode).not.toBe(TestBed.inject(EditModeService));
    expect(viewEditMode.enabled()).toBe(false);
    expect(docItem(0).querySelector('app-bson-input input')).toBeNull();
    await click('view-table');
    const toggle = el().querySelector<HTMLButtonElement>('.mode-toggle');
    expect(toggle?.disabled).toBe(true);
    expect(toggle?.textContent?.trim()).toBe('Read-only');
    // Ctrl+S does not save.
    await key('s');
    expect(updates()).toHaveLength(0);
  });
});
