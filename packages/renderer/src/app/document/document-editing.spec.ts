import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { Request } from '@thicket/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
