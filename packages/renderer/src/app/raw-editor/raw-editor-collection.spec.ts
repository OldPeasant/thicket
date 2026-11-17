import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import { CollectionView } from '../collection/collection-view';
import { EditModeService } from '../explorer/services/edit-mode.service';
import type { WorkspaceTab } from '../layout/workspace.service';
import { ProfileSafetyService } from '../safety/profile-safety.service';
import { installJsdomLayoutStubs } from './testing';

installJsdomLayoutStubs();

const TAB: WorkspaceTab = {
  id: 'p1/shop.orders',
  kind: 'collection',
  title: 'orders',
  data: { profileId: 'p1', db: 'shop', coll: 'orders', type: 'collection' },
};

function orderText(i: number): string {
  return `{"_id":{"$numberInt":"${i}"},"total":{"$numberInt":"${10 * i}"}}`;
}

// The raw editor in the collection tab's document list: Raw swaps a document's form for the
// editor, Apply goes into the tab's edit session (change count, Save sends the diff).
describe('Raw editor in a collection tab', () => {
  let fake: FakeThicketBridge;
  let fixture: ComponentFixture<CollectionView>;

  const el = () => fixture.nativeElement as HTMLElement;
  const must = <T>(value: T | null | undefined, what: string): T => {
    if (value === null || value === undefined) throw new Error(`no ${what}`);
    return value;
  };
  const docItem = (n: number) =>
    must(el().querySelectorAll<HTMLElement>('[data-testid="result-doc"]')[n], `document ${n}`);
  const q = (id: string, root: ParentNode = el()) =>
    root.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
  const settle = async () => {
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
  };
  const click = async (id: string, root: ParentNode = el()) => {
    must(q(id, root), id).click();
    await settle();
  };
  const editorOf = (root: ParentNode) => {
    const dom = must(root.querySelector<HTMLElement>('.cm-editor'), 'editor');
    return must(EditorView.findFromDOM(dom), 'editor view');
  };

  const start = async (readOnly = false) => {
    TestBed.inject(ProfileSafetyService).set({
      id: 'p1',
      name: 'Local',
      readOnly,
      production: false,
    });
    fixture = TestBed.createComponent(CollectionView);
    fixture.componentRef.setInput('tab', TAB);
    await settle();
    await click('view-list');
  };

  beforeEach(() => {
    fake = new FakeThicketBridge();
    let streams = 0;
    fake.handle('docs.find', () => {
      const id = `s${++streams}`;
      setTimeout(() => {
        fake.data('docs.find', id, { docs: [orderText(1), orderText(2)] });
        fake.end(id, { delivered: 2 });
      });
      return { streamId: id };
    });
    fake.respond('docs.estimatedCount', { count: 2 });
    fake.respond('docs.update', { modified: true });
    fake.respond('docs.get', {
      doc: '{"_id":{"$numberInt":"1"},"total":{"$numberInt":"99"},"note":"raw"}',
      sliced: [],
    });
    TestBed.configureTestingModule({
      imports: [CollectionView],
      providers: [provideZonelessChangeDetection(), provideFakeThicket(fake)],
    });
  });

  afterEach(() => {
    TestBed.inject(EditModeService).reset();
    vi.restoreAllMocks();
  });

  it('applies the raw text to the edit session, and Save sends its diff', async () => {
    await start();
    const doc = docItem(0);
    expect(doc.querySelector('app-raw-editor')).toBeNull();
    await click('doc-raw-toggle', doc);
    expect(q('doc-raw-toggle', doc)?.getAttribute('aria-pressed')).toBe('true');
    expect(doc.querySelector('app-json-form')).toBeNull();
    const view = editorOf(doc);
    expect(view.state.doc.toString()).toBe('{\n  _id: 1,\n  total: 10\n}');
    // The other document keeps its form.
    expect(docItem(1).querySelector('app-json-form')).not.toBeNull();

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: '{ _id: 1, total: 99, note: "raw" }' },
      userEvent: 'input.type',
    });
    await settle();
    await click('raw-apply', doc);
    expect(q('edit-count')?.textContent?.trim()).toBe('2 changes');
    expect(q('doc-changes', doc)?.textContent?.trim()).toBe('2 changes');

    // Back to the form: it shows the applied values.
    await click('doc-raw-toggle', doc);
    expect(doc.querySelector('app-json-form')?.textContent).toContain('raw');

    await click('doc-save', doc);
    const update = fake.requestsFor('docs.update')[0]?.params as Record<string, unknown>;
    expect(JSON.parse(update['update'] as string)).toEqual({
      $set: { total: { $numberInt: '99' }, note: 'raw' },
    });
  });

  it('shows a read-only editor for read-only profiles', async () => {
    await start(true);
    const doc = docItem(0);
    await click('doc-raw-toggle', doc);
    expect(editorOf(doc).state.readOnly).toBe(true);
    expect(q('raw-apply', doc)?.disabled).toBe(true);
  });
});
