import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type BsonDocument, parseEJsonDocument, stringifyEJson } from '@thicket/core/bson';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import { ConfirmService, type ConfirmRequest } from '../safety/confirm.service';
import { ProfileSafetyService } from '../safety/profile-safety.service';
import { DocumentActions, type DocumentHost } from './document-actions.service';
import { DocumentEdits } from './edit-session';

/** `{_id: id, total, qty}` as canonical EJSON. */
function orderText(id: number, total = 10 * id, qty = id): string {
  return `{"_id":{"$numberInt":"${id}"},"total":{"$numberInt":"${total}"},"qty":{"$numberInt":"${qty}"}}`;
}
const order = (id: number, total?: number, qty?: number): BsonDocument =>
  parseEJsonDocument(orderText(id, total, qty));
const keyOf = (id: number) => `{"$numberInt":"${id}"}`;

/** A promise the test settles explicitly, to control when an answer arrives. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

// DocumentActions on its own, with a fake host and the fake bridge: the paths the component
// tests do not reach (replace, saveAll stopping, conflict details, read-back, drafts edited in
// the form, busy keys).
describe('DocumentActions', () => {
  let fake: FakeThicketBridge;
  let edits: DocumentEdits;
  let actions: DocumentActions;
  let changed: [string, string | null][];
  let projection: string | undefined;
  let confirms: ConfirmRequest[];
  let confirmAnswer: boolean;

  const host = (): DocumentHost => ({
    profileId: 'p1',
    db: 'shop',
    coll: 'orders',
    projection: () => projection,
    documentChanged: (key, doc) => changed.push([key, doc]),
  });
  const params = (method: Parameters<FakeThicketBridge['requestsFor']>[0]) =>
    fake.requestsFor(method).map((r) => r.params as Record<string, unknown>);

  beforeEach(() => {
    fake = new FakeThicketBridge();
    fake.respond('docs.update', { modified: true });
    fake.respond('docs.replace', { modified: true });
    fake.handle('docs.get', (p) => ({
      doc: orderText(Number(JSON.parse(p.id).$numberInt), 99, 99),
      sliced: [],
    }));
    changed = [];
    projection = undefined;
    confirms = [];
    confirmAnswer = true;
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
      return Promise.resolve(confirmAnswer);
    });
    TestBed.inject(ProfileSafetyService).set({
      id: 'p1',
      name: 'Local',
      readOnly: false,
      production: false,
    });
    edits = TestBed.inject(DocumentEdits);
    actions = TestBed.inject(DocumentActions);
    actions.setHost(host());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses to work before setHost', async () => {
    const fresh = TestBed.runInInjectionContext(() => new DocumentActions());
    await expect(fresh.save(keyOf(1))).rejects.toThrow(/setHost/);
  });

  describe('save', () => {
    it('does nothing for a key without edits', async () => {
      expect(await actions.save(keyOf(1))).toBe(false);
      expect(fake.requests).toHaveLength(0);
    });

    it('sends docs.replace for a top-level reorder, with the whole edited document', async () => {
      const original = parseEJsonDocument('{"_id":{"$numberInt":"1"},"a":"x","b":"y"}');
      const reordered = parseEJsonDocument('{"_id":{"$numberInt":"1"},"b":"y","a":"z"}');
      edits.edit(original, reordered);
      expect(await actions.save(keyOf(1))).toBe(true);
      expect(params('docs.update')).toHaveLength(0);
      expect(params('docs.replace')).toEqual([
        {
          profileId: 'p1',
          db: 'shop',
          coll: 'orders',
          id: keyOf(1),
          doc: '{"_id":{"$numberInt":"1"},"b":"y","a":"z"}',
          expected: '{"a":{"$eq":"x"}}',
        },
      ]);
      expect(edits.modified()).toBe(false);
      expect(actions.message()).toEqual({ kind: 'info', text: 'Saved 1.' });
    });

    it('sends nothing and says why when the _id was edited', async () => {
      edits.edit(order(1), order(5, 10, 1));
      expect(await actions.save(keyOf(1))).toBe(false);
      expect(fake.requests).toHaveLength(0);
      expect(actions.message()?.kind).toBe('error');
      expect(actions.message()?.text).toMatch(/^Not saved: .*_id/);
      expect(edits.isModified(keyOf(1))).toBe(true);
    });

    it('reads the saved document back with the query projection and reports it to the host', async () => {
      projection = '{"total":{"$numberInt":"1"}}';
      edits.edit(order(1), order(1, 15));
      await actions.save(keyOf(1));
      expect(params('docs.get')).toEqual([
        { profileId: 'p1', db: 'shop', coll: 'orders', id: keyOf(1), projection },
      ]);
      expect(changed).toEqual([[keyOf(1), orderText(1, 99, 99)]]);
    });

    it('sends no projection to docs.get without one', async () => {
      edits.edit(order(1), order(1, 15));
      await actions.save(keyOf(1));
      expect(params('docs.get')[0]).not.toHaveProperty('projection');
    });

    it('shows the saved document when it cannot be read back', async () => {
      fake.fail('docs.get', { code: 'SERVER_ERROR', message: 'connection reset' });
      edits.edit(order(1), order(1, 15));
      expect(await actions.save(keyOf(1))).toBe(true);
      expect(changed).toEqual([[keyOf(1), orderText(1, 15)]]);
      expect(actions.message()).toEqual({ kind: 'info', text: 'Saved 1.' });
    });

    it('refuses on a read-only profile, sends nothing and keeps the edits', async () => {
      TestBed.inject(ProfileSafetyService).set({
        id: 'p1',
        name: 'Reports',
        readOnly: true,
        production: false,
      });
      edits.edit(order(1), order(1, 15));
      expect(await actions.save(keyOf(1))).toBe(false);
      expect(fake.requests).toHaveLength(0);
      expect(actions.message()?.kind).toBe('error');
      expect(actions.message()?.text).toContain('Reports is read-only.');
      expect(edits.isModified(keyOf(1))).toBe(true);
    });

    it('says nothing when the production confirm dialog is cancelled', async () => {
      TestBed.inject(ProfileSafetyService).set({
        id: 'p1',
        name: 'Prod',
        readOnly: false,
        production: true,
      });
      confirmAnswer = false;
      edits.edit(order(1), order(1, 15));
      expect(await actions.save(keyOf(1))).toBe(false);
      expect(confirms).toHaveLength(1);
      expect(actions.message()).toBeNull();
      expect(edits.isModified(keyOf(1))).toBe(true);
    });

    it('is busy while the write runs and ignores a second save of the same document', async () => {
      const answer = deferred<{ modified: boolean }>();
      fake.handle('docs.update', () => answer.promise);
      edits.edit(order(1), order(1, 15));
      const first = actions.save(keyOf(1));
      await Promise.resolve();
      expect(actions.isBusy(keyOf(1))).toBe(true);
      expect(actions.busy()).toBe(true);
      expect(await actions.save(keyOf(1))).toBe(false);
      answer.resolve({ modified: true });
      expect(await first).toBe(true);
      expect(params('docs.update')).toHaveLength(1);
      expect(actions.busy()).toBe(false);
    });

    it('keeps an edit made while the save was on its way', async () => {
      const answer = deferred<{ modified: boolean }>();
      fake.handle('docs.update', () => answer.promise);
      const loaded = order(1);
      edits.edit(loaded, order(1, 15));
      const saving = actions.save(keyOf(1));
      await Promise.resolve();
      // The user keeps typing: qty changes after the $set for total was sent.
      edits.edit(loaded, order(1, 15, 4));
      answer.resolve({ modified: true });
      await saving;
      // Only total was saved; the qty edit was never sent and must not be lost.
      expect(params('docs.update')[0]?.['update']).toBe('{"$set":{"total":{"$numberInt":"15"}}}');
      expect(edits.isModified(keyOf(1))).toBe(true);
    });
  });

  describe('conflicts', () => {
    it('keeps the server version when the document changed on the server', async () => {
      fake.fail('docs.update', {
        code: 'CONFLICT',
        message: 'The document changed',
        detail: { current: orderText(1, 77) },
      });
      edits.edit(order(1), order(1, 15));
      expect(await actions.save(keyOf(1))).toBe(false);
      const conflict = actions.conflicts().get(keyOf(1));
      expect(stringifyEJson(conflict?.current as BsonDocument)).toBe(orderText(1, 77));
      expect(actions.message()?.text).toBe(
        'Not saved: the document was changed on the server since it was loaded. Your edits are kept.',
      );
      expect(edits.isModified(keyOf(1))).toBe(true);
      expect(changed).toEqual([]);
    });

    it('says the document was deleted when the conflict has no current version', async () => {
      fake.fail('docs.update', {
        code: 'CONFLICT',
        message: 'The document is gone',
        detail: { current: null },
      });
      edits.edit(order(1), order(1, 15));
      await actions.save(keyOf(1));
      expect(actions.conflicts().get(keyOf(1))).toEqual({ key: keyOf(1), current: null });
      expect(actions.message()?.text).toBe(
        'Not saved: the document was deleted on the server since it was loaded.',
      );
      expect(edits.isModified(keyOf(1))).toBe(true);
    });

    it('still reports a conflict whose detail is malformed', async () => {
      fake.fail('docs.update', { code: 'CONFLICT', message: 'changed', detail: { current: 42 } });
      edits.edit(order(1), order(1, 15));
      await actions.save(keyOf(1));
      expect(actions.conflicts().get(keyOf(1))).toEqual({ key: keyOf(1), current: null });
      expect(actions.message()?.text).toContain('changed on the server');
    });

    it('drops the conflict once the document is saved, and on revertAll', async () => {
      fake.fail('docs.update', { code: 'CONFLICT', message: 'x', detail: { current: null } });
      edits.edit(order(1), order(1, 15));
      edits.edit(order(2), order(2, 25));
      await actions.save(keyOf(1));
      await actions.save(keyOf(2));
      expect(actions.conflicts().size).toBe(2);

      fake.respond('docs.update', { modified: true });
      await actions.save(keyOf(1));
      expect(actions.conflicts().has(keyOf(1))).toBe(false);
      expect(actions.conflicts().has(keyOf(2))).toBe(true);

      actions.revertAll();
      expect(actions.conflicts().size).toBe(0);
      expect(edits.modified()).toBe(false);
      expect(actions.message()).toBeNull();
    });
  });

  describe('saveAll', () => {
    it('saves every edited document, one update each, and counts them', async () => {
      edits.edit(order(1), order(1, 15));
      edits.edit(order(2), order(2, 25));
      expect(await actions.saveAll()).toBe(2);
      expect(params('docs.update').map((p) => p['id'])).toEqual([keyOf(1), keyOf(2)]);
      expect(actions.message()).toEqual({ kind: 'info', text: 'Saved 2 documents.' });
      expect(edits.modified()).toBe(false);
    });

    it('stops at the first document that is not saved', async () => {
      fake.handle('docs.update', (p) =>
        p.id === keyOf(2)
          ? { error: { code: 'SERVER_ERROR', message: 'Document failed validation' } }
          : { modified: true },
      );
      edits.edit(order(1), order(1, 15));
      edits.edit(order(2), order(2, 25));
      edits.edit(order(3), order(3, 35));
      expect(await actions.saveAll()).toBe(1);
      expect(params('docs.update').map((p) => p['id'])).toEqual([keyOf(1), keyOf(2)]);
      expect(edits.documents().map((d) => d.key)).toEqual([keyOf(2), keyOf(3)]);
      expect(actions.message()?.kind).toBe('error');
      expect(actions.message()?.text).toContain('Document failed validation');
    });

    it('saves nothing without edits', async () => {
      expect(await actions.saveAll()).toBe(0);
      expect(fake.requests).toHaveLength(0);
    });
  });

  describe('delete', () => {
    it('always asks, then deletes and tells the host', async () => {
      fake.respond('docs.delete', { deleted: true });
      edits.edit(order(1), order(1, 15));
      expect(await actions.delete(order(1))).toBe(true);
      expect(confirms).toHaveLength(1);
      expect(params('docs.delete')).toEqual([
        { profileId: 'p1', db: 'shop', coll: 'orders', id: keyOf(1), confirmed: true },
      ]);
      expect(edits.modified()).toBe(false);
      expect(changed).toEqual([[keyOf(1), null]]);
      expect(actions.message()?.text).toBe('Deleted 1.');
    });

    it('says when the document was already deleted', async () => {
      fake.respond('docs.delete', { deleted: false });
      await actions.delete(order(1));
      expect(actions.message()?.text).toBe('1 was already deleted.');
      expect(changed).toEqual([[keyOf(1), null]]);
    });

    it('keeps the document and its edits when the dialog is cancelled', async () => {
      confirmAnswer = false;
      edits.edit(order(1), order(1, 15));
      expect(await actions.delete(order(1))).toBe(false);
      expect(fake.requests).toHaveLength(0);
      expect(edits.isModified(keyOf(1))).toBe(true);
      expect(changed).toEqual([]);
    });

    it('cannot delete a document without an _id', async () => {
      expect(await actions.delete(parseEJsonDocument('{"name":"no id"}'))).toBe(false);
      expect(confirms).toHaveLength(0);
    });
  });

  describe('drafts', () => {
    it('adds new drafts first, each with a fresh ObjectId _id', () => {
      const a = actions.newDocument();
      const b = actions.newDocument();
      expect(actions.drafts().map((d) => d.id)).toEqual([b.id, a.id]);
      expect(a.title).toBe('New document');
      const idA = a.doc.fields[0];
      const idB = b.doc.fields[0];
      expect(idA?.key).toBe('_id');
      expect(idA?.value.type).toBe('objectId');
      expect(stringifyEJson(idA?.value as never)).not.toBe(stringifyEJson(idB?.value as never));
    });

    it('clones a document without an _id as "Copy", the new _id first', () => {
      const draft = actions.cloneDocument(
        parseEJsonDocument('{"name":"Ada","n":{"$numberInt":"1"}}'),
      );
      expect(draft.title).toBe('Copy');
      expect(draft.doc.fields.map((f) => f.key)).toEqual(['_id', 'name', 'n']);
    });

    it('inserts a draft as edited in the form', async () => {
      fake.respond('docs.insert', { insertedIds: [keyOf(42)] });
      const draft = actions.newDocument();
      const edited = parseEJsonDocument('{"_id":{"$numberInt":"42"},"name":"Grace Example"}');
      actions.editDraft(draft.id, edited);
      expect(await actions.insertDraft(draft.id)).toBe(true);
      expect(params('docs.insert')).toEqual([
        {
          profileId: 'p1',
          db: 'shop',
          coll: 'orders',
          docs: ['{"_id":{"$numberInt":"42"},"name":"Grace Example"}'],
        },
      ]);
      expect(actions.drafts()).toEqual([]);
      expect(actions.message()?.text).toBe(
        'Inserted 42. Run the query again to see it in the results.',
      );
    });

    it('editing one draft leaves the others alone', () => {
      const a = actions.newDocument();
      const b = actions.newDocument();
      actions.editDraft(a.id, parseEJsonDocument('{"_id":{"$numberInt":"7"}}'));
      expect(actions.drafts().find((d) => d.id === b.id)?.doc).toBe(b.doc);
    });

    it('says "the document" when the server returns no inserted id', async () => {
      fake.respond('docs.insert', { insertedIds: [] });
      const draft = actions.newDocument();
      await actions.insertDraft(draft.id);
      expect(actions.message()?.text).toBe(
        'Inserted the document. Run the query again to see it in the results.',
      );
    });

    it('shows an inserted id that is not EJSON as sent by the server', async () => {
      fake.respond('docs.insert', { insertedIds: ['not-ejson'] });
      const draft = actions.newDocument();
      expect(await actions.insertDraft(draft.id)).toBe(true);
      expect(actions.message()?.text).toBe(
        'Inserted not-ejson. Run the query again to see it in the results.',
      );
    });

    it('keeps the draft when the insert fails', async () => {
      fake.fail('docs.insert', { code: 'SERVER_ERROR', message: 'E11000 duplicate key error' });
      const draft = actions.newDocument();
      expect(await actions.insertDraft(draft.id)).toBe(false);
      expect(actions.drafts()).toHaveLength(1);
      expect(actions.message()?.text).toContain('E11000 duplicate key error');
    });

    it('does nothing for an unknown draft', async () => {
      expect(await actions.insertDraft(-1)).toBe(false);
      expect(fake.requests).toHaveLength(0);
    });

    it('ignores a second insert of the same draft while the first runs', async () => {
      const answer = deferred<{ insertedIds: string[] }>();
      fake.handle('docs.insert', () => answer.promise);
      const draft = actions.newDocument();
      const first = actions.insertDraft(draft.id);
      await Promise.resolve();
      expect(actions.isBusy(`draft:${draft.id}`)).toBe(true);
      expect(await actions.insertDraft(draft.id)).toBe(false);
      answer.resolve({ insertedIds: [] });
      expect(await first).toBe(true);
      expect(params('docs.insert')).toHaveLength(1);
    });
  });
});
