import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { parseEJsonDocument } from '@thicket/core/bson';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../api';
import { FakeThicketBridge, provideFakeThicket } from '../../api/testing';
import { DocumentEdits } from '../../document';
import { EditModeService } from '../../explorer/services/edit-mode.service';
import { NestedPageSizeService } from '../../explorer/services/nested-page-size.service';
import { NumberDefaultService } from '../../explorer/services/number-default.service';
import type { WorkspaceTab } from '../../layout/workspace.service';
import { ConfirmService, type ConfirmRequest } from '../../safety/confirm.service';
import { ProfileSafetyService } from '../../safety/profile-safety.service';
import { CollectionView } from '../collection-view';

const TAB: WorkspaceTab = {
  id: 'p1/shop.orders',
  kind: 'collection',
  title: 'orders',
  data: { profileId: 'p1', db: 'shop', coll: 'orders', type: 'collection' },
};

/** `{_id, status, address: {city}}` as canonical EJSON (a nested document gets its own table). */
const orderText = (id: number, status = 'open') =>
  `{"_id":{"$numberInt":"${id}"},"status":"${status}","address":{"city":"Gent"}}`;
const keyOf = (id: number) => `{"$numberInt":"${id}"}`;

/** Text with the narrow no-break spaces of `formatCount` as plain spaces. */
const text = (el: Element | null): string => (el?.textContent ?? '').split(NNBSP).join(' ').trim();
/** The thousands separator of `formatCount`. */
const NNBSP = ' ';

