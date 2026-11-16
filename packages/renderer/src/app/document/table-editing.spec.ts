import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { parseEJsonDocument } from '@thicket/core/bson';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import { CollectionView } from '../collection/collection-view';
import { toExplorerValue } from '../explorer/bson-value.util';
import { JsonExplorerComponent } from '../explorer/json-explorer.component';
import { JsonFormComponent } from '../explorer/json-form/json-form.component';
import { EditModeService } from '../explorer/services/edit-mode.service';
import type { WorkspaceTab } from '../layout/workspace.service';
import { ConfirmService, type ConfirmRequest } from '../safety/confirm.service';
import { ProfileSafetyService } from '../safety/profile-safety.service';
import { DocumentActions } from './document-actions.service';
import { DocumentEdits } from './edit-session';

const TAB: WorkspaceTab = {
  id: 'p1/shop.orders',
  kind: 'collection',
  title: 'orders',
  data: { profileId: 'p1', db: 'shop', coll: 'orders', type: 'collection' },
};

function orderText(i: number, total = 10 * i, qty = i): string {
  return `{"_id":{"$numberInt":"${i}"},"total":{"$numberInt":"${total}"},"qty":{"$numberInt":"${qty}"}}`;
}
const tree = (ejson: string) => toExplorerValue(parseEJsonDocument(ejson));

// The table view of a collection tab: the explorer's root table emits the whole array of
// document trees; CollectionView.tableChanged turns that into an edit of the changed row, a draft
// for an added row, or a delete (after the dialog) for a removed row.
describe('Editing documents in the table view', () => {
  let fake: FakeThicketBridge;
  let fixture: ComponentFixture<CollectionView>;
  let confirms: ConfirmRequest[];
  let confirmAnswer: boolean;

  const settle = async () => {
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
  };
  const explorer = () => {
    const found = fixture.debugElement.query(By.directive(JsonExplorerComponent));
    if (found === null) throw new Error('no explorer');
    return found.componentInstance as JsonExplorerComponent;
  };
  /** The trees the table shows (one per document). */
  const rows = () => explorer().value as unknown[];
  const emit = async (value: unknown) => {
    explorer().valueChange.emit(value);
    await settle();
  };
  const edits = () => fixture.debugElement.injector.get(DocumentEdits);
  const actions = () => fixture.debugElement.injector.get(DocumentActions);

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
    fake.respond('docs.delete', { deleted: true });
    fake.handle('docs.get', () => ({ doc: orderText(2, 77), sliced: [] }));
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
    expect(rows()).toHaveLength(3);
  });

  afterEach(() => {
    TestBed.inject(EditModeService).reset();
    vi.restoreAllMocks();
  });

  it('records an edited row as an edit of that document only', async () => {
    const [a, , c] = rows();
    await emit([a, tree(orderText(2, 77)), c]);
    expect(
      edits()
        .documents()
        .map((d) => d.key),
    ).toEqual(['{"$numberInt":"2"}']);
    expect(edits().changeCount()).toBe(1);
    // The table now shows the edited version; unchanged rows keep their trees.
    expect(rows()[0]).toBe(a);
    expect(rows()[2]).toBe(c);

    // Saved from the bar: one docs.update for that document.
    const bar = fixture.nativeElement.querySelector(
      '[data-testid="edit-save"]',
    ) as HTMLButtonElement;
    bar.click();
    await settle();
    expect(fake.requestsFor('docs.update').map((r) => (r.params as { id: string }).id)).toEqual([
      '{"$numberInt":"2"}',
    ]);
    expect(edits().modified()).toBe(false);
  });

  it('turns an added row into a draft (not inserted yet)', async () => {
    const shown = rows();
    await emit([...shown, tree('{"total":{"$numberInt":"40"},"qty":{"$numberInt":"4"}}')]);
    expect(actions().drafts()).toHaveLength(1);
    const draft = actions().drafts()[0];
    expect(draft?.doc.fields.map((f) => f.key)).toEqual(['_id', 'total', 'qty']);
    expect(draft?.doc.fields[0]?.value.type).toBe('objectId');
    expect(fixture.nativeElement.querySelectorAll('[data-testid="draft"]')).toHaveLength(1);
    expect(fake.requestsFor('docs.insert')).toHaveLength(0);
    expect(edits().modified()).toBe(false);
  });

  it('asks before deleting the document of a removed row', async () => {
    const [a, , c] = rows();
    confirmAnswer = false;
    await emit([a, c]);
    expect(confirms).toHaveLength(1);
    expect(confirms[0]?.operation).toContain('deleteOne({ _id: 2 })');
    expect(fake.requestsFor('docs.delete')).toHaveLength(0);
    expect(rows()).toHaveLength(3);

    confirmAnswer = true;
    await emit([a, c]);
    expect(fake.requestsFor('docs.delete').at(-1)?.params).toMatchObject({
      id: '{"$numberInt":"2"}',
      confirmed: true,
    });
    expect(rows()).toEqual([tree(orderText(1)), tree(orderText(3))]);
  });

  it('deletes the last document when the last row is removed', async () => {
    const [a, b] = rows();
    await emit([a, b]);
    expect(fake.requestsFor('docs.delete').at(-1)?.params).toMatchObject({
      id: '{"$numberInt":"3"}',
    });
  });

  it('inserts a draft as edited in its form', async () => {
    fake.respond('docs.insert', { insertedIds: ['{"$numberInt":"40"}'] });
    const shown = rows();
    await emit([...shown, tree('{"total":{"$numberInt":"40"}}')]);
    const draftEl = fixture.debugElement.query(By.css('[data-testid="draft"]'));
    const form = draftEl.query(By.directive(JsonFormComponent))
      .componentInstance as JsonFormComponent;
    const id = actions().drafts()[0]?.doc.fields[0]?.value;
    if (id === undefined) throw new Error('no draft _id');
    // The form emits the whole draft tree with qty added.
    form.valueChange.emit(
      toExplorerValue({
        type: 'object',
        fields: [
          { key: '_id', value: id },
          ...parseEJsonDocument('{"total":{"$numberInt":"40"},"qty":{"$numberInt":"4"}}').fields,
        ],
      }),
    );
    await settle();
    (draftEl.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-testid="draft-insert"]')
      ?.click();
    await settle();
    const sent = (fake.requestsFor('docs.insert').at(-1)?.params as { docs: string[] }).docs;
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(
      /^\{"_id":\{"\$oid":"[0-9a-f]{24}"\},"total":\{"\$numberInt":"40"\},"qty":\{"\$numberInt":"4"\}\}$/,
    );
    expect(actions().drafts()).toHaveLength(0);
  });

  it('ignores values that are not a row list, and several rows added at once', async () => {
    await emit({ not: 'an array' });
    const shown = rows();
    await emit([...shown, tree(orderText(8)), tree(orderText(9))]);
    expect(edits().modified()).toBe(false);
    expect(actions().drafts()).toHaveLength(0);
    expect(fake.requestsFor('docs.delete')).toHaveLength(0);
  });
});
