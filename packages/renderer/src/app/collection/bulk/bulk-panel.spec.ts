import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../../api/testing';
import { ConfirmDialog } from '../../safety/confirm-dialog';
import { ConfirmService } from '../../safety/confirm.service';
import { ProfileSafetyService } from '../../safety/profile-safety.service';
import { BulkPanel, type BulkOutcome } from './bulk-panel';
import type { BulkQuery } from './bulk.util';

const TARGET = { profileId: 'p1', db: 'shop', coll: 'orders' };
const QUERY: BulkQuery = { filter: '{"status":"open"}' };

/** Text with the narrow no-break spaces of `formatCount` as plain spaces. */
const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\u202f/g, ' ').trim();

/** A fake collection: `docs.previewMany` and the writes report from the same matching set. */
function fakeCollection(fake: FakeThicketBridge, matching: () => number): void {
  fake.handle('docs.previewMany', () => ({
    matched: matching(),
    sample: ['{"_id":{"$numberInt":"1"},"status":"open"}'],
  }));
  fake.handle('docs.updateMany', () => ({ matched: matching(), modified: matching() }));
  fake.handle('docs.deleteMany', () => ({ deleted: matching() }));
}

describe('BulkPanel', () => {
  let fake: FakeThicketBridge;
  let fixture: ComponentFixture<BulkPanel>;
  let dialog: ComponentFixture<ConfirmDialog>;
  let confirm: ConfirmService;
  let matching: number;
  let outcomes: BulkOutcome[];

  const el = () => fixture.nativeElement as HTMLElement;
  const dlg = () => dialog.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(id: string, root = el()) =>
    root.querySelector<T>(`[data-testid="${id}"]`);
  const get = <T extends HTMLElement = HTMLElement>(id: string, root = el()): T => {
    const found = q<T>(id, root);
    if (found === null) throw new Error(`no element ${id}`);
    return found;
  };
  const settle = async () => {
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
      await dialog.whenStable();
    }
  };
  const typeUpdate = async (text: string) => {
    const area = get<HTMLTextAreaElement>('bulk-update');
    area.value = text;
    area.dispatchEvent(new Event('input'));
    await settle();
  };

  beforeEach(async () => {
    fake = new FakeThicketBridge();
    matching = 1500;
    fakeCollection(fake, () => matching);
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideFakeThicket(fake)],
    });
    TestBed.inject(ProfileSafetyService).set({
      id: 'p1',
      name: 'local',
      readOnly: false,
      production: false,
    });
    confirm = TestBed.inject(ConfirmService);
    dialog = TestBed.createComponent(ConfirmDialog);
    document.body.appendChild(dialog.nativeElement as HTMLElement);
    fixture = TestBed.createComponent(BulkPanel);
    fixture.componentRef.setInput('target', TARGET);
    fixture.componentRef.setInput('query', QUERY);
    outcomes = [];
    fixture.componentInstance.changed.subscribe((o) => outcomes.push(o));
    await settle();
  });

  it('the preview shows the same count the execution reports (update)', async () => {
    await typeUpdate('{ $set: { status: "archived" } }');
    get('bulk-preview').click();
    await settle();
    const previewed = text(get('bulk-matched'));
    expect(previewed).toBe('1 500');
    expect(q('bulk-sample-doc')?.textContent).toContain('status: "open"');

    get('bulk-execute').click();
    await settle();
    const ok = get<HTMLButtonElement>('confirm-ok', dlg());
    const typed = get<HTMLInputElement>('confirm-type', dlg());
    expect(ok.disabled).toBe(true);
    typed.value = 'orders';
    typed.dispatchEvent(new Event('input'));
    await settle();
    ok.click();
    await settle();

    const sent = fake.requestsFor('docs.updateMany')[0]?.params as Record<string, unknown>;
    expect(sent).toMatchObject({
      ...TARGET,
      filter: QUERY.filter,
      update: '{"$set":{"status":"archived"}}',
      expectedCount: 1500,
      confirmed: true,
    });
    expect(outcomes).toEqual([{ mode: 'update', matched: 1500, modified: 1500 }]);
    expect(text(get('bulk-outcome'))).toContain('1 500 matched');
    expect(text(get('bulk-outcome')).replace(/[^\d ]/g, '')).toContain(previewed);
  });

  it('delete at or below 1 000 documents needs no typed name; the count matches', async () => {
    matching = 1000;
    get('bulk-mode-delete').click();
    await settle();
    get('bulk-preview').click();
    await settle();
    expect(text(get('bulk-matched'))).toBe('1 000');
    get('bulk-execute').click();
    await settle();
    expect(q('confirm-type', dlg())).toBeNull();
    expect(get('confirm-operation', dlg()).textContent).toContain('deleteMany(');
    get('confirm-ok', dlg()).click();
    await settle();
    expect(outcomes).toEqual([{ mode: 'delete', deleted: 1000 }]);
    expect(text(get('bulk-outcome'))).toContain('Deleted 1 000 documents');
  });

  it('cannot run before a preview, and a changed update makes the preview stale', async () => {
    await typeUpdate('{ $inc: { n: 1 } }');
    expect(get<HTMLButtonElement>('bulk-execute').disabled).toBe(true);
    get('bulk-preview').click();
    await settle();
    expect(get<HTMLButtonElement>('bulk-execute').disabled).toBe(false);
    await typeUpdate('{ $inc: { n: 2 } }');
    expect(get<HTMLButtonElement>('bulk-execute').disabled).toBe(true);
    expect(get('bulk-match').classList).toContain('stale');
  });

  it('a changed filter makes the preview stale', async () => {
    get('bulk-mode-delete').click();
    await settle();
    get('bulk-preview').click();
    await settle();
    fixture.componentRef.setInput('query', { filter: '{"status":"closed"}' });
    await settle();
    expect(get<HTMLButtonElement>('bulk-execute').disabled).toBe(true);
  });

  it('an update with a plain field is refused before anything is sent', async () => {
    await typeUpdate('{ status: "archived" }');
    expect(get('bulk-update-error').textContent).toContain('not an update operator');
    expect(get<HTMLButtonElement>('bulk-preview').disabled).toBe(true);
    expect(fake.requestsFor('docs.previewMany')).toHaveLength(0);
  });

  it('more matches at execution than previewed: CONFLICT is explained, preview again', async () => {
    matching = 500;
    get('bulk-mode-delete').click();
    await settle();
    get('bulk-preview').click();
    await settle();
    fake.fail('docs.deleteMany', { code: 'CONFLICT', message: 'more documents match' });
    get('bulk-execute').click();
    await settle();
    expect(confirm.current()?.title).toBe('Delete documents');
    get('confirm-ok', dlg()).click();
    await settle();
    expect(get('bulk-error').textContent).toContain('preview again');
    expect(get<HTMLButtonElement>('bulk-execute').disabled).toBe(true);
    expect(outcomes).toEqual([]);
  });

  it('cancelling the confirm dialog sends nothing', async () => {
    get('bulk-mode-delete').click();
    await settle();
    get('bulk-preview').click();
    await settle();
    get('bulk-execute').click();
    await settle();
    get('confirm-cancel', dlg()).click();
    await settle();
    expect(fake.requestsFor('docs.deleteMany')).toHaveLength(0);
    expect(q('bulk-error')).toBeNull();
    expect(get<HTMLButtonElement>('bulk-execute').disabled).toBe(false);
  });

  /** Makes `docs.previewMany` wait until the returned function answers it. */
  const holdPreview = () => {
    let answer: (matched: number) => void = () => undefined;
    fake.handle(
      'docs.previewMany',
      () =>
        new Promise((resolve) => {
          answer = (matched) => resolve({ matched, sample: [] });
        }),
    );
    return (matched: number) => answer(matched);
  };

  it('sends the filter, the collation and the sample size to the preview and the write', async () => {
    const collation = '{"locale":"de","strength":{"$numberInt":"2"}}';
    fixture.componentRef.setInput('query', { ...QUERY, collation });
    matching = 3;
    await typeUpdate('{ $set: { status: "archived" } }');
    expect(text(get('bulk-command'))).toBe(
      'db.orders.updateMany({ status: "open" }, { $set: { status: "archived" } }, ' +
        '{ collation: { locale: "de", strength: 2 } })',
    );
    get('bulk-preview').click();
    await settle();
    expect(fake.requestsFor('docs.previewMany')[0]?.params).toEqual({
      ...TARGET,
      filter: QUERY.filter,
      collation,
      sampleSize: 5,
    });
    get('bulk-execute').click();
    await settle();
    expect(q('confirm-type', dlg())).toBeNull();
    get('confirm-ok', dlg()).click();
    await settle();
    expect(fake.requestsFor('docs.updateMany')[0]?.params).toMatchObject({
      ...TARGET,
      filter: QUERY.filter,
      collation,
      expectedCount: 3,
    });
  });

  it('sends no collation key when the query has none', async () => {
    get('bulk-mode-delete').click();
    await settle();
    get('bulk-preview').click();
    await settle();
    expect(fake.requestsFor('docs.previewMany')[0]?.params).not.toHaveProperty('collation');
  });

  it('a failed preview shows the error, ends the spinner and can be retried', async () => {
    fake.fail('docs.previewMany', { code: 'SERVER_ERROR', message: 'not primary (fictitious)' });
    get('bulk-mode-delete').click();
    await settle();
    get('bulk-preview').click();
    await settle();
    expect(get('bulk-error').textContent).toContain('not primary (fictitious)');
    expect(q('bulk-cancel')).toBeNull();
    expect(get<HTMLButtonElement>('bulk-execute').disabled).toBe(true);
    expect(get<HTMLButtonElement>('bulk-preview').disabled).toBe(false);

    fakeCollection(fake, () => matching);
    get('bulk-preview').click();
    await settle();
    expect(q('bulk-error')).toBeNull();
    expect(text(get('bulk-matched'))).toBe('1 500');
    expect(get<HTMLButtonElement>('bulk-execute').disabled).toBe(false);
  });

  it('cancels a running preview: the request is cancelled, no error, back to idle', async () => {
    const answer = holdPreview();
    get('bulk-mode-delete').click();
    await settle();
    get('bulk-preview').click();
    await settle();
    expect(text(get('bulk-status'))).toContain('Counting matching documents');
    expect(get<HTMLButtonElement>('bulk-preview').disabled).toBe(true);
    expect(get<HTMLButtonElement>('bulk-mode-update').disabled).toBe(true);

    get('bulk-cancel').click();
    await settle();
    const id = fake.requestsFor('docs.previewMany')[0]?.id;
    expect(fake.cancels).toContain(id);
    expect(q('bulk-cancel')).toBeNull();
    expect(q('bulk-error')).toBeNull();
    expect(get<HTMLButtonElement>('bulk-preview').disabled).toBe(false);
    expect(get<HTMLButtonElement>('bulk-execute').disabled).toBe(true);

    // A late answer of the cancelled request changes nothing.
    answer(42);
    await settle();
    expect(q('bulk-matched')).toBeNull();
    expect(get<HTMLButtonElement>('bulk-execute').disabled).toBe(true);
  });

  it('a filter applied while the preview runs makes its answer stale', async () => {
    const answer = holdPreview();
    get('bulk-mode-delete').click();
    await settle();
    get('bulk-preview').click();
    await settle();
    fixture.componentRef.setInput('query', { filter: '{"status":"closed"}' });
    await settle();
    answer(7);
    await settle();
    expect(get('bulk-match').classList).toContain('stale');
    expect(text(get('bulk-status'))).toContain('Preview again');
    expect(get<HTMLButtonElement>('bulk-execute').disabled).toBe(true);
  });

  it('closing the panel during a preview cancels it and emits closed', async () => {
    holdPreview();
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => closed++);
    get('bulk-mode-delete').click();
    await settle();
    get('bulk-preview').click();
    await settle();
    get('bulk-close').click();
    await settle();
    expect(closed).toBe(1);
    expect(fake.cancels).toHaveLength(1);
  });

  it('destroying the panel cancels a running preview', async () => {
    holdPreview();
    get('bulk-mode-delete').click();
    await settle();
    get('bulk-preview').click();
    await settle();
    fixture.destroy();
    await dialog.whenStable();
    expect(fake.cancels).toHaveLength(1);
  });

  it.each([
    ['update', 'Nothing to update.'],
    ['delete', 'Nothing to delete.'],
  ] as const)('zero matches (%s): nothing to run, no sample', async (mode, message) => {
    fake.handle('docs.previewMany', () => ({ matched: 0, sample: [] }));
    get(`bulk-mode-${mode}`).click();
    await settle();
    if (mode === 'update') await typeUpdate('{ $set: { status: "archived" } }');
    get('bulk-preview').click();
    await settle();
    expect(text(get('bulk-matched'))).toBe('0');
    expect(text(get('bulk-status'))).toContain(message);
    expect(q('bulk-sample')).toBeNull();
    expect(get<HTMLButtonElement>('bulk-execute').disabled).toBe(true);
  });

  it('asks for the typed name at 1 001 documents, also for a delete', async () => {
    matching = 1001;
    get('bulk-mode-delete').click();
    await settle();
    get('bulk-preview').click();
    await settle();
    expect(text(get('bulk-status'))).toContain('type the collection name');
    get('bulk-execute').click();
    await settle();
    const ok = get<HTMLButtonElement>('confirm-ok', dlg());
    const typed = get<HTMLInputElement>('confirm-type', dlg());
    typed.value = 'order';
    typed.dispatchEvent(new Event('input'));
    await settle();
    expect(ok.disabled).toBe(true);
    typed.value = 'orders';
    typed.dispatchEvent(new Event('input'));
    await settle();
    expect(ok.disabled).toBe(false);
    ok.click();
    await settle();
    expect(outcomes).toEqual([{ mode: 'delete', deleted: 1001 }]);
  });

  it('an update of exactly 1 000 documents needs no typed name', async () => {
    matching = 1000;
    await typeUpdate('{ $set: { status: "archived" } }');
    get('bulk-preview').click();
    await settle();
    expect(text(get('bulk-status'))).not.toContain('type the collection name');
    get('bulk-execute').click();
    await settle();
    expect(q('confirm-type', dlg())).toBeNull();
    get('confirm-ok', dlg()).click();
    await settle();
    expect(outcomes).toEqual([{ mode: 'update', matched: 1000, modified: 1000 }]);
  });

  it('sends an update pipeline as canonical EJSON and labels one document singular', async () => {
    matching = 1;
    await typeUpdate('[{ $set: { total: { $add: ["$a", "$b"] } } }]');
    get('bulk-preview').click();
    await settle();
    expect(text(get('bulk-execute'))).toBe('Update 1 document…');
    get('bulk-execute').click();
    await settle();
    get('confirm-ok', dlg()).click();
    await settle();
    expect(fake.requestsFor('docs.updateMany')[0]?.params).toMatchObject({
      update: '[{"$set":{"total":{"$add":["$a","$b"]}}}]',
      expectedCount: 1,
    });
    expect(text(get('bulk-outcome'))).toBe('Updated 1 document (1 matched).');
    // After the write the preview is gone: running again needs a new preview.
    expect(get<HTMLButtonElement>('bulk-execute').disabled).toBe(true);
  });

  it('a failed write shows the error and keeps the preview for a retry', async () => {
    matching = 4;
    fake.fail('docs.updateMany', { code: 'SERVER_ERROR', message: 'write failed (fictitious)' });
    await typeUpdate('{ $set: { status: "archived" } }');
    get('bulk-preview').click();
    await settle();
    get('bulk-execute').click();
    await settle();
    get('confirm-ok', dlg()).click();
    await settle();
    expect(get('bulk-error').textContent).toContain('write failed (fictitious)');
    expect(outcomes).toEqual([]);
    expect(get<HTMLButtonElement>('bulk-execute').disabled).toBe(false);
  });

  it('switching the mode makes an update preview stale for a delete', async () => {
    matching = 4;
    await typeUpdate('{ $set: { status: "archived" } }');
    get('bulk-preview').click();
    await settle();
    expect(get<HTMLButtonElement>('bulk-execute').disabled).toBe(false);
    get('bulk-mode-delete').click();
    await settle();
    expect(get<HTMLButtonElement>('bulk-execute').disabled).toBe(true);
    expect(get('bulk-match').classList).toContain('stale');
  });

  it('pressing Preview with an empty update shows why nothing is sent', async () => {
    expect(q('bulk-update-error')).toBeNull();
    expect(get<HTMLButtonElement>('bulk-preview').disabled).toBe(true);
    await fixture.componentInstance.runPreview();
    await settle();
    expect(get('bulk-update-error').textContent).toContain('Type an update');
    expect(fake.requestsFor('docs.previewMany')).toHaveLength(0);
  });

  it('Ctrl+Enter in the update runs the preview', async () => {
    matching = 2;
    await typeUpdate('{ $set: { status: "archived" } }');
    get('bulk-update').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
    );
    await settle();
    expect(fake.requestsFor('docs.previewMany')).toHaveLength(1);
    expect(text(get('bulk-matched'))).toBe('2');
  });

  it('a read-only profile refuses the write before anything is sent', async () => {
    matching = 4;
    get('bulk-mode-delete').click();
    await settle();
    get('bulk-preview').click();
    await settle();
    TestBed.inject(ProfileSafetyService).set({
      id: 'p1',
      name: 'local',
      readOnly: true,
      production: false,
    });
    get('bulk-execute').click();
    await settle();
    expect(confirm.current()).toBeNull();
    expect(fake.requestsFor('docs.deleteMany')).toHaveLength(0);
    expect(q('bulk-error')).not.toBeNull();
    expect(outcomes).toEqual([]);
  });
});
