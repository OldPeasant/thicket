import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type BsonDocument, parseEJsonDocument, stringifyEJson } from '@thicket/core/bson';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  documentKey,
  DocumentEdits,
  type EditedDocument,
  idOf,
  pendingSave,
  UNDO_LIMIT,
} from './edit-session';

/** `{_id: id, total, qty}` as a model document (Int32 numbers). */
function order(id: number, total = 10 * id, qty = id): BsonDocument {
  return parseEJsonDocument(
    `{"_id":{"$numberInt":"${id}"},"total":{"$numberInt":"${total}"},"qty":{"$numberInt":"${qty}"}}`,
  );
}

const doc = (ejson: string): BsonDocument => parseEJsonDocument(ejson);
const ejson = (d: BsonDocument) => stringifyEJson(d);

// DocumentEdits on its own: the per-tab edit session (change count, undo/redo, discard).
describe('DocumentEdits', () => {
  let edits: DocumentEdits;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), DocumentEdits],
    });
    edits = TestBed.inject(DocumentEdits);
  });

  it('starts empty', () => {
    expect(edits.modified()).toBe(false);
    expect(edits.changeCount()).toBe(0);
    expect(edits.documents()).toEqual([]);
    expect(edits.canUndo()).toBe(false);
    expect(edits.canRedo()).toBe(false);
    // Undo and redo on an empty history do nothing.
    edits.undo();
    edits.redo();
    expect(edits.modified()).toBe(false);
  });

  it('records an edit, keyed by the canonical EJSON of the _id', () => {
    const loaded = order(1);
    expect(edits.edit(loaded, order(1, 15))).toBe(true);
    const key = '{"$numberInt":"1"}';
    expect(edits.isModified(key)).toBe(true);
    expect(edits.get(key)?.original).toBe(loaded);
    expect(ejson(edits.current(loaded))).toBe(ejson(order(1, 15)));
    expect(edits.changeCount()).toBe(1);
    expect(edits.canUndo()).toBe(true);
  });

  it('returns the document itself when it has no edits', () => {
    const loaded = order(2);
    expect(edits.current(loaded)).toBe(loaded);
    edits.edit(order(1), order(1, 15));
    expect(edits.current(loaded)).toBe(loaded);
  });

  it('ignores an edit that changes nothing', () => {
    expect(edits.edit(order(1), order(1))).toBe(false);
    expect(edits.modified()).toBe(false);
    expect(edits.canUndo()).toBe(false);
  });

  it('ignores documents without an _id', () => {
    const noId = doc('{"name":"Ada Example"}');
    expect(edits.edit(noId, doc('{"name":"Grace Example"}'))).toBe(false);
    expect(edits.modified()).toBe(false);
    expect(edits.canUndo()).toBe(false);
    expect(edits.current(noId)).toBe(noId);
  });

  it('keeps the loaded version as original over several edits, shown as edited', () => {
    const loaded = order(1);
    edits.edit(loaded, order(1, 15));
    // The view passes the loaded document again with the next edited version.
    edits.edit(loaded, order(1, 15, 4));
    const entry = edits.get('{"$numberInt":"1"}');
    expect(entry?.original).toBe(loaded);
    expect(ejson(entry?.current as BsonDocument)).toBe(ejson(order(1, 15, 4)));
    expect(edits.changeCount()).toBe(2);
    expect(edits.documents()).toHaveLength(1);
  });

  it('clears the modified state when a document is edited back to its loaded version', () => {
    const loaded = order(1);
    edits.edit(loaded, order(1, 15));
    expect(edits.edit(loaded, order(1))).toBe(true);
    expect(edits.modified()).toBe(false);
    expect(edits.changeCount()).toBe(0);
    expect(edits.current(loaded)).toBe(loaded);
    // The edit back can still be undone: the document is modified again.
    expect(edits.canUndo()).toBe(true);
    edits.undo();
    expect(edits.modified()).toBe(true);
    expect(ejson(edits.current(loaded))).toBe(ejson(order(1, 15)));
  });

  it('lists edited documents in the order they were first edited and sums their changes', () => {
    edits.edit(order(3), order(3, 31));
    edits.edit(order(1), order(1, 11, 2));
    edits.edit(order(3), order(3, 32));
    expect(edits.documents().map((d) => d.key)).toEqual([
      '{"$numberInt":"3"}',
      '{"$numberInt":"1"}',
    ]);
    expect(edits.changeCount()).toBe(3);
  });

  it('undoes and redoes across documents in edit order; a new edit drops the redo history', () => {
    edits.edit(order(1), order(1, 15));
    edits.edit(order(2), order(2, 25));
    edits.undo();
    expect(edits.isModified('{"$numberInt":"2"}')).toBe(false);
    expect(edits.isModified('{"$numberInt":"1"}')).toBe(true);
    expect(edits.canRedo()).toBe(true);
    edits.redo();
    expect(edits.isModified('{"$numberInt":"2"}')).toBe(true);
    expect(edits.canRedo()).toBe(false);

    edits.undo();
    edits.edit(order(3), order(3, 35));
    expect(edits.canRedo()).toBe(false);
    expect(edits.documents().map((d) => d.key)).toEqual([
      '{"$numberInt":"1"}',
      '{"$numberInt":"3"}',
    ]);
  });

  it(`keeps at most UNDO_LIMIT (${UNDO_LIMIT}) edits for undo, dropping the oldest`, () => {
    const loaded = order(1);
    for (let i = 1; i <= UNDO_LIMIT + 1; i++) edits.edit(loaded, order(1, 1000 + i));
    for (let i = 0; i < UNDO_LIMIT; i++) edits.undo();
    expect(edits.canUndo()).toBe(false);
    // The first edit fell out of the history: undoing everything left stops after it.
    expect(ejson(edits.current(loaded))).toBe(ejson(order(1, 1001)));
    expect(edits.modified()).toBe(true);
    edits.redo();
    expect(ejson(edits.current(loaded))).toBe(ejson(order(1, 1002)));
  });

  it('discards one document: its edits and its undo and redo steps go, the others stay', () => {
    edits.edit(order(1), order(1, 15));
    edits.edit(order(2), order(2, 25));
    edits.edit(order(1), order(1, 15, 4));
    edits.edit(order(2), order(2, 26));
    edits.undo(); // the last edit of document 2 is on the redo stack now

    edits.discard('{"$numberInt":"2"}');
    expect(edits.isModified('{"$numberInt":"2"}')).toBe(false);
    expect(edits.canRedo()).toBe(false);
    // Undo walks document 1's edits only.
    edits.undo();
    expect(ejson(edits.current(order(1)))).toBe(ejson(order(1, 15)));
    edits.undo();
    expect(edits.modified()).toBe(false);
    expect(edits.canUndo()).toBe(false);
  });

  it('discarding a key without edits changes nothing', () => {
    edits.edit(order(1), order(1, 15));
    edits.discard('{"$numberInt":"9"}');
    expect(edits.documents()).toHaveLength(1);
    expect(edits.canUndo()).toBe(true);
  });

  it('discards everything with discardAll', () => {
    edits.edit(order(1), order(1, 15));
    edits.edit(order(2), order(2, 25));
    edits.undo();
    edits.discardAll();
    expect(edits.modified()).toBe(false);
    expect(edits.canUndo()).toBe(false);
    expect(edits.canRedo()).toBe(false);
  });

  it('reports a document whose _id was edited as not savable', () => {
    edits.edit(order(1), order(7, 10, 1));
    const pending = edits.pending().get('{"$numberInt":"1"}');
    expect(pending).toMatchObject({ ok: false, changes: 1 });
    expect(pending?.ok === false && pending.error).toMatch(/_id of a document cannot be changed/);
    expect(edits.changeCount()).toBe(1);
  });
});

