import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { type BsonDocument, parseEJsonDocument } from '@thicket/core/bson';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import { ProfileSafetyService } from '../safety/profile-safety.service';
import { READ_ONLY_HINT } from '../safety/write-control.directive';
import { DocumentActions } from './document-actions.service';
import { DocumentHeader } from './document-header';
import { DocumentEdits } from './edit-session';

const ID = '{"$numberInt":"1"}';
const ORIGINAL = '{"_id":{"$numberInt":"1"},"status":"open"}';
const SAVED = '{"_id":{"$numberInt":"1"},"status":"paid"}';
const doc = (text: string): BsonDocument => parseEJsonDocument(text);

// The "Undo last save" button in a document's header: offered only after a save, disabled while
// the document has unsaved edits, a write control (read-only profiles), and a click undoes.
describe('DocumentHeader: Undo last save', () => {
  let fake: FakeThicketBridge;
  let fixture: ComponentFixture<DocumentHeader>;
  let edits: DocumentEdits;
  let actions: DocumentActions;

  const el = () => fixture.nativeElement as HTMLElement;
  const undoButton = () => el().querySelector<HTMLButtonElement>('[data-testid="doc-undo-save"]');
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
  };

  beforeEach(async () => {
    fake = new FakeThicketBridge();
    fake.respond('docs.update', { modified: true });
    fake.respond('docs.get', { doc: SAVED, sliced: [] });
    TestBed.configureTestingModule({
      imports: [DocumentHeader],
      providers: [
        provideZonelessChangeDetection(),
        provideFakeThicket(fake),
        DocumentEdits,
        DocumentActions,
      ],
    });
    TestBed.inject(ProfileSafetyService).set({
      id: 'p1',
      name: 'Local',
      readOnly: false,
      production: false,
    });
    edits = TestBed.inject(DocumentEdits);
    actions = TestBed.inject(DocumentActions);
    actions.setHost({
      profileId: 'p1',
      db: 'shop',
      coll: 'orders',
      projection: () => undefined,
      documentChanged: () => undefined,
    });
    fixture = TestBed.createComponent(DocumentHeader);
    fixture.componentRef.setInput('doc', doc(ORIGINAL));
    fixture.componentRef.setInput('shown', doc(ORIGINAL));
    fixture.componentRef.setInput('profileId', 'p1');
    await settle();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function save(): Promise<void> {
    edits.edit(doc(ORIGINAL), doc(SAVED));
    expect(await actions.save(ID)).toBe(true);
    fixture.componentRef.setInput('doc', doc(SAVED));
    fixture.componentRef.setInput('shown', doc(SAVED));
    await settle();
  }

  it('is not shown before the document was saved, nor while it is only edited', async () => {
    expect(undoButton()).toBeNull();
    edits.edit(doc(ORIGINAL), doc(SAVED));
    await settle();
    expect(el().querySelector('[data-testid="doc-save"]')).not.toBeNull();
    expect(undoButton()).toBeNull();
  });

  it('is shown and enabled after a save', async () => {
    await save();
    const button = undoButton();
    expect(button?.textContent?.trim()).toBe('Undo last save');
    expect(button?.disabled).toBe(false);
    expect(button?.title).toBe('Write back the version from before the last save');
  });

  it('is disabled with a hint while the document has unsaved edits', async () => {
    await save();
    edits.edit(doc(SAVED), doc('{"_id":{"$numberInt":"1"},"status":"shipped"}'));
    await settle();
    expect(undoButton()?.disabled).toBe(true);
    expect(undoButton()?.title).toBe('Save or revert your edits first');

    edits.discard(ID);
    await settle();
    expect(undoButton()?.disabled).toBe(false);
  });

  it('is disabled on a read-only profile, with the read-only hint', async () => {
    await save();
    TestBed.inject(ProfileSafetyService).set({
      id: 'p1',
      name: 'Local',
      readOnly: true,
      production: false,
    });
    await settle();
    expect(undoButton()?.disabled).toBe(true);
    expect(undoButton()?.title).toBe(READ_ONLY_HINT);
  });

  it('a click undoes the last save; the button then goes away', async () => {
    await save();
    const undo = vi.spyOn(actions, 'undoSave');

    undoButton()?.click();
    await settle();

    expect(undo).toHaveBeenCalledWith(ID);
    const sent = fake.requestsFor('docs.update').at(-1)?.params as Record<string, unknown>;
    expect(sent['update']).toBe('{"$set":{"status":"open"}}');
    expect(sent['expected']).toBe('{"status":{"$eq":"paid"}}');
    expect(actions.message()?.text).toBe('Undid the last save of 1.');
    expect(undoButton()).toBeNull();
  });

  it('is disabled while the undo is running', async () => {
    await save();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    fake.handle('docs.update', async () => {
      await gate;
      return { modified: true };
    });

    undoButton()?.click();
    await settle();
    expect(undoButton()?.disabled).toBe(true);

    release();
    await settle();
    expect(undoButton()).toBeNull();
  });
});
