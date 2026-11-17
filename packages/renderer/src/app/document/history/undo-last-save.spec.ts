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
      if (key === '$expr') return current.fields.length === this.fieldCount(value);
      const field = current.fields.find((f) => f.key === key);
      if (value.type !== 'object') throw new Error(`unsupported check ${key}`);
      const check = value.fields[0];
      if (check?.key === '$eq') return field !== undefined && bsonEquals(field.value, check.value);
      if (check?.key === '$exists') return field === undefined;
      if (check?.key === '$type' && check.value.type === 'string') {
        return field?.value.type === check.value.value;
      }
      throw new Error(`unsupported check ${check?.key}`);
    });
  }

  /**
   * The count of `{$eq: [{$size: {$objectToArray: '$$ROOT'}}, n]}`, the only `$expr` the undo
   * sends (the server document must have exactly n fields).
   */
  private fieldCount(expr: BsonValue): number {
    const text = stringifyEJson(expr);
    const match =
      /^\{"\$eq":\[\{"\$size":\{"\$objectToArray":"\$\$ROOT"\}\},\{"\$numberInt":"(\d+)"\}\]\}$/.exec(
        text,
      );
    if (match === null) throw new Error(`unsupported $expr ${text}`);
    return Number(match[1]);
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
    // A replace writes every field, so its conflict check is the whole saved version: every
    // field's saved value and exactly its number of fields (_id is in the filter anyway).
    expect(JSON.parse(undo?.['expected'] as string)).toEqual({
      total: { $eq: { $numberInt: '15' } },
      note: { $eq: 'rush' },
      $expr: {
        $eq: [{ $size: { $objectToArray: '$$ROOT' } }, { $numberInt: '3' }],
      },
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
    edits.edit(
      first,
      doc('{"_id":{"$numberInt":"1"},"status":"paid","total":{"$numberInt":"15"}}'),
    );
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
    edits.edit(
      doc(ORIGINAL),
      doc('{"_id":{"$numberInt":"1"},"status":"open","total":{"$numberInt":"15"}}'),
    );
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

  // Added by the test-writer (undo-last-save).

  it('undoes a save made under a projection that hides sub-fields, touching only the saved field', async () => {
    projection = '{"total":{"$numberInt":"1"},"addr.city":{"$numberInt":"1"}}';
    const shown = doc('{"_id":{"$numberInt":"1"},"total":{"$numberInt":"10"}}');
    edits.edit(shown, doc('{"_id":{"$numberInt":"1"},"total":{"$numberInt":"15"}}'), true, true);
    expect(await actions.save(ID)).toBe(true);
    expect(actions.canUndoSave(ID)).toBe(true);

    expect(await actions.undoSave(ID)).toBe(true);

    expect(bsonEquals(server.stored as BsonDocument, doc(ORIGINAL))).toBe(true);
    expect(updates()[1]).toMatchObject({
      update: '{"$set":{"total":{"$numberInt":"10"}}}',
      expected: '{"total":{"$eq":{"$numberInt":"15"}}}',
    });
    expect(replaces()).toHaveLength(0);
  });

  it('is offered after Merge manually, and undoes it back to the server version', async () => {
    server.set('total', { type: 'int', value: 20 });
    const serverVersion = server.stored as BsonDocument;
    edits.edit(
      doc(ORIGINAL),
      doc('{"_id":{"$numberInt":"1"},"status":"paid","total":{"$numberInt":"15"}}'),
    );
    expect(await actions.save(ID)).toBe(false);
    expect(actions.conflicts().has(ID)).toBe(true);
    expect(actions.canUndoSave(ID)).toBe(false);

    const merged = doc('{"_id":{"$numberInt":"1"},"status":"paid","total":{"$numberInt":"20"}}');
    expect(await actions.saveMerged(ID, merged)).toBe(true);
    expect(bsonEquals(server.stored as BsonDocument, merged)).toBe(true);
    expect(actions.canUndoSave(ID)).toBe(true);

    expect(await actions.undoSave(ID)).toBe(true);
    expect(bsonEquals(server.stored as BsonDocument, serverVersion)).toBe(true);
    expect(actions.canUndoSave(ID)).toBe(false);
  });

  it('a cancelled production confirm writes nothing and keeps the undo', async () => {
    await saveAs('{"_id":{"$numberInt":"1"},"status":"open","total":{"$numberInt":"15"}}');
    const saved = stringifyEJson(server.stored as BsonDocument);
    TestBed.inject(ProfileSafetyService).set({
      id: 'p1',
      name: 'Prod',
      readOnly: false,
      production: true,
    });
    vi.mocked(TestBed.inject(ConfirmService).confirm).mockImplementation((request) => {
      confirms.push(request);
      return Promise.resolve(false);
    });

    expect(await actions.undoSave(ID)).toBe(false);

    expect(confirms).toHaveLength(1);
    expect(updates()).toHaveLength(1);
    expect(stringifyEJson(server.stored as BsonDocument)).toBe(saved);
    expect(actions.message()).toBeNull();
    expect(actions.canUndoSave(ID)).toBe(true);
    expect(actions.busy()).toBe(false);
  });

  it('a failed write (not a conflict) says Not undone and keeps the undo for a retry', async () => {
    await saveAs('{"_id":{"$numberInt":"1"},"status":"open","total":{"$numberInt":"15"}}');
    fake.fail('docs.update', { code: 'NOT_CONNECTED', message: 'Not connected to Local.' });

    expect(await actions.undoSave(ID)).toBe(false);

    expect(actions.message()?.kind).toBe('error');
    expect(actions.message()?.text).toMatch(/^Not undone: /);
    expect(actions.conflicts().size).toBe(0);
    expect(actions.canUndoSave(ID)).toBe(true);
    expect(actions.busy()).toBe(false);

    server.install(fake);
    expect(await actions.undoSave(ID)).toBe(true);
    expect(bsonEquals(server.stored as BsonDocument, doc(ORIGINAL))).toBe(true);
  });

  it('runs one undo at a time: a second click while it is running sends nothing', async () => {
    await saveAs('{"_id":{"$numberInt":"1"},"status":"open","total":{"$numberInt":"15"}}');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    fake.handle('docs.update', async () => {
      await gate;
      server.stored = doc(ORIGINAL);
      return { modified: true };
    });

    const first = actions.undoSave(ID);
    await Promise.resolve();
    expect(actions.isBusy(ID)).toBe(true);
    expect(await actions.undoSave(ID)).toBe(false);
    release();
    expect(await first).toBe(true);

    expect(updates()).toHaveLength(2);
    expect(actions.canUndoSave(ID)).toBe(false);
  });

  it('restores a field removed from the end with the minimal $set (the order already matches)', async () => {
    await saveAs('{"_id":{"$numberInt":"1"},"status":"open"}');

    expect(await actions.undoSave(ID)).toBe(true);

    expect(stringifyEJson(server.stored as BsonDocument)).toBe(ORIGINAL);
    expect(replaces()).toHaveLength(0);
    expect(updates()[1]).toMatchObject({
      update: '{"$set":{"total":{"$numberInt":"10"}}}',
      expected: '{"total":{"$exists":false}}',
    });
  });

  it('restores a removed nested field in its place by replacing the whole document', async () => {
    const nested =
      '{"_id":{"$numberInt":"1"},"addr":{"city":"Springfield","zip":"12345"},"status":"open"}';
    server.stored = doc(nested);
    edits.edit(
      doc(nested),
      doc('{"_id":{"$numberInt":"1"},"addr":{"zip":"12345"},"status":"open"}'),
    );
    // The fake server applies top-level paths only, so the save is checked by what was sent.
    fake.handle('docs.update', (p) => {
      expect(p.update).toBe('{"$unset":{"addr.city":""}}');
      server.stored = doc('{"_id":{"$numberInt":"1"},"addr":{"zip":"12345"},"status":"open"}');
      return { modified: true };
    });
    expect(await actions.save(ID)).toBe(true);
    server.install(fake);

    expect(await actions.undoSave(ID)).toBe(true);

    // $set addr.city would append city after zip: only a replace gives the original order.
    expect(stringifyEJson(server.stored as BsonDocument)).toBe(nested);
    expect(replaces()[0]?.['doc']).toBe(nested);
  });

  // TW-1: the replace path (keepOrder) writes the whole pre-save document, but its conflict check
  // covers only the fields the save changed. A field changed on the server since the save, that
  // the save did not touch, is silently overwritten with its pre-save value.
  it('reports a conflict instead of replacing over a server change to a field the save did not touch', async () => {
    // The save removed status only; the undo needs a replace to put status back before total.
    await saveAs('{"_id":{"$numberInt":"1"},"total":{"$numberInt":"10"}}');
    // Another client changes total, which the save did not touch, so the undo's conflict check
    // (status: {$exists: false}) does not cover it.
    server.set('total', { type: 'int', value: 20 });
    const changedOnServer = stringifyEJson(server.stored as BsonDocument);

    await actions.undoSave(ID);

    // The newer server change must not be overwritten.
    expect(stringifyEJson(server.stored as BsonDocument)).toBe(changedOnServer);
    expect(actions.message()?.text).toMatch(/^Not undone: /);
  });

  // Fixer (CR-1/TW-1): the replace path checks the whole saved version.
  it('reports a conflict instead of replacing over a field added on the server since the save', async () => {
    // The save removed status only; the undo needs a replace to put status back before total.
    await saveAs('{"_id":{"$numberInt":"1"},"total":{"$numberInt":"10"}}');
    server.set('extra', { type: 'string', value: 'added by another client' });
    const changedOnServer = stringifyEJson(server.stored as BsonDocument);

    expect(await actions.undoSave(ID)).toBe(false);

    // The new field is not dropped by a replace.
    expect(stringifyEJson(server.stored as BsonDocument)).toBe(changedOnServer);
    expect(actions.message()?.text).toMatch(/^Not undone: the document was changed on the server/);
    expect(actions.canUndoSave(ID)).toBe(false);
  });

  it('checks a saved null by type on the replace path, and restores the original', async () => {
    const withNull =
      '{"_id":{"$numberInt":"1"},"status":"open","note":null,"total":{"$numberInt":"10"}}';
    server.stored = doc(withNull);
    edits.edit(
      doc(withNull),
      doc('{"_id":{"$numberInt":"1"},"note":null,"total":{"$numberInt":"10"}}'),
    );
    expect(await actions.save(ID)).toBe(true);

    expect(await actions.undoSave(ID)).toBe(true);

    expect(stringifyEJson(server.stored as BsonDocument)).toBe(withNull);
    expect(JSON.parse(replaces()[0]?.['expected'] as string)).toMatchObject({
      note: { $type: 'null' },
      total: { $eq: { $numberInt: '10' } },
    });
  });

  it('falls back to the minimal update when a field name cannot be checked by a query path', async () => {
    const dotted = '{"_id":{"$numberInt":"1"},"status":"open","a.b":{"$numberInt":"1"}}';
    server.stored = doc(dotted);
    edits.edit(doc(dotted), doc('{"_id":{"$numberInt":"1"},"a.b":{"$numberInt":"1"}}'));
    expect(await actions.save(ID)).toBe(true);

    expect(await actions.undoSave(ID)).toBe(true);

    // No whole-document check is possible for "a.b": no replace, status is appended instead.
    expect(replaces()).toHaveLength(0);
    expect(updates()[1]).toMatchObject({
      update: '{"$set":{"status":"open"}}',
      expected: '{"status":{"$exists":false}}',
    });
    expect(stringifyEJson(server.stored as BsonDocument)).toBe(
      '{"_id":{"$numberInt":"1"},"a.b":{"$numberInt":"1"},"status":"open"}',
    );
  });
});
