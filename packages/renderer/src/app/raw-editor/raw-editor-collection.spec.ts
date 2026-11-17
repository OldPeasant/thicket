import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import { CollectionView } from '../collection/collection-view';
import { DocumentEdits } from '../document';
import { EditModeService } from '../explorer/services/edit-mode.service';
import type { WorkspaceTab } from '../layout/workspace.service';
import { ProfileSafetyService } from '../safety/profile-safety.service';
import { RawEditor } from './raw-editor';
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

  /** What `docs.find` streams answer. */
  let rows: string[];

  beforeEach(() => {
    fake = new FakeThicketBridge();
    rows = [orderText(1), orderText(2)];
    let streams = 0;
    fake.handle('docs.find', () => {
      const id = `s${++streams}`;
      setTimeout(() => {
        fake.data('docs.find', id, { docs: rows });
        fake.end(id, { delivered: rows.length });
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

  it('passes a projected page to the editor as partial documents', async () => {
    await start();
    const projection = must(
      el().querySelector<HTMLTextAreaElement | HTMLInputElement>(
        '[data-testid="query-projection"]',
      ),
      'projection field',
    );
    projection.value = '{ total: 1 }';
    projection.dispatchEvent(new Event('input'));
    await click('query-run');
    const doc = docItem(0);
    await click('doc-raw-toggle', doc);
    const editor = must(fixture.debugElement.query(By.directive(RawEditor)), 'raw editor');
    expect((editor.componentInstance as RawEditor).partial()).toBe(true);
  });

  it('passes a large document with cut arrays to the editor as partial, its neighbour not', async () => {
    let streams = 100;
    fake.handle('docs.find', () => {
      const id = `s${++streams}`;
      setTimeout(() => {
        fake.data('docs.find', id, {
          docs: rows,
          // Row 1 came with a cut array (docs.find `slice`); row 0 is whole.
          sliced: [{ index: 1, arrays: [{ path: 'items', total: 5000, loaded: 100 }] }],
        });
        fake.end(id, { delivered: rows.length });
      });
      return { streamId: id };
    });
    await start();
    const partialOf = () =>
      (
        must(fixture.debugElement.query(By.directive(RawEditor)), 'raw editor')
          .componentInstance as RawEditor
      ).partial();

    await click('doc-raw-toggle', docItem(1));
    expect(partialOf()).toBe(true);
    await click('doc-raw-toggle', docItem(1));

    await click('doc-raw-toggle', docItem(0));
    expect(partialOf()).toBe(false);
  });

  // conflict-ui TW-2 fix: the raw editor passes whether the projection may hide parts of fields.
  describe('with a projection that may hide parts of fields', () => {
    const runProjection = async (text: string) => {
      const field = must(
        el().querySelector<HTMLTextAreaElement | HTMLInputElement>(
          '[data-testid="query-projection"]',
        ),
        'projection field',
      );
      field.value = text;
      field.dispatchEvent(new Event('input'));
      await click('query-run');
    };
    const rawEditor = () =>
      must(fixture.debugElement.query(By.directive(RawEditor)), 'raw editor')
        .componentInstance as RawEditor;
    const edits = () => fixture.debugElement.injector.get(DocumentEdits);
    const applyRaw = async (doc: HTMLElement, text: string) => {
      const view = editorOf(doc);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        userEvent: 'input.type',
      });
      await settle();
      await click('raw-apply', doc);
    };
    const withAddr = (total: number, addr: string) =>
      `{"_id":{"$numberInt":"1"},"total":{"$numberInt":"${total}"},"addr":${addr}}`;

    it.each([
      ['a dotted path', '{ total: 1, "addr.city": 1 }', true],
      ['$slice', '{ tags: { $slice: 1 } }', true],
      ['whole top-level fields', '{ total: 1, addr: 1 }', false],
    ])('%s: the applied edit records it (%s)', async (_name, projection, hides) => {
      rows = [withAddr(10, '{"city":"Bonn"}')];
      await start();
      await runProjection(projection);
      const doc = docItem(0);
      await click('doc-raw-toggle', doc);
      expect(rawEditor().partial()).toBe(true);
      expect(rawEditor().hidesSubFields()).toBe(hides);
      await applyRaw(doc, '{ _id: 1, total: 15, addr: { city: "Bonn" } }');
      expect(edits().get('{"$numberInt":"1"}')).toMatchObject({
        partial: true,
        hidesSubFields: hides,
      });
    });

    it('is false without a projection', async () => {
      await start();
      await click('doc-raw-toggle', docItem(0));
      expect(rawEditor().hidesSubFields()).toBe(false);
    });

    it('hides Overwrite and Merge for a raw edit under a dotted projection, after a top-level one is run', async () => {
      rows = [withAddr(10, '{"city":"Bonn"}')];
      await start();
      await runProjection('{ total: 1, "addr.city": 1 }');
      const doc = docItem(0);
      await click('doc-raw-toggle', doc);
      await applyRaw(doc, '{ _id: 1, total: 15, addr: { city: "Bonn" } }');
      await click('doc-raw-toggle', doc);
      rows = [withAddr(10, '{"city":"Bonn","street":"Hauptstr. 1"}')];
      await runProjection('{ total: 1, addr: 1 }');
      expect(q('edit-count')?.textContent?.trim()).toBe('1 change');
      fake.fail('docs.update', {
        code: 'CONFLICT',
        message: 'x',
        detail: { current: withAddr(99, '{"city":"Bonn","street":"Hauptstr. 1"}') },
      });
      await click('doc-save', docItem(0));
      expect(q('conflict-view')).not.toBeNull();
      expect(q('conflict-overwrite')).toBeNull();
      expect(q('conflict-merge')).toBeNull();
      expect(q('conflict-keep-server')).not.toBeNull();
      expect(fake.requestsFor('docs.update')).toHaveLength(1);
    });

    it('a plain Save of a raw edit removing a loaded sub-field unsets it', async () => {
      rows = [withAddr(10, '{"city":"Bonn"}')];
      await start();
      await runProjection('{ total: 1, "addr.city": 1 }');
      const doc = docItem(0);
      await click('doc-raw-toggle', doc);
      await applyRaw(doc, '{ _id: 1, total: 10, addr: {} }');
      await click('doc-save', doc);
      const update = fake.requestsFor('docs.update')[0]?.params as Record<string, unknown>;
      expect(JSON.parse(update['update'] as string)).toEqual({ $unset: { 'addr.city': '' } });
    });
  });

  it('opens the editor per document and closes it again', async () => {
    await start();
    await click('doc-raw-toggle', docItem(1));
    expect(docItem(0).querySelector('app-raw-editor')).toBeNull();
    expect(docItem(1).querySelector('app-raw-editor')).not.toBeNull();
    const editor = must(fixture.debugElement.query(By.directive(RawEditor)), 'raw editor');
    expect((editor.componentInstance as RawEditor).partial()).toBe(false);
    await click('doc-raw-toggle', docItem(1));
    expect(docItem(1).querySelector('app-raw-editor')).toBeNull();
    expect(docItem(1).querySelector('app-json-form')).not.toBeNull();
    expect(q('doc-raw-toggle', docItem(1))?.getAttribute('aria-pressed')).toBe('false');
  });

  it("shows each row's own document, not another's unapplied text, when the rows change order", async () => {
    await start();
    await click('doc-raw-toggle', docItem(0));
    await click('doc-raw-toggle', docItem(1));
    const first = editorOf(docItem(0));
    first.dispatch({
      changes: { from: 0, to: first.state.doc.length, insert: '{ _id: 1, total: 11 }' },
      userEvent: 'input.type',
    });
    await settle();
    expect(q('raw-dirty', docItem(0))).not.toBeNull();
    // The same query answers in the other order: row 0 now holds document 2.
    rows = [orderText(2), orderText(1)];
    await click('query-run');
    expect(editorOf(docItem(0)).state.doc.toString()).toBe('{\n  _id: 2,\n  total: 20\n}');
    expect(q('raw-dirty', docItem(0))).toBeNull();
    expect(q('raw-error', docItem(0))).toBeNull();
    expect(editorOf(docItem(1)).state.doc.toString()).toBe('{\n  _id: 1,\n  total: 10\n}');
    expect(q('edit-count')?.textContent ?? '').not.toMatch(/[1-9] change/);
  });

  it('offers no raw editor for a document without _id', async () => {
    rows = ['{"total":{"$numberInt":"5"}}'];
    await start();
    const toggle = must(q('doc-raw-toggle', docItem(0)), 'raw toggle');
    expect(toggle.disabled).toBe(true);
    toggle.click();
    await settle();
    expect(docItem(0).querySelector('app-raw-editor')).toBeNull();
  });

  it('shows a read-only editor for read-only profiles', async () => {
    await start(true);
    const doc = docItem(0);
    await click('doc-raw-toggle', doc);
    expect(editorOf(doc).state.readOnly).toBe(true);
    expect(q('raw-apply', doc)?.disabled).toBe(true);
  });
});