// Row selection in the collection tab's table and the "edit a field across rows" panel, through
// the real CollectionView, explorer table, MultiEdit and WriteGuard (the confirm is answered by a
// spy, the backend is the fake bridge).
describe('Edit a field across selected rows (collection view)', () => {
  let fake: FakeThicketBridge;
  let fixture: ComponentFixture<CollectionView>;
  let confirms: ConfirmRequest[];
  let confirmAnswer: boolean;
  /** Ids of the page `docs.find` answers next. */
  let page: number[];

  const el = () => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(id: string) =>
    el().querySelector<T>(`[data-testid="${id}"]`);
  const get = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const found = q<T>(id);
    if (found === null) throw new Error(`no element ${id}`);
    return found;
  };
  const all = <T extends HTMLElement = HTMLElement>(id: string) => [
    ...el().querySelectorAll<T>(`[data-testid="${id}"]`),
  ];
  const settle = async () => {
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
  };
  const rowBoxes = () => all<HTMLInputElement>('row-select');
  const selectAll = () => get<HTMLInputElement>('row-select-all');
  const check = async (box: HTMLInputElement | undefined, on = true) => {
    if (!box) throw new Error('no checkbox');
    box.checked = on;
    box.dispatchEvent(new Event('change'));
    await settle();
  };
  const type = async (id: string, value: string) => {
    const input = get<HTMLInputElement>(id);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  };
  const choose = async (id: string, value: string) => {
    const select = get<HTMLSelectElement>(id);
    select.value = value;
    select.dispatchEvent(new Event('change'));
    await settle();
  };
  const save = async () => {
    get('multi-edit-save').click();
    await settle();
  };
  const updates = () =>
    fake.requestsFor('docs.update').map((r) => r.params as Record<string, unknown>);
  /** Edit mode of this collection tab (each tab provides its own). */
  const editMode = () => fixture.debugElement.injector.get(EditModeService);

  beforeEach(async () => {
    fake = new FakeThicketBridge();
    let streams = 0;
    page = [1, 2, 3];
    fake.handle('docs.find', () => {
      const id = `s${++streams}`;
      const docs = page.map((i) => orderText(i));
      setTimeout(() => {
        fake.data('docs.find', id, { docs });
        fake.end(id, { delivered: docs.length });
      });
      return { streamId: id };
    });
    fake.respond('docs.estimatedCount', { count: 3 });
    fake.respond('docs.update', { modified: true });
    fake.handle('docs.get', (p) => ({
      doc: orderText(Number((JSON.parse(p.id) as { $numberInt: string }).$numberInt), 'server'),
      sliced: [],
    }));
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
  });

  afterEach(() => {
    editMode().reset();
    vi.restoreAllMocks();
  });

  const enterEditMode = async () => {
    editMode().toggle();
    await settle();
  };

  it('has no checkbox column outside edit mode', () => {
    expect(rowBoxes()).toHaveLength(0);
    expect(q('row-select-all')).toBeNull();
    expect(q('multi-edit')).toBeNull();
  });

  it('in edit mode the root table (only) gets one checkbox per document row', async () => {
    await enterEditMode();
    // 3 documents, each with a nested document: the nested tables get no checkboxes.
    expect(rowBoxes()).toHaveLength(3);
    expect(rowBoxes().map((b) => b.getAttribute('aria-label'))).toEqual([
      'Select row 1',
      'Select row 2',
      'Select row 3',
    ]);
    expect(selectAll().getAttribute('aria-label')).toBe('Select all rows');
    expect(q('multi-edit')).toBeNull();
  });

  it('selecting rows marks them, shows the panel with the count, and select-all is mixed', async () => {
    await enterEditMode();
    await check(rowBoxes()[0]);
    await check(rowBoxes()[2]);
    expect(text(get('multi-edit-count'))).toBe('2 rows selected');
    expect(text(get('multi-edit-save'))).toBe('Save 2 documents');
    const rows = [...el().querySelectorAll('tr')].filter((r) =>
      r.querySelector('[data-testid="row-select"]'),
    );
    expect(rows.map((r) => r.classList.contains('selected'))).toEqual([true, false, true]);
    expect(selectAll().indeterminate).toBe(true);
    expect(selectAll().checked).toBe(false);

    await check(selectAll());
    expect(rowBoxes().every((b) => b.checked)).toBe(true);
    expect(selectAll().checked).toBe(true);
    expect(selectAll().indeterminate).toBe(false);
    expect(text(get('multi-edit-count'))).toBe('3 rows selected');

    await check(selectAll(), false);
    expect(rowBoxes().some((b) => b.checked)).toBe(false);
    expect(q('multi-edit')).toBeNull();
  });

  it('one row reads "1 row selected" / "Save 1 document"; Clear selection hides the panel', async () => {
    await enterEditMode();
    await check(rowBoxes()[1]);
    expect(text(get('multi-edit-count'))).toBe('1 row selected');
    expect(text(get('multi-edit-save'))).toBe('Save 1 document');
    get('multi-edit-clear').click();
    await settle();
    expect(q('multi-edit')).toBeNull();
    expect(rowBoxes().some((b) => b.checked)).toBe(false);
  });

  it('select 3 rows, set a field, save: one confirm with the count, 3 docs updated', async () => {
    await enterEditMode();
    await check(selectAll());
    await type('multi-edit-field', 'status');
    await type('multi-edit-value', '"shipped"');
    await save();
    expect(confirms).toHaveLength(1);
    expect(confirms[0]).toMatchObject({
      title: 'Update 3 documents',
      confirmLabel: 'Save 3 documents',
    });
    expect(updates().map((p) => p['id'])).toEqual([keyOf(1), keyOf(2), keyOf(3)]);
    for (const p of updates()) {
      expect(p).toMatchObject({
        update: '{"$set":{"status":"shipped"}}',
        expected: '{"status":{"$eq":"open"}}',
        confirmed: true,
      });
    }
    expect(text(get('multi-edit-summary'))).toBe('Saved 3 documents.');
    expect(q('multi-edit-error')).toBeNull();
    // The selection stays for another edit; the rows show the read-back version.
    expect(text(get('multi-edit-count'))).toBe('3 rows selected');
    expect(rowBoxes().map((b) => b.checked)).toEqual([true, true, true]);
    const strings = [...el().querySelectorAll<HTMLInputElement>('input.val-input.str')].map(
      (i) => i.value,
    );
    expect(strings.filter((s) => s === 'server')).toHaveLength(3);
  });

  it('a plain number takes the integer default from the settings', async () => {
    TestBed.inject(NumberDefaultService).integers.set('int64');
    await enterEditMode();
    await check(rowBoxes()[0]);
    await type('multi-edit-field', 'qty');
    await type('multi-edit-value', '42');
    await save();
    expect(updates()[0]?.['update']).toBe('{"$set":{"qty":{"$numberLong":"42"}}}');
  });

  it('remove hides the value and unsets the field (nested path)', async () => {
    await enterEditMode();
    await check(rowBoxes()[0]);
    await choose('multi-edit-action', 'unset');
    expect(q('multi-edit-value')).toBeNull();
    await type('multi-edit-field', 'address.city');
    await save();
    expect(updates()).toHaveLength(1);
    expect(updates()[0]?.['update']).toContain('$unset');
    expect(updates()[0]?.['update']).toContain('address.city');
  });

  it('switching back from remove to set shows the value again', async () => {
    await enterEditMode();
    await check(rowBoxes()[0]);
    await choose('multi-edit-action', 'unset');
    await choose('multi-edit-action', 'set');
    expect(q('multi-edit-value')).not.toBeNull();
  });

  it('a conflicting document deleted on the server is still reported after the batch', async () => {
    fake.handle('docs.update', (p) => {
      if (p.id === keyOf(2)) {
        throw new ApiError({ code: 'CONFLICT', message: 'gone', detail: { current: null } });
      }
      return { modified: true };
    });
    await enterEditMode();
    await check(selectAll());
    await type('multi-edit-field', 'status');
    await type('multi-edit-value', '"shipped"');
    await save();
    expect(updates()).toHaveLength(3);
    // The report of the batch must stay visible: the deleted document is one of the conflicts.
    expect(q('multi-edit-result')).not.toBeNull();
    expect(text(get('multi-edit-summary'))).toContain('Saved 2 documents.');
    expect(all('multi-edit-conflict').map((li) => text(li))).toEqual([
      '2 deleted on the server since it was loaded',
    ]);
    // Deleted, not changed: the summary says so.
    expect(text(get('multi-edit-summary'))).toContain('1 not saved: deleted on the server');
    expect(text(get('multi-edit-summary'))).not.toContain('changed on the server');
    // The deleted row left the page; the other two stay selected (the rows below moved up).
    expect(rowBoxes()).toHaveLength(2);
    expect(rowBoxes().every((b) => b.checked)).toBe(true);
    expect(text(get('multi-edit-count'))).toBe('2 rows selected');
  });

  it('when every selected row was deleted on the server the report stays until closed', async () => {
    fake.fail('docs.update', { code: 'CONFLICT', message: 'gone', detail: { current: null } });
    await enterEditMode();
    await check(rowBoxes()[0]);
    await type('multi-edit-field', 'status');
    await type('multi-edit-value', '"shipped"');
    await save();
    expect(rowBoxes()).toHaveLength(2);
    expect(rowBoxes().some((b) => b.checked)).toBe(false);
    expect(text(get('multi-edit-count'))).toBe('No rows selected');
    expect(get<HTMLButtonElement>('multi-edit-save').disabled).toBe(true);
    expect(text(get('multi-edit-summary'))).toBe(
      'Saved 0 documents. 1 not saved: deleted on the server since they were loaded (removed from the page).',
    );
    expect(text(get('multi-edit-clear'))).toBe('Close');
    get('multi-edit-clear').click();
    await settle();
    expect(q('multi-edit')).toBeNull();
  });

  it('a page with other documents also ends the report of the last batch', async () => {
    await enterEditMode();
    await check(rowBoxes()[0]);
    await type('multi-edit-field', 'status');
    await type('multi-edit-value', '"shipped"');
    await save();
    expect(q('multi-edit-result')).not.toBeNull();
    page = [4, 5, 6];
    get('query-run').click();
    await settle();
    expect(q('multi-edit')).toBeNull();
  });

  it('a deleted row above a selected row: the selection stays on the same document', async () => {
    // Rows 1 and 3 selected; document 1 was deleted on the server, so row 3 moves up to index 1.
    fake.handle('docs.update', (p) => {
      if (p.id === keyOf(1)) {
        throw new ApiError({ code: 'CONFLICT', message: 'gone', detail: { current: null } });
      }
      return { modified: true };
    });
    await enterEditMode();
    await check(rowBoxes()[0]);
    await check(rowBoxes()[2]);
    await type('multi-edit-field', 'status');
    await type('multi-edit-value', '"shipped"');
    await save();
    expect(updates().map((p) => p['id'])).toEqual([keyOf(1), keyOf(3)]);
    expect(rowBoxes()).toHaveLength(2);
    // Document 2 (now the first row) is not selected, document 3 (now the second row) is.
    expect(rowBoxes().map((b) => b.checked)).toEqual([false, true]);
    expect(text(get('multi-edit-count'))).toBe('1 row selected');
    // The next batch goes to document 3 only, not to document 2 that took its old index.
    await type('multi-edit-value', '"packed"');
    await save();
    expect(updates().map((p) => p['id'])).toEqual([keyOf(1), keyOf(3), keyOf(3)]);
    expect(text(get('multi-edit-summary'))).toBe('Saved 1 document.');
  });

  it('Enter in the panel with no row left selected sends nothing', async () => {
    fake.fail('docs.update', { code: 'CONFLICT', message: 'gone', detail: { current: null } });
    await enterEditMode();
    await check(rowBoxes()[0]);
    await type('multi-edit-field', 'status');
    await type('multi-edit-value', '"shipped"');
    await save();
    expect(text(get('multi-edit-count'))).toBe('No rows selected');
    get<HTMLInputElement>('multi-edit-field').closest('form')?.dispatchEvent(new Event('submit'));
    await settle();
    expect(confirms).toHaveLength(1);
    expect(updates()).toHaveLength(1);
    // The report of the last batch is still there.
    expect(text(get('multi-edit-summary'))).toContain('Saved 0 documents.');
  });

  it('leaving edit mode while the batch is sent keeps its report until Close', async () => {
    let finish!: () => void;
    fake.handle(
      'docs.update',
      () =>
        new Promise<{ modified: boolean }>(
          (resolve) => (finish = () => resolve({ modified: true })),
        ),
    );
    await enterEditMode();
    await check(rowBoxes()[0]);
    await type('multi-edit-field', 'status');
    await type('multi-edit-value', '"shipped"');
    await save();
    expect(get('multi-edit').getAttribute('aria-busy')).toBe('true');
    editMode().toggle();
    await settle();
    // Still sending: the panel stays (busy), the checkboxes are gone.
    expect(rowBoxes()).toHaveLength(0);
    expect(q('multi-edit')).not.toBeNull();
    finish();
    await settle();
    expect(updates()).toHaveLength(1);
    expect(text(get('multi-edit-summary'))).toBe('Saved 1 document.');
    expect(text(get('multi-edit-count'))).toBe('No rows selected');
    get('multi-edit-clear').click();
    await settle();
    expect(q('multi-edit')).toBeNull();
  });

  it('a new page while the batch is sent ends the selection; the report still arrives', async () => {
    let finish!: () => void;
    fake.handle(
      'docs.update',
      () =>
        new Promise<{ modified: boolean }>(
          (resolve) => (finish = () => resolve({ modified: true })),
        ),
    );
    await enterEditMode();
    await check(rowBoxes()[0]);
    await type('multi-edit-field', 'status');
    await type('multi-edit-value', '"shipped"');
    await save();
    page = [4, 5, 6];
    get('query-run').click();
    await settle();
    expect(rowBoxes()).toHaveLength(3);
    expect(rowBoxes().some((b) => b.checked)).toBe(false);
    finish();
    await settle();
    expect(text(get('multi-edit-summary'))).toBe('Saved 1 document.');
    // The read-back of document 1 does not touch the new page.
    const strings = [...el().querySelectorAll<HTMLInputElement>('input.val-input.str')].map(
      (i) => i.value,
    );
    expect(strings.filter((s) => s === 'server')).toHaveLength(0);
    expect(strings.filter((s) => s === 'open')).toHaveLength(3);
  });

  it('the result live region is in the DOM before there is a result', async () => {
    await enterEditMode();
    await check(rowBoxes()[0]);
    const region = get('multi-edit').querySelector('[role="status"]');
    expect(region).not.toBeNull();
    expect(text(region)).toBe('');
    await type('multi-edit-field', 'status');
    await type('multi-edit-value', '"shipped"');
    await save();
    // The same element gets the report (a region added with its text may not be announced).
    expect(get('multi-edit').querySelector('[role="status"]')).toBe(region);
    expect(region?.querySelector('[data-testid="multi-edit-summary"]')).not.toBeNull();
  });

  it('select all takes only the rows the explorer search shows', async () => {
    await enterEditMode();
    await check(rowBoxes()[0]);
    const search = el().querySelector<HTMLInputElement>('input[placeholder^="Search names"]');
    if (search === null) throw new Error('no search box');
    search.value = '3';
    search.dispatchEvent(new Event('input'));
    await settle();
    expect(rowBoxes()).toHaveLength(1);
    // Row 1 is selected but hidden: the header box is mixed, not checked.
    expect(selectAll().checked).toBe(false);
    expect(selectAll().indeterminate).toBe(true);
    await check(selectAll());
    expect(text(get('multi-edit-count'))).toBe('1 row selected');
    expect(selectAll().checked).toBe(true);
    expect(selectAll().indeterminate).toBe(false);
    search.value = '';
    search.dispatchEvent(new Event('input'));
    await settle();
    expect(rowBoxes().map((b) => b.checked)).toEqual([false, false, true]);
    expect(selectAll().indeterminate).toBe(true);
  });

  it('select all takes only the rows on the explorer page shown', async () => {
    TestBed.inject(NestedPageSizeService).size.set(2);
    await enterEditMode();
    expect(rowBoxes()).toHaveLength(2);
    await check(selectAll());
    expect(text(get('multi-edit-count'))).toBe('2 rows selected');
    expect(selectAll().checked).toBe(true);
    await check(selectAll(), false);
    expect(q('multi-edit')).toBeNull();
  });

  it('one conflicting document is listed; the others are saved', async () => {
    fake.handle('docs.update', (p) => {
      if (p.id === keyOf(2)) {
        throw new ApiError({
          code: 'CONFLICT',
          message: 'changed',
          detail: { current: orderText(2, 'packed') },
        });
      }
      return { modified: true };
    });
    await enterEditMode();
    await check(selectAll());
    await type('multi-edit-field', 'status');
    await type('multi-edit-value', '"shipped"');
    await save();
    expect(updates()).toHaveLength(3);
    const summary = text(get('multi-edit-summary'));
    expect(summary).toContain('Saved 2 documents.');
    expect(summary).toContain('1 not saved: changed on the server');
    expect(all('multi-edit-conflict').map((li) => text(li))).toEqual([
      '2 changed on the server since it was loaded',
    ]);
    expect(q('multi-edit-failed')).toBeNull();
  });

  it('a failed document is listed as failed', async () => {
    fake.fail('docs.update', { code: 'SERVER_ERROR', message: 'Document failed validation' });
    await enterEditMode();
    await check(rowBoxes()[0]);
    await type('multi-edit-field', 'status');
    await type('multi-edit-value', '"x"');
    await save();
    expect(text(get('multi-edit-summary'))).toContain('Saved 0 documents. 1 failed.');
    expect(text(all('multi-edit-failed')[0] ?? null)).toContain('Document failed validation');
  });

  it('documents that already have the value are counted in the summary', async () => {
    await enterEditMode();
    await check(selectAll());
    await type('multi-edit-field', 'status');
    await type('multi-edit-value', '"open"');
    await save();
    expect(confirms).toHaveLength(0);
    expect(updates()).toHaveLength(0);
    expect(text(get('multi-edit-summary'))).toBe('Saved 0 documents. 3 already had this value.');
  });

  it('shows input errors without sending anything; editing clears them', async () => {
    await enterEditMode();
    await check(rowBoxes()[0]);
    await save();
    expect(text(get('multi-edit-error'))).toMatch(/Enter the field/);
    await type('multi-edit-field', '_id');
    expect(q('multi-edit-error')).toBeNull();
    await save();
    expect(text(get('multi-edit-error'))).toMatch(/_id/);
    await type('multi-edit-field', 'status');
    await type('multi-edit-value', 'process.exit()');
    await save();
    expect(text(get('multi-edit-error'))).toMatch(/^Value: /);
    await type('multi-edit-value', '');
    await save();
    expect(text(get('multi-edit-error'))).toMatch(/Enter a value/);
    expect(confirms).toHaveLength(0);
    expect(fake.requestsFor('docs.update')).toHaveLength(0);
  });

  it('a row with unsaved edits refuses the batch with a message', async () => {
    await enterEditMode();
    const edits = fixture.debugElement.injector.get(DocumentEdits);
    await check(rowBoxes()[0]);
    // An unsaved edit of row 1 (as the table would record it).
    edits.edit(parseEJsonDocument(orderText(1)), parseEJsonDocument(orderText(1, 'draft')));
    await settle();
    await type('multi-edit-field', 'status');
    await type('multi-edit-value', '"shipped"');
    await save();
    expect(text(get('multi-edit-error'))).toMatch(/^1 has unsaved edits/);
    expect(confirms).toHaveLength(0);
  });

  it('cancelling the dialog shows no error and sends nothing', async () => {
    confirmAnswer = false;
    await enterEditMode();
    await check(rowBoxes()[0]);
    await type('multi-edit-field', 'status');
    await type('multi-edit-value', '"shipped"');
    await save();
    expect(confirms).toHaveLength(1);
    expect(q('multi-edit-error')).toBeNull();
    expect(q('multi-edit-result')).toBeNull();
    expect(updates()).toHaveLength(0);
  });

  it('leaving edit mode clears the selection (none selected when it comes back)', async () => {
    await enterEditMode();
    await check(rowBoxes()[0]);
    expect(q('multi-edit')).not.toBeNull();
    editMode().toggle();
    await settle();
    expect(rowBoxes()).toHaveLength(0);
    expect(q('multi-edit')).toBeNull();
    await enterEditMode();
    expect(rowBoxes().some((b) => b.checked)).toBe(false);
    expect(q('multi-edit')).toBeNull();
  });

  it('a page with other documents clears the selection', async () => {
    await enterEditMode();
    await check(rowBoxes()[0]);
    page = [4, 5, 6];
    get('query-run').click();
    await settle();
    expect(rowBoxes()).toHaveLength(3);
    expect(rowBoxes().some((b) => b.checked)).toBe(false);
    expect(q('multi-edit')).toBeNull();
  });

  it('rows loaded with a projection allow top-level fields only', async () => {
    await type('query-projection', '{ status: 1, address: 1 }');
    get('query-run').click();
    await settle();
    await enterEditMode();
    await check(rowBoxes()[0]);
    await type('multi-edit-field', 'address.city');
    await type('multi-edit-value', '"Brugge"');
    await save();
    expect(text(get('multi-edit-error'))).toMatch(/^1 was loaded only partly/);
    expect(updates()).toHaveLength(0);
    await type('multi-edit-field', 'status');
    await save();
    expect(q('multi-edit-error')).toBeNull();
    expect(updates()).toHaveLength(1);
    // A top-level field the loaded row doesn't have may only be hidden by the projection.
    await type('multi-edit-field', 'priority');
    await save();
    expect(text(get('multi-edit-error'))).toBe(
      '1 was loaded only partly: priority isn’t loaded, clear the projection to change it across rows.',
    );
    expect(updates()).toHaveLength(1);
  });

  it('while the batch is being confirmed the panel is busy and a second save does nothing', async () => {
    let answer!: (ok: boolean) => void;
    vi.mocked(TestBed.inject(ConfirmService).confirm).mockImplementation((request) => {
      confirms.push(request);
      return new Promise<boolean>((resolve) => (answer = resolve));
    });
    await enterEditMode();
    await check(rowBoxes()[0]);
    await type('multi-edit-field', 'status');
    await type('multi-edit-value', '"shipped"');
    await save();
    const button = get<HTMLButtonElement>('multi-edit-save');
    expect(button.disabled).toBe(true);
    expect(text(button)).toBe('Saving…');
    expect(get<HTMLButtonElement>('multi-edit-clear').disabled).toBe(true);
    expect(get('multi-edit').getAttribute('aria-busy')).toBe('true');
    // A submit by Enter while busy is ignored.
    get<HTMLFormElement>('multi-edit-field').closest('form')?.dispatchEvent(new Event('submit'));
    await settle();
    expect(confirms).toHaveLength(1);
    answer(true);
    await settle();
    expect(updates()).toHaveLength(1);
    expect(get<HTMLButtonElement>('multi-edit-save').disabled).toBe(false);
    expect(text(get('multi-edit-summary'))).toBe('Saved 1 document.');
  });

  it('other views have no row selection, and switching clears it', async () => {
    await enterEditMode();
    await check(rowBoxes()[0]);
    get('view-list').click();
    await settle();
    expect(q('multi-edit')).toBeNull();
    get('view-table').click();
    await settle();
    expect(rowBoxes()).toHaveLength(3);
    expect(rowBoxes().some((b) => b.checked)).toBe(false);
  });

  it('a read-only profile has no checkbox column even in edit mode', async () => {
    TestBed.inject(ProfileSafetyService).set({
      id: 'p1',
      name: 'Reporting',
      readOnly: true,
      production: false,
    });
    await settle();
    editMode().toggle();
    await settle();
    expect(rowBoxes()).toHaveLength(0);
    expect(q('multi-edit')).toBeNull();
  });
});
