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
});