describe('pendingSave', () => {
  const entry = (original: BsonDocument, current: BsonDocument): EditedDocument => ({
    key: documentKey(original) ?? '',
    original,
    current,
  });

  it('counts the update operations of an update', () => {
    const p = pendingSave(entry(order(1), order(1, 15, 4)));
    expect(p.ok).toBe(true);
    expect(p.changes).toBe(2);
    expect(p.ok && p.diff.kind).toBe('update');
  });

  it('counts a removed and an added field', () => {
    const p = pendingSave(entry(doc('{"_id":1,"a":1,"b":2}'), doc('{"_id":1,"a":1,"c":3}')));
    expect(p).toMatchObject({ ok: true, changes: 2 });
  });

  it('saves a top-level reorder as a replace, counting the changed top-level fields', () => {
    const p = pendingSave(
      entry(doc('{"_id":1,"a":1,"b":2,"c":3}'), doc('{"_id":1,"b":2,"a":5,"c":3}')),
    );
    expect(p.ok).toBe(true);
    if (!p.ok || p.diff.kind !== 'replace') throw new Error('expected a replace');
    expect(p.changes).toBe(1);
    expect(p.diff.changedFields).toEqual(['a']);
  });

  it('counts at least one change for a pure top-level reorder', () => {
    const p = pendingSave(entry(doc('{"_id":1,"a":1,"b":2}'), doc('{"_id":1,"b":2,"a":1}')));
    expect(p.ok).toBe(true);
    expect(p.ok && p.diff.kind).toBe('replace');
    expect(p.changes).toBeGreaterThanOrEqual(1);
  });

  it('reports an unchanged document as nothing to save', () => {
    expect(pendingSave(entry(order(1), order(1)))).toEqual({
      ok: false,
      error: 'Nothing changed.',
      changes: 0,
    });
  });

  it('reports a top-level $ field name in a replace as not savable', () => {
    const p = pendingSave(entry(doc('{"_id":1,"a":1,"b":2}'), doc('{"_id":1,"b":2,"$a":1}')));
    expect(p.ok).toBe(false);
    expect(p.ok === false && p.error).toMatch(/starting with \$/);
  });
});

describe('documentKey and idOf', () => {
  it('use the first _id', () => {
    const d = doc('{"name":"x","_id":{"$oid":"0123456789abcdef01234567"}}');
    expect(documentKey(d)).toBe('{"$oid":"0123456789abcdef01234567"}');
    expect(idOf(d)).toEqual({ type: 'objectId', hex: '0123456789abcdef01234567' });
  });

  it('are null without an _id', () => {
    expect(documentKey(doc('{"a":1}'))).toBeNull();
    expect(idOf(doc('{"a":1}'))).toBeNull();
  });
});
