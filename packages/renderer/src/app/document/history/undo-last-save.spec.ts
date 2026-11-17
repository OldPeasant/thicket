import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  type BsonDocument,
  type BsonValue,
  parseEJsonDocument,
  stringifyEJson,
} from '@thicket/core/bson';
import { bsonEquals } from '@thicket/core/diff';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../../api/testing';
import { ConfirmService, type ConfirmRequest } from '../../safety/confirm.service';
import { ProfileSafetyService } from '../../safety/profile-safety.service';
import { DocumentActions } from '../document-actions.service';
import { DocumentEdits } from '../edit-session';

const ID = '{"$numberInt":"1"}';
const doc = (text: string): BsonDocument => parseEJsonDocument(text);
const ORIGINAL = '{"_id":{"$numberInt":"1"},"status":"open","total":{"$numberInt":"10"}}';

/**
 * A one-document server: `docs.update` applies top-level `$set`/`$unset` only when every
 * `expected` check (`$eq`, `$exists: false`) matches the stored document, as MongoDB's filter
 * would; otherwise it answers CONFLICT with the current version. `docs.get` returns it.
 */
class OneDocServer {
  stored: BsonDocument | null;
  constructor(text: string) {
    this.stored = doc(text);
  }

  install(fake: FakeThicketBridge): void {
    fake.handle('docs.get', () => ({
      doc: this.stored === null ? null : stringifyEJson(this.stored),
      sliced: [],
    }));
    fake.handle('docs.update', (p) => {
      const current = this.stored;
      if (current === null || !this.matches(current, doc(p.expected ?? '{}'))) {
        return {
          error: {
            code: 'CONFLICT',
            message: 'changed',
            detail: { current: current === null ? null : stringifyEJson(current) },
          },
        };
      }
      this.stored = this.apply(current, doc(p.update));
      return { modified: true };
    });
    fake.handle('docs.replace', (p) => {
      const current = this.stored;
      if (current === null || !this.matches(current, doc(p.expected ?? '{}'))) {
        return {
          error: {
            code: 'CONFLICT',
            message: 'changed',
            detail: { current: current === null ? null : stringifyEJson(current) },
          },
        };
      }
      this.stored = doc(p.doc);
      return { modified: true };
    });
  }

  /** Changes a field on the server, as another client would. */
  set(key: string, value: BsonValue): void {
    if (this.stored === null) return;
    this.stored = this.apply(this.stored, {
      type: 'object',
      fields: [{ key: '$set', value: { type: 'object', fields: [{ key, value }] } }],
    });
  }

  private matches(current: BsonDocument, expected: BsonDocument): boolean {
    return expected.fields.every(({ key, value }) => {
      const field = current.fields.find((f) => f.key === key);
      if (value.type !== 'object') throw new Error(`unsupported check ${key}`);
      const check = value.fields[0];
      if (check?.key === '$eq') return field !== undefined && bsonEquals(field.value, check.value);
      if (check?.key === '$exists') return field === undefined;
      throw new Error(`unsupported check ${check?.key}`);
    });
  }

  private apply(current: BsonDocument, update: BsonDocument): BsonDocument {
    let fields = [...current.fields];
    for (const { key: op, value } of update.fields) {
      if (value.type !== 'object') throw new Error('bad update');
      for (const { key, value: v } of value.fields) {
        if (key.includes('.')) throw new Error('top-level paths only');
        if (op === '$unset') fields = fields.filter((f) => f.key !== key);
        else if (op === '$set') {
          const at = fields.findIndex((f) => f.key === key);
          if (at >= 0) fields[at] = { key, value: v };
          else fields.push({ key, value: v });
        } else throw new Error(`unsupported ${op}`);
      }
    }
    return { type: 'object', fields };
  }
}

