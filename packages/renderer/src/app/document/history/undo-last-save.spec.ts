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

const MISSING = Symbol('missing');

/** The whole-document check's condition that field `key` equals `value` (plain JSON of EJSON). */
const fieldEq = (key: string, value: unknown) => ({
  $eq: [{ $getField: { field: { $literal: key }, input: '$$ROOT' } }, { $literal: value }],
});
/** The condition that field `key` has the type `type` (null, BSON undefined). */
const fieldType = (key: string, type: string) => ({
  $eq: [{ $type: { $getField: { field: { $literal: key }, input: '$$ROOT' } } }, type],
});
/** The whole-document check: one `$expr` with every field condition, then the field count. */
const wholeCheck = (conditions: unknown[], count: number) => ({
  $expr: {
    $and: [
      ...conditions,
      { $eq: [{ $size: { $objectToArray: '$$ROOT' } }, { $numberInt: String(count) }] },
    ],
  },
});

/**
 * A one-document server: `docs.update` applies top-level `$set`/`$unset` only when every
 * `expected` check (`$eq`, `$exists: false`, `$type`, and the `$expr` of the undo's whole-document
 * check, see `evaluate`) matches the stored document, as MongoDB's filter would; otherwise it
 * answers CONFLICT with the current version. `docs.get` returns it. Anything else in a check
 * throws.
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
      if (key === '$expr') return this.truthy(current, value);
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

  private truthy(current: BsonDocument, expr: BsonValue): boolean {
    const result = this.evaluate(current, expr);
    return result !== MISSING && result.type === 'bool' && result.value;
  }

  /**
   * The aggregation expressions of the undo's whole-document check, and nothing else: `$and`,
   * `$eq` (whole values by `bsonEquals`, so an array that only contains the value does not match;
   * stricter than MongoDB across numeric types), `$literal`, `$getField` of `$$ROOT` by a
   * `$literal` name, `$type` (`missing`, `null`, `undefined`, otherwise the value's type) and
   * `{$size: {$objectToArray: '$$ROOT'}}`. A constant (a string not starting with `$`, a number)
   * is itself.
   */
  private evaluate(current: BsonDocument, expr: BsonValue): BsonValue | typeof MISSING {
    if (expr.type === 'string' ? !expr.value.startsWith('$') : expr.type !== 'object') return expr;
    const only = expr.type === 'object' && expr.fields.length === 1 ? expr.fields[0] : undefined;
    const arg = only?.value;
    const bool = (value: boolean): BsonValue => ({ type: 'bool', value });
    switch (only?.key) {
      case '$literal':
        return arg as BsonValue;
      case '$and':
        if (arg?.type !== 'array') break;
        return bool(arg.items.every((e) => this.truthy(current, e)));
      case '$eq': {
        if (arg?.type !== 'array' || arg.items.length !== 2) break;
        const [a, b] = arg.items.map((e) => this.evaluate(current, e));
        if (a === MISSING || b === MISSING) return bool(a === b);
        return bool(bsonEquals(a as BsonValue, b as BsonValue));
      }
      case '$type': {
        const v = this.evaluate(current, arg as BsonValue);
        return { type: 'string', value: v === MISSING ? 'missing' : v.type };
      }
      case '$getField': {
        const match = /^\{"field":\{"\$literal":(".*")\},"input":"\$\$ROOT"\}$/.exec(
          stringifyEJson(arg as BsonValue),
        );
        if (match === null) break;
        const name = JSON.parse(match[1] as string) as string;
        return current.fields.find((f) => f.key === name)?.value ?? MISSING;
      }
      case '$size':
        if (stringifyEJson(arg as BsonValue) !== '{"$objectToArray":"$$ROOT"}') break;
        return { type: 'int', value: current.fields.length };
    }
    throw new Error(`unsupported $expr ${stringifyEJson(expr)}`);
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
    expect(JSON.parse(undo?.['expected'] as string)).toEqual(
      wholeCheck([fieldEq('total', { $numberInt: '15' }), fieldEq('note', 'rush')], 3),
    );
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
    expect(JSON.parse(replaces()[0]?.['expected'] as string)).toEqual(
      wholeCheck([fieldType('note', 'null'), fieldEq('total', { $numberInt: '10' })], 3),
    );
  });

  it('checks a field name that is not a query path by its literal name on the replace path', async () => {
    const dotted = '{"_id":{"$numberInt":"1"},"status":"open","a.b":{"$numberInt":"1"}}';
    server.stored = doc(dotted);
    edits.edit(doc(dotted), doc('{"_id":{"$numberInt":"1"},"a.b":{"$numberInt":"1"}}'));
    expect(await actions.save(ID)).toBe(true);

    expect(await actions.undoSave(ID)).toBe(true);

    // "a.b" is compared with $getField, so the replace restores the original order.
    expect(stringifyEJson(server.stored as BsonDocument)).toBe(dotted);
    expect(JSON.parse(replaces()[0]?.['expected'] as string)).toEqual(
      wholeCheck([fieldEq('a.b', { $numberInt: '1' })], 2),
    );
  });

  // Added by the test-writer (round 2): the whole-document check of the replace path.

  const TYPED =
    '{"_id":{"$numberInt":"1"},"status":"open",' +
    '"placed":{"$date":{"$numberLong":"1768471200000"}},' +
    '"ref":{"$oid":"650000000000000000000001"},' +
    '"total":{"$numberDecimal":"10.50"},' +
    '"addr":{"city":"Springfield","zip":"12345"},' +
    '"tags":["gift","rush"]}';
  const TYPED_SAVED =
    '{"_id":{"$numberInt":"1"},' +
    '"placed":{"$date":{"$numberLong":"1768471200000"}},' +
    '"ref":{"$oid":"650000000000000000000001"},' +
    '"total":{"$numberDecimal":"10.50"},' +
    '"addr":{"city":"Springfield","zip":"12345"},' +
    '"tags":["gift","rush"]}';

  /** Loads TYPED, removes status (not the last field) and saves: the undo must be a replace. */
  async function saveTypedWithoutStatus(): Promise<void> {
    server.stored = doc(TYPED);
    edits.edit(doc(TYPED), doc(TYPED_SAVED));
    expect(await actions.save(ID)).toBe(true);
    expect(stringifyEJson(server.stored as BsonDocument)).toBe(TYPED_SAVED);
  }

  it('checks Date, ObjectId, Decimal128, embedded document and array values by $eq with their BSON types', async () => {
    await saveTypedWithoutStatus();

    expect(await actions.undoSave(ID)).toBe(true);

    expect(stringifyEJson(server.stored as BsonDocument)).toBe(TYPED);
    expect(replaces()).toHaveLength(1);
    expect(JSON.parse(replaces()[0]?.['expected'] as string)).toEqual(
      wholeCheck(
        [
          fieldEq('placed', { $date: { $numberLong: '1768471200000' } }),
          fieldEq('ref', { $oid: '650000000000000000000001' }),
          fieldEq('total', { $numberDecimal: '10.50' }),
          fieldEq('addr', { city: 'Springfield', zip: '12345' }),
          fieldEq('tags', ['gift', 'rush']),
        ],
        6,
      ),
    );
  });

  it.each([
    ['a sub-field of an embedded document', 'addr', '{"city":"Shelbyville","zip":"12345"}'],
    ['the order of an embedded document', 'addr', '{"zip":"12345","city":"Springfield"}'],
    ['a Date', 'placed', '{"$date":{"$numberLong":"1769904000000"}}'],
    ['an ObjectId', 'ref', '{"$oid":"650000000000000000000002"}'],
    ['an array item', 'tags', '["gift"]'],
  ])(
    'reports a conflict on the replace path when %s changed on the server',
    async (_what, key, value) => {
      await saveTypedWithoutStatus();
      server.set(key, parseEJsonDocument(`{"v":${value}}`).fields[0]?.value as BsonValue);
      const changedOnServer = stringifyEJson(server.stored as BsonDocument);

      expect(await actions.undoSave(ID)).toBe(false);

      expect(stringifyEJson(server.stored as BsonDocument)).toBe(changedOnServer);
      expect(actions.message()?.text).toMatch(
        /^Not undone: the document was changed on the server/,
      );
      expect(actions.canUndoSave(ID)).toBe(false);
    },
  );

  it('reports a conflict on the replace path when a field the save did not touch was removed on the server', async () => {
    await saveTypedWithoutStatus();
    const stored = server.stored as BsonDocument;
    server.stored = { type: 'object', fields: stored.fields.filter((f) => f.key !== 'tags') };
    const changedOnServer = stringifyEJson(server.stored);

    expect(await actions.undoSave(ID)).toBe(false);

    expect(stringifyEJson(server.stored as BsonDocument)).toBe(changedOnServer);
    expect(actions.canUndoSave(ID)).toBe(false);
  });

  // A save that only reorders top-level fields is a replace whose own conflict check is empty (no
  // value changed): its undo must still check the whole saved version.
  it('checks the whole saved version when undoing a save that only reordered fields', async () => {
    const reordered = '{"_id":{"$numberInt":"1"},"total":{"$numberInt":"10"},"status":"open"}';
    await saveAs(reordered);
    expect(stringifyEJson(server.stored as BsonDocument)).toBe(reordered);
    expect(replaces()).toHaveLength(1);

    expect(await actions.undoSave(ID)).toBe(true);

    expect(stringifyEJson(server.stored as BsonDocument)).toBe(ORIGINAL);
    expect(JSON.parse(replaces()[1]?.['expected'] as string)).toEqual(
      wholeCheck([fieldEq('total', { $numberInt: '10' }), fieldEq('status', 'open')], 3),
    );
  });

  it('reports a conflict instead of undoing a reorder over a newer server change', async () => {
    await saveAs('{"_id":{"$numberInt":"1"},"total":{"$numberInt":"10"},"status":"open"}');
    server.set('status', { type: 'string', value: 'shipped' });
    const changedOnServer = stringifyEJson(server.stored as BsonDocument);

    expect(await actions.undoSave(ID)).toBe(false);

    expect(stringifyEJson(server.stored as BsonDocument)).toBe(changedOnServer);
    expect(actions.message()?.text).toMatch(/^Not undone: the document was changed on the server/);
  });

  it('counts a field the save added in the whole-document check', async () => {
    // status removed (the undo is a replace) and note added: the saved version has 3 fields.
    await saveAs('{"_id":{"$numberInt":"1"},"total":{"$numberInt":"10"},"note":"rush"}');

    expect(await actions.undoSave(ID)).toBe(true);

    expect(stringifyEJson(server.stored as BsonDocument)).toBe(ORIGINAL);
    expect(JSON.parse(replaces()[0]?.['expected'] as string)).toEqual(
      wholeCheck([fieldEq('total', { $numberInt: '10' }), fieldEq('note', 'rush')], 3),
    );
  });

  // Added by the fixer (round 2).

  // CR-1: query `$eq` also matches an array that contains the value; the whole-document check
  // compares whole values inside `$expr`, so such a server change conflicts.
  it('reports a conflict on the replace path when a field became an array containing its saved value', async () => {
    await saveAs('{"_id":{"$numberInt":"1"},"total":{"$numberInt":"10"}}');
    server.set('total', {
      type: 'array',
      items: [
        { type: 'int', value: 10 },
        { type: 'int', value: 20 },
      ],
    });
    const changedOnServer = stringifyEJson(server.stored as BsonDocument);

    expect(await actions.undoSave(ID)).toBe(false);

    expect(stringifyEJson(server.stored as BsonDocument)).toBe(changedOnServer);
    expect(actions.message()?.text).toMatch(/^Not undone: the document was changed on the server/);
    // No per-field query operator: everything is in the `$expr`.
    expect(Object.keys(JSON.parse(replaces()[0]?.['expected'] as string))).toEqual(['$expr']);
  });

  // TW-2: MongoDB adds an update's fields in field-name order, so the undo's `$set` of the removed
  // total and qty would store qty first; only a replace restores total, qty.
  it('restores the last two fields removed in one save in their original order by a replace', async () => {
    const withQty =
      '{"_id":{"$numberInt":"1"},"status":"open","total":{"$numberInt":"10"},' +
      '"qty":{"$numberInt":"2"}}';
    server.stored = doc(withQty);
    edits.edit(doc(withQty), doc('{"_id":{"$numberInt":"1"},"status":"open"}'));
    expect(await actions.save(ID)).toBe(true);

    expect(await actions.undoSave(ID)).toBe(true);

    expect(replaces()).toHaveLength(1);
    expect(stringifyEJson(server.stored as BsonDocument)).toBe(withQty);
  });

  // TW-3: the undo checks the document as the server stored it (read back after the save), not as
  // it was sent: MongoDB stored the two added sub-fields in name order.
  it('checks the version the server stored (read back after the save), not the one sent', async () => {
    const nested = '{"_id":{"$numberInt":"1"},"addr":{"city":"Springfield"}}';
    const stored = '{"_id":{"$numberInt":"1"},"addr":{"city":"Springfield","apt":"","zip":""}}';
    server.stored = doc(nested);
    edits.edit(
      doc(nested),
      doc('{"_id":{"$numberInt":"1"},"addr":{"city":"Springfield","zip":"","apt":""}}'),
    );
    // The fake server applies top-level paths only: the save and the undo are checked by what
    // was sent.
    fake.handle('docs.update', (p) => {
      if (updates().length === 1) {
        expect(p.update).toBe('{"$set":{"addr.zip":"","addr.apt":""}}');
        server.stored = doc(stored);
      } else {
        expect(p.update).toBe('{"$unset":{"addr.apt":"","addr.zip":""}}');
        expect(p.expected).toBe('{"addr":{"$eq":{"city":"Springfield","apt":"","zip":""}}}');
        server.stored = doc(nested);
      }
      return { modified: true };
    });
    expect(await actions.save(ID)).toBe(true);

    expect(await actions.undoSave(ID)).toBe(true);

    expect(stringifyEJson(server.stored as BsonDocument)).toBe(nested);
    expect(replaces()).toHaveLength(0);
  });

  it('does not take a read-back with other values as the saved version, so a newer change conflicts', async () => {
    // The save removes status; right after it, before the read-back, another client adds a field.
    fake.handle('docs.update', () => {
      server.stored = doc('{"_id":{"$numberInt":"1"},"total":{"$numberInt":"10"},"note":"x"}');
      return { modified: true };
    });
    await saveAs('{"_id":{"$numberInt":"1"},"total":{"$numberInt":"10"}}');
    server.install(fake);
    const changedOnServer = stringifyEJson(server.stored as BsonDocument);

    expect(await actions.undoSave(ID)).toBe(false);

    // The replace's check expects the version the save wrote (2 fields), so note is not dropped.
    expect(stringifyEJson(server.stored as BsonDocument)).toBe(changedOnServer);
    expect(JSON.parse(replaces()[0]?.['expected'] as string)).toEqual(
      wholeCheck([fieldEq('total', { $numberInt: '10' })], 2),
    );
  });

  // Added by the test-writer (round 3): which version the undo checks against. A whole read-back
  // (no projection, nothing sliced, parsed) that holds what was sent is taken as stored; in every
  // other case the undo checks the version modelled from the save (`applyUpdate`, MongoDB's
  // field-name order). To tell the two apart, this server stores the two added sub-fields in the
  // order they were sent (zip, apt), unlike the model (apt, zip).
  describe('saved version: read-back or model', () => {
    const NESTED = '{"_id":{"$numberInt":"1"},"addr":{"city":"Springfield"}}';
    const SENT = '{"_id":{"$numberInt":"1"},"addr":{"city":"Springfield","zip":"","apt":""}}';
    const AS_STORED = '{"addr":{"$eq":{"city":"Springfield","zip":"","apt":""}}}';
    const AS_MODELLED = '{"addr":{"$eq":{"city":"Springfield","apt":"","zip":""}}}';

    type ReadBack = 'whole' | 'fails' | 'null' | 'unparseable' | 'sliced' | 'projection';

    /** Saves two added sub-fields, reads back as `readBack` says; returns the undo's check. */
    async function undoCheckAfter(readBack: ReadBack): Promise<string | undefined> {
      server.stored = doc(NESTED);
      if (readBack === 'projection') projection = '{"addr":{"$numberInt":"1"}}';
      edits.edit(doc(NESTED), doc(SENT), readBack === 'projection');
      fake.handle('docs.update', () => {
        server.stored = doc(updates().length === 1 ? SENT : NESTED);
        return { modified: true };
      });
      fake.handle('docs.get', () => {
        if (readBack === 'fails') return { error: { code: 'TIMEOUT', message: 'timed out' } };
        if (readBack === 'null') return { doc: null, sliced: [] };
        if (readBack === 'unparseable') return { doc: '{not ejson', sliced: [] };
        const sliced = readBack === 'sliced' ? [{ path: 'addr', total: 3, loaded: 1 }] : [];
        return { doc: stringifyEJson(server.stored as BsonDocument), sliced };
      });
      expect(await actions.save(ID)).toBe(true);
      expect(actions.canUndoSave(ID)).toBe(true);
      await actions.undoSave(ID);
      return updates()[1]?.['expected'] as string | undefined;
    }

    it('takes a whole read-back that holds what was sent as the saved version, in its stored order', async () => {
      expect(await undoCheckAfter('whole')).toBe(AS_STORED);
      expect(stringifyEJson(server.stored as BsonDocument)).toBe(NESTED);
      expect(replaces()).toHaveLength(0);
    });

    it.each<[string, ReadBack]>([
      ['the read-back fails', 'fails'],
      ['the document read back is gone (null)', 'null'],
      ['the read-back does not parse', 'unparseable'],
      ['the read-back has sliced arrays', 'sliced'],
      ['the save was made under a projection', 'projection'],
    ])('checks the modelled MongoDB order when %s', async (_what, readBack) => {
      expect(await undoCheckAfter(readBack)).toBe(AS_MODELLED);
      expect(replaces()).toHaveLength(0);
    });
  });

  // Added by the test-writer (round 3): the recorded assumptions.

  it('a conflicting undo of a document deleted on the server opens no conflict view and drops the undo', async () => {
    await saveAs('{"_id":{"$numberInt":"1"},"status":"open","total":{"$numberInt":"15"}}');
    server.stored = null;

    expect(await actions.undoSave(ID)).toBe(false);

    expect(server.stored).toBeNull();
    expect(actions.message()).toEqual({
      kind: 'error',
      text:
        'Not undone: the document was changed on the server since the save. Nothing was ' +
        'overwritten; run the query again to see the current version.',
    });
    expect(actions.conflicts().size).toBe(0);
    expect(actions.canUndoSave(ID)).toBe(false);
    expect(actions.busy()).toBe(false);
    expect(fake.requestsFor('docs.insert')).toHaveLength(0);
  });

  it('is not offered after inserting a document deleted on the server again (not a save)', async () => {
    server.stored = null;
    fake.handle('docs.insert', (p) => {
      server.stored = doc(p.docs[0] as string);
      return { insertedIds: [ID] };
    });
    const edited = '{"_id":{"$numberInt":"1"},"status":"open","total":{"$numberInt":"15"}}';
    edits.edit(doc(ORIGINAL), doc(edited));
    expect(await actions.save(ID)).toBe(false);
    expect(actions.conflicts().get(ID)?.current).toBeNull();

    expect(await actions.overwrite(ID)).toBe(true);

    expect(stringifyEJson(server.stored as unknown as BsonDocument)).toBe(edited);
    expect(actions.canUndoSave(ID)).toBe(false);
    expect(await actions.undoSave(ID)).toBe(false);
    expect(updates()).toHaveLength(1);
    expect(replaces()).toHaveLength(0);
  });

  it('refuses with its own text an undo that would replace a whole field loaded under a projection', async () => {
    const withAddr = '{"_id":{"$numberInt":"1"},"status":"open","addr":{"city":"Springfield"}}';
    server.stored = doc(withAddr);
    projection = '{"addr":{"$numberInt":"1"}}';
    const shown = doc('{"_id":{"$numberInt":"1"},"addr":{"city":"Springfield"}}');
    // A scalar $set is allowed under the projection; setting the document back would not be.
    edits.edit(shown, doc('{"_id":{"$numberInt":"1"},"addr":"unknown"}'), true);
    expect(await actions.save(ID)).toBe(true);
    const saved = stringifyEJson(server.stored as BsonDocument);

    expect(await actions.undoSave(ID)).toBe(false);

    expect(actions.message()).toEqual({
      kind: 'error',
      text:
        'Not undone: this document was loaded only partly, so restoring the old version could ' +
        'change data that was not loaded.',
    });
    expect(updates()).toHaveLength(1);
    expect(replaces()).toHaveLength(0);
    expect(stringifyEJson(server.stored as BsonDocument)).toBe(saved);
  });

  // Repeated top-level keys (kept by the EJSON parser): the whole-document check can't be built,
  // so the undo falls back to the diff's own replace and its changed-field check.
  describe('a document with repeated top-level keys', () => {
    const REPEATED =
      '{"_id":{"$numberInt":"1"},"status":"open","tag":"a","tag":"b","total":{"$numberInt":"10"}}';
    const SAVED =
      '{"_id":{"$numberInt":"1"},"status":"open","tag":"a","tag":"b","total":{"$numberInt":"15"}}';

    async function saveRepeated(): Promise<void> {
      server.stored = doc(REPEATED);
      edits.edit(doc(REPEATED), doc(SAVED));
      expect(await actions.save(ID)).toBe(true);
      expect(stringifyEJson(server.stored as BsonDocument)).toBe(SAVED);
    }

    it('save, undo last save: the server document equals the original again', async () => {
      await saveRepeated();

      expect(await actions.undoSave(ID)).toBe(true);

      expect(stringifyEJson(server.stored as BsonDocument)).toBe(REPEATED);
      expect(replaces()).toHaveLength(2);
      expect(replaces()[1]?.['expected']).toBe('{"total":{"$eq":{"$numberInt":"15"}}}');
    });

    it('reports a conflict when the field the save changed was changed on the server since', async () => {
      await saveRepeated();
      server.set('total', { type: 'int', value: 20 });
      const changedOnServer = stringifyEJson(server.stored as BsonDocument);

      expect(await actions.undoSave(ID)).toBe(false);

      expect(stringifyEJson(server.stored as BsonDocument)).toBe(changedOnServer);
      expect(actions.message()?.text).toMatch(
        /^Not undone: the document was changed on the server/,
      );
    });

    // AC2: any change on the server since the save conflicts. The undo is a replace of every
    // field, but this fallback checks only the field the save changed.
    it('reports a conflict instead of replacing over a server change to a field the save did not touch', async () => {
      await saveRepeated();
      server.set('status', { type: 'string', value: 'shipped' });
      const changedOnServer = stringifyEJson(server.stored as BsonDocument);

      await actions.undoSave(ID);

      expect(stringifyEJson(server.stored as BsonDocument)).toBe(changedOnServer);
      expect(actions.message()?.text).toMatch(
        /^Not undone: the document was changed on the server/,
      );
    });
  });
});