// "Undo last save": Save, then Undo last save writes the pre-save version back through the same
// conflict check as Save.
describe('Undo last save', () => {
  let fake: FakeThicketBridge;
  let server: OneDocServer;
  let edits: DocumentEdits;
  let actions: DocumentActions;
  let changed: [string, string | null][];
  let confirms: ConfirmRequest[];
  let projection: string | undefined;

  const updates = () =>
    fake.requestsFor('docs.update').map((r) => r.params as Record<string, unknown>);
  const replaces = () =>
    fake.requestsFor('docs.replace').map((r) => r.params as Record<string, unknown>);

  beforeEach(() => {
    fake = new FakeThicketBridge();
    server = new OneDocServer(ORIGINAL);
    server.install(fake);
    changed = [];
    confirms = [];
    projection = undefined;
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideFakeThicket(fake),
        DocumentEdits,
        DocumentActions,
      ],
    });
    vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockImplementation((request) => {
      confirms.push(request);
      return Promise.resolve(true);
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
      projection: () => projection,
      documentChanged: (key, d) => changed.push([key, d]),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Edits the loaded original to `edited` and saves it. */
  async function saveAs(edited: string): Promise<void> {
    edits.edit(doc(ORIGINAL), doc(edited));
    expect(await actions.save(ID)).toBe(true);
  }

  it('save, undo last save: the server document equals the original again', async () => {
    expect(actions.canUndoSave(ID)).toBe(false);
    // total changed, status removed, a new field added.
    await saveAs('{"_id":{"$numberInt":"1"},"total":{"$numberInt":"15"},"note":"rush"}');
    expect(stringifyEJson(server.stored as BsonDocument)).not.toBe(ORIGINAL);
    expect(actions.canUndoSave(ID)).toBe(true);

    expect(await actions.undoSave(ID)).toBe(true);

    // Equal with the field order: status comes back before total, so the undo replaces the whole
    // document (an update would append status last).
    expect(stringifyEJson(server.stored as BsonDocument)).toBe(ORIGINAL);
    expect(updates()).toHaveLength(1);
    const undo = replaces()[0];
    expect(undo?.['doc']).toBe(ORIGINAL);
    // The undo's conflict check is the saved values of the changed fields.
    expect(JSON.parse(undo?.['expected'] as string)).toEqual({
      status: { $exists: false },
      total: { $eq: { $numberInt: '15' } },
      note: { $eq: 'rush' },
    });
    expect(actions.message()).toEqual({ kind: 'info', text: 'Undid the last save of 1.' });
    // The page shows the server's version, read back.
    expect(changed.at(-1)?.[1]).toBe(stringifyEJson(server.stored as BsonDocument));
    // Once undone it is not offered again; nothing is left to save.
    expect(actions.canUndoSave(ID)).toBe(false);
    expect(await actions.undoSave(ID)).toBe(false);
    expect(edits.modified()).toBe(false);
  });

  it('undoes only the last save of the document', async () => {
    await saveAs('{"_id":{"$numberInt":"1"},"status":"open","total":{"$numberInt":"15"}}');
    const first = server.stored as BsonDocument;
    edits.edit(first, doc('{"_id":{"$numberInt":"1"},"status":"paid","total":{"$numberInt":"15"}}'));
    expect(await actions.save(ID)).toBe(true);

    expect(await actions.undoSave(ID)).toBe(true);
    expect(bsonEquals(server.stored as BsonDocument, first)).toBe(true);
    expect(actions.canUndoSave(ID)).toBe(false);
    // Only a value changed back: the minimal $set, no replace.
    expect(updates()[2]).toMatchObject({
      update: '{"$set":{"status":"open"}}',
      expected: '{"status":{"$eq":"paid"}}',
    });
    expect(replaces()).toHaveLength(0);
  });

  it('reports a conflict and overwrites nothing when the document changed on the server', async () => {
    await saveAs('{"_id":{"$numberInt":"1"},"status":"open","total":{"$numberInt":"15"}}');
    server.set('total', { type: 'int', value: 20 });
    const before = stringifyEJson(server.stored as BsonDocument);

    expect(await actions.undoSave(ID)).toBe(false);

    expect(stringifyEJson(server.stored as BsonDocument)).toBe(before);
    expect(actions.message()?.kind).toBe('error');
    expect(actions.message()?.text).toMatch(/^Not undone: the document was changed on the server/);
    // No conflict view (there are no edits to resolve), and the stale undo is not offered again.
    expect(actions.conflicts().size).toBe(0);
    expect(actions.canUndoSave(ID)).toBe(false);
    expect(actions.busy()).toBe(false);
  });

  it('reports a conflict when the document was deleted on the server since', async () => {
    await saveAs('{"_id":{"$numberInt":"1"},"status":"open","total":{"$numberInt":"15"}}');
    server.stored = null;
    expect(await actions.undoSave(ID)).toBe(false);
    expect(server.stored).toBeNull();
    expect(actions.message()?.text).toMatch(/^Not undone: /);
  });

  it('refuses while the document has unsaved edits, and keeps them', async () => {
    await saveAs('{"_id":{"$numberInt":"1"},"status":"open","total":{"$numberInt":"15"}}');
    const saved = server.stored as BsonDocument;
    edits.edit(saved, doc('{"_id":{"$numberInt":"1"},"status":"x","total":{"$numberInt":"15"}}'));

    expect(await actions.undoSave(ID)).toBe(false);

    expect(updates()).toHaveLength(1);
    expect(actions.message()?.text).toMatch(/unsaved edits/);
    expect(edits.isModified(ID)).toBe(true);
    expect(actions.canUndoSave(ID)).toBe(true);
  });

  it('goes through the write guard: production asks first, read-only refuses', async () => {
    await saveAs('{"_id":{"$numberInt":"1"},"status":"open","total":{"$numberInt":"15"}}');
    const safety = TestBed.inject(ProfileSafetyService);
    safety.set({ id: 'p1', name: 'Reports', readOnly: true, production: false });
    expect(await actions.undoSave(ID)).toBe(false);
    expect(actions.message()?.text).toContain('Reports is read-only.');
    expect(actions.canUndoSave(ID)).toBe(true);

    safety.set({ id: 'p1', name: 'Prod', readOnly: false, production: true });
    expect(await actions.undoSave(ID)).toBe(true);
    expect(confirms).toHaveLength(1);
    expect(bsonEquals(server.stored as BsonDocument, doc(ORIGINAL))).toBe(true);
  });

  it('is offered after a conflict Overwrite, and undoes it back to the server version', async () => {
    server.set('total', { type: 'int', value: 20 });
    const serverVersion = server.stored as BsonDocument;
    edits.edit(doc(ORIGINAL), doc('{"_id":{"$numberInt":"1"},"status":"open","total":{"$numberInt":"15"}}'));
    expect(await actions.save(ID)).toBe(false);
    expect(actions.conflicts().has(ID)).toBe(true);
    expect(actions.canUndoSave(ID)).toBe(false);

    expect(await actions.overwrite(ID)).toBe(true);
    expect(actions.canUndoSave(ID)).toBe(true);
    expect(await actions.undoSave(ID)).toBe(true);
    expect(bsonEquals(server.stored as BsonDocument, serverVersion)).toBe(true);
  });

  it('is no longer offered once the document is deleted', async () => {
    fake.respond('docs.delete', { deleted: true });
    await saveAs('{"_id":{"$numberInt":"1"},"status":"open","total":{"$numberInt":"15"}}');
    expect(await actions.delete(server.stored as BsonDocument)).toBe(true);
    expect(actions.canUndoSave(ID)).toBe(false);
  });

  it('keeps the projection rules: under a top-level projection only the shown fields go back', async () => {
    projection = '{"total":{"$numberInt":"1"}}';
    const shown = doc('{"_id":{"$numberInt":"1"},"total":{"$numberInt":"10"}}');
    edits.edit(shown, doc('{"_id":{"$numberInt":"1"},"total":{"$numberInt":"15"}}'), true);
    expect(await actions.save(ID)).toBe(true);
    expect(await actions.undoSave(ID)).toBe(true);
    // status (hidden by the projection) was never touched.
    expect(bsonEquals(server.stored as BsonDocument, doc(ORIGINAL))).toBe(true);
    expect(updates()[1]?.['update']).toBe('{"$set":{"total":{"$numberInt":"10"}}}');
  });
});
