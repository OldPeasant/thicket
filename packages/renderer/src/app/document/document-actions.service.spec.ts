import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type BsonDocument, parseEJsonDocument, stringifyEJson } from '@thicket/core/bson';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import { ConfirmService, type ConfirmRequest } from '../safety/confirm.service';
import { ProfileSafetyService } from '../safety/profile-safety.service';
import {
  DocumentActions,
  type DocumentHost,
  isTopLevelProjection,
  visibleFields,
} from './document-actions.service';
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
      // The saved state is the new baseline: only the qty edit is left to save.
      expect(stringifyEJson(edits.get(keyOf(1))?.original as BsonDocument)).toBe(orderText(1, 15));
      expect(stringifyEJson(edits.get(keyOf(1))?.current as BsonDocument)).toBe(
        orderText(1, 15, 4),
      );
      expect(edits.canUndo()).toBe(false);
      await actions.save(keyOf(1));
      expect(params('docs.update')[1]).toMatchObject({
        update: '{"$set":{"qty":{"$numberInt":"4"}}}',
        expected: '{"qty":{"$eq":{"$numberInt":"1"}}}',
      });
      expect(edits.modified()).toBe(false);
    });

    it('keeps showing the saved version, not the loaded one, while it is read back', async () => {
      const readBack = deferred<{ doc: string; sliced: never[] }>();
      fake.handle('docs.get', () => readBack.promise);
      edits.edit(order(1), order(1, 15));
      const saving = actions.save(keyOf(1));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(params('docs.get')).toHaveLength(1);
      expect(stringifyEJson(edits.current(order(1)))).toBe(orderText(1, 15));
      readBack.resolve({ doc: orderText(1, 15), sliced: [] });
      expect(await saving).toBe(true);
      expect(edits.modified()).toBe(false);
    });
  });

  describe('save with a projection active', () => {
    const PROJECTION_REFUSED =
      'Not saved: with a projection active, this edit would replace data the projection hides. ' +
      'Clear the projection and edit again.';
    const PARTIAL_REFUSED =
      'Not saved: this document was loaded only partly (with a projection, or a large document ' +
      'whose long arrays are read page by page), and this edit would replace data that was not ' +
      'loaded. Edit single values instead, or run the query without a projection and edit again.';
    const loaded = parseEJsonDocument(
      '{"_id":{"$numberInt":"1"},"a":"x","b":"y","addr":{"city":"Bonn"},"tags":["p"]}',
    );
    const withFields = (fields: string) =>
      parseEJsonDocument(`{"_id":{"$numberInt":"1"},${fields}}`);

    beforeEach(() => {
      projection = '{"a":{"$numberInt":"1"},"b":{"$numberInt":"1"},"addr.city":{"$numberInt":"1"}}';
    });

    it('refuses a whole-document replace, sends nothing and keeps the edits', async () => {
      edits.edit(loaded, withFields('"b":"y","a":"x","addr":{"city":"Bonn"},"tags":["p"]'));
      expect(await actions.save(keyOf(1))).toBe(false);
      expect(fake.requests).toHaveLength(0);
      expect(actions.message()).toEqual({ kind: 'error', text: PROJECTION_REFUSED });
      expect(edits.isModified(keyOf(1))).toBe(true);
    });

    it('refuses to $set a document or array the loaded document has', async () => {
      edits.edit(loaded, withFields('"a":"x","b":"y","addr":["Bonn"],"tags":["p"]'));
      expect(await actions.save(keyOf(1))).toBe(false);
      edits.discardAll();
      edits.edit(loaded, withFields('"a":"x","b":"y","addr":{"city":"Bonn"},"tags":["q"]'));
      expect(await actions.save(keyOf(1))).toBe(false);
      expect(fake.requests).toHaveLength(0);
      expect(actions.message()?.text).toBe(PROJECTION_REFUSED);
    });

    it('sends scalar $set, $unset, $push and new documents at new paths', async () => {
      edits.edit(
        loaded,
        withFields('"a":"z","addr":{"city":"Köln"},"tags":["p","q"],"extra":{"n":"1"}'),
      );
      expect(await actions.save(keyOf(1))).toBe(true);
      expect(params('docs.update')[0]?.['update']).toBe(
        '{"$set":{"a":"z","addr.city":"Köln","extra":{"n":"1"}},"$unset":{"b":""},"$push":{"tags":{"$each":["q"]}}}',
      );
    });

    it('checks nested paths: refuses a nested container the loaded document has, sends a new one', async () => {
      const nested = parseEJsonDocument(
        '{"_id":{"$numberInt":"1"},"addr":{"city":"Bonn","geo":{"lat":"50.7"}}}',
      );
      // addr.geo existed (maybe partially projected): replacing it by an array is refused.
      edits.edit(
        nested,
        parseEJsonDocument('{"_id":{"$numberInt":"1"},"addr":{"city":"Bonn","geo":["50.7"]}}'),
      );
      expect(await actions.save(keyOf(1))).toBe(false);
      expect(fake.requests).toHaveLength(0);
      expect(actions.message()?.text).toBe(PROJECTION_REFUSED);
      edits.discardAll();
      // addr.zone is new: setting a sub-document there hides nothing.
      edits.edit(
        nested,
        parseEJsonDocument(
          '{"_id":{"$numberInt":"1"},"addr":{"city":"Bonn","geo":{"lat":"50.7"},"zone":{"n":"1"}}}',
        ),
      );
      expect(await actions.save(keyOf(1))).toBe(true);
      expect(params('docs.update')[0]?.['update']).toBe('{"$set":{"addr.zone":{"n":"1"}}}');
    });

    it('still refuses when the document was edited under a projection that is cleared now', async () => {
      edits.edit(loaded, withFields('"b":"y","a":"x","addr":{"city":"Bonn"},"tags":["p"]'), true);
      projection = undefined;
      expect(await actions.save(keyOf(1))).toBe(false);
      expect(fake.requests).toHaveLength(0);
      expect(actions.message()?.text).toBe(PARTIAL_REFUSED);
      // Undo and redo keep the flag.
      edits.undo();
      edits.redo();
      expect(edits.get(keyOf(1))?.partial).toBe(true);
      expect(await actions.save(keyOf(1))).toBe(false);
    });

    it('keeps refusing a later replace after a partial document was saved and the projection cleared', async () => {
      const answer = deferred<{ modified: boolean }>();
      fake.handle('docs.update', () => answer.promise);
      edits.edit(loaded, withFields('"a":"z","b":"y","addr":{"city":"Bonn"},"tags":["p"]'), true);
      const saving = actions.save(keyOf(1));
      await Promise.resolve();
      // While the scalar $set runs, the user reorders the top-level fields (a replace).
      edits.edit(loaded, withFields('"b":"y","a":"z","addr":{"city":"Bonn"},"tags":["p"]'), true);
      answer.resolve({ modified: true });
      expect(await saving).toBe(true);
      expect(params('docs.update')[0]?.['update']).toBe('{"$set":{"a":"z"}}');
      // The saved (projected) version is the new baseline; it is still partial.
      expect(edits.get(keyOf(1))?.partial).toBe(true);
      projection = undefined;
      expect(await actions.save(keyOf(1))).toBe(false);
      expect(params('docs.replace')).toHaveLength(0);
      expect(actions.message()?.text).toBe(PARTIAL_REFUSED);
      expect(edits.isModified(keyOf(1))).toBe(true);
    });

    it('still sends docs.replace without a projection', async () => {
      projection = undefined;
      edits.edit(loaded, withFields('"b":"y","a":"x","addr":{"city":"Bonn"},"tags":["p"]'));
      expect(await actions.save(keyOf(1))).toBe(true);
      expect(params('docs.replace')).toHaveLength(1);
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

    it('reads the server version again when the conflict detail is malformed', async () => {
      projection = '{"total":{"$numberInt":"1"}}';
      fake.fail('docs.update', { code: 'CONFLICT', message: 'changed', detail: { current: 42 } });
      edits.edit(order(1), order(1, 15));
      await actions.save(keyOf(1));
      // Read in full, without the query's projection.
      expect(params('docs.get')).toEqual([
        { profileId: 'p1', db: 'shop', coll: 'orders', id: keyOf(1) },
      ]);
      const conflict = actions.conflicts().get(keyOf(1));
      expect(stringifyEJson(conflict?.current as BsonDocument)).toBe(orderText(1, 99, 99));
      expect(actions.message()?.text).toContain('changed on the server');
      expect(actions.resolveBlocker(keyOf(1))).toBeNull();
    });

    it.each([
      ['no detail', undefined],
      ['a server version that is not EJSON', { current: '{not ejson' }],
    ])('reads the server version again for %s', async (_name, detail) => {
      fake.fail('docs.update', { code: 'CONFLICT', message: 'changed', detail });
      edits.edit(order(1), order(1, 15));
      await actions.save(keyOf(1));
      expect(params('docs.get')).toHaveLength(1);
      const conflict = actions.conflicts().get(keyOf(1));
      expect(stringifyEJson(conflict?.current as BsonDocument)).toBe(orderText(1, 99, 99));
    });

    it('says deleted only when the reread finds no document', async () => {
      fake.fail('docs.update', { code: 'CONFLICT', message: 'x', detail: { current: 42 } });
      fake.respond('docs.get', { doc: null, sliced: [] });
      edits.edit(order(1), order(1, 15));
      await actions.save(keyOf(1));
      expect(actions.conflicts().get(keyOf(1))).toEqual({ key: keyOf(1), current: null });
      expect(actions.message()?.text).toBe(
        'Not saved: the document was deleted on the server since it was loaded.',
      );

      fake.fail('docs.get', { code: 'NOT_FOUND', message: 'No document with this _id' });
      edits.edit(order(2), order(2, 25));
      await actions.save(keyOf(2));
      expect(actions.conflicts().get(keyOf(2))).toEqual({ key: keyOf(2), current: null });
    });

    it('keeps the server version unknown when the reread fails', async () => {
      fake.fail('docs.update', { code: 'CONFLICT', message: 'x', detail: { current: 42 } });
      fake.fail('docs.get', { code: 'SERVER_ERROR', message: 'connection reset' });
      edits.edit(order(1), order(1, 15));
      expect(await actions.save(keyOf(1))).toBe(false);
      expect(actions.isBusy(keyOf(1))).toBe(false);
      expect(actions.conflicts().get(keyOf(1))).toStrictEqual({
        key: keyOf(1),
        current: undefined,
      });
      expect(actions.message()?.text).toBe(
        'Not saved: the document was changed on the server since it was loaded. Your edits are kept.',
      );
      expect(actions.resolveBlocker(keyOf(1))).toBe('server-unknown');
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

  describe('conflict resolution', () => {
    const PROJECTION_RESOLVE_REFUSED =
      'Not saved: the document was loaded with a projection that hides parts of fields or is no ' +
      'longer active, so this could change data you did not load. Clear the projection, run the ' +
      'query again and edit again.';
    const SERVER_UNKNOWN_REFUSED =
      "Not saved: the server's current version of the document could not be read. Keep the " +
      'server version, then edit again.';

    /** Edits order 1 (total 10 → 15) and saves it into a conflict with `server`. */
    async function conflictWith(server: string | null): Promise<void> {
      fake.fail('docs.update', { code: 'CONFLICT', message: 'x', detail: { current: server } });
      edits.edit(order(1), order(1, 15));
      expect(await actions.save(keyOf(1))).toBe(false);
      fake.respond('docs.update', { modified: true });
      fake.respond('docs.replace', { modified: true });
      fake.respond('docs.insert', { insertedIds: [keyOf(1)] });
      fake.requests.length = 0;
    }

    it('overwrite writes the local version with the new server version as the conflict check', async () => {
      await conflictWith(orderText(1, 77, 3));
      expect(await actions.overwrite(keyOf(1))).toBe(true);
      expect(params('docs.update')).toEqual([
        {
          profileId: 'p1',
          db: 'shop',
          coll: 'orders',
          id: keyOf(1),
          update: '{"$set":{"total":{"$numberInt":"15"},"qty":{"$numberInt":"1"}}}',
          expected: '{"total":{"$eq":{"$numberInt":"77"}},"qty":{"$eq":{"$numberInt":"3"}}}',
        },
      ]);
      expect(actions.conflicts().size).toBe(0);
      expect(edits.modified()).toBe(false);
      expect(changed.at(-1)?.[0]).toBe(keyOf(1));
    });

    it('overwrite reports a new conflict when the server changed again', async () => {
      await conflictWith(orderText(1, 77));
      fake.fail('docs.update', {
        code: 'CONFLICT',
        message: 'x',
        detail: { current: orderText(1, 88) },
      });
      expect(await actions.overwrite(keyOf(1))).toBe(false);
      const conflict = actions.conflicts().get(keyOf(1));
      expect(stringifyEJson(conflict?.current as BsonDocument)).toBe(orderText(1, 88));
      expect(stringifyEJson(edits.get(keyOf(1))?.current as BsonDocument)).toBe(orderText(1, 15));
    });

    it('overwrite inserts the local version again when the server deleted it', async () => {
      await conflictWith(null);
      expect(await actions.overwrite(keyOf(1))).toBe(true);
      expect(params('docs.insert')).toEqual([
        { profileId: 'p1', db: 'shop', coll: 'orders', docs: [orderText(1, 15)] },
      ]);
      expect(actions.conflicts().size).toBe(0);
      expect(edits.modified()).toBe(false);
    });

    it('overwrite refuses to insert a document loaded with a projection', async () => {
      await conflictWith(null);
      projection = '{"total":{"$numberInt":"1"}}';
      expect(await actions.overwrite(keyOf(1))).toBe(false);
      expect(fake.requests).toHaveLength(0);
      expect(actions.message()?.text).toMatch(/^Not inserted: with a projection/);
    });

    it('overwrite with a projection compares only the loaded fields (hidden ones are not unset)', async () => {
      projection = '{"total":{"$numberInt":"1"}}';
      const loaded = parseEJsonDocument('{"_id":{"$numberInt":"1"},"total":{"$numberInt":"10"}}');
      fake.fail('docs.update', {
        code: 'CONFLICT',
        message: 'x',
        detail: { current: orderText(1, 77, 3) },
      });
      edits.edit(
        loaded,
        parseEJsonDocument('{"_id":{"$numberInt":"1"},"total":{"$numberInt":"15"}}'),
        true,
      );
      await actions.save(keyOf(1));
      fake.respond('docs.update', { modified: true });
      fake.requests.length = 0;
      expect(await actions.overwrite(keyOf(1))).toBe(true);
      expect(params('docs.update')[0]).toMatchObject({
        update: '{"$set":{"total":{"$numberInt":"15"}}}',
        expected: '{"total":{"$eq":{"$numberInt":"77"}}}',
      });
    });

    it('keepServer discards the edits and shows the server version', async () => {
      await conflictWith(orderText(1, 77));
      await actions.keepServer(keyOf(1));
      expect(fake.requestsFor('docs.update')).toHaveLength(0);
      expect(edits.modified()).toBe(false);
      expect(actions.conflicts().size).toBe(0);
      expect(changed.at(-1)).toEqual([keyOf(1), orderText(1, 99, 99)]);
      expect(actions.message()?.text).toMatch(/Kept the server version/);
    });

    it('keepServer of a deleted document removes it from the page', async () => {
      await conflictWith(null);
      await actions.keepServer(keyOf(1));
      expect(changed.at(-1)).toEqual([keyOf(1), null]);
      expect(edits.modified()).toBe(false);
    });

    it('saveMerged saves the merged document over the server version', async () => {
      await conflictWith(orderText(1, 77, 3));
      expect(await actions.saveMerged(keyOf(1), order(1, 15, 3))).toBe(true);
      expect(params('docs.update')).toEqual([
        expect.objectContaining({
          update: '{"$set":{"total":{"$numberInt":"15"}}}',
          expected: '{"total":{"$eq":{"$numberInt":"77"}}}',
        }),
      ]);
      expect(actions.conflicts().size).toBe(0);
      expect(edits.modified()).toBe(false);
    });

    it('saveMerged equal to the server version writes nothing and keeps it', async () => {
      await conflictWith(orderText(1, 77, 3));
      expect(await actions.saveMerged(keyOf(1), order(1, 77, 3))).toBe(true);
      expect(fake.requestsFor('docs.update')).toHaveLength(0);
      expect(actions.conflicts().size).toBe(0);
      expect(edits.modified()).toBe(false);
    });

    it('saveMerged refuses a document with another _id', async () => {
      await conflictWith(orderText(1, 77));
      expect(await actions.saveMerged(keyOf(1), order(2, 15))).toBe(false);
      expect(fake.requests).toHaveLength(0);
      expect(actions.message()?.text).toMatch(/must keep the _id/);
      expect(actions.conflicts().size).toBe(1);
    });

    it('does nothing for a key without a conflict', async () => {
      edits.edit(order(1), order(1, 15));
      expect(await actions.overwrite(keyOf(1))).toBe(false);
      expect(await actions.saveMerged(keyOf(1), order(1, 15))).toBe(false);
      await actions.keepServer(keyOf(1));
      expect(fake.requests).toHaveLength(0);
      expect(edits.isModified(keyOf(1))).toBe(true);
    });

    const useProfile = (readOnly: boolean, production: boolean) =>
      TestBed.inject(ProfileSafetyService).set({
        id: 'p1',
        name: readOnly ? 'Reports' : 'Prod',
        readOnly,
        production,
      });

    it('overwrite on a production profile asks first, showing the updateOne', async () => {
      await conflictWith(orderText(1, 77));
      useProfile(false, true);
      expect(await actions.overwrite(keyOf(1))).toBe(true);
      expect(confirms).toHaveLength(1);
      expect(confirms[0]?.operation).toContain('updateOne(');
      expect(confirms[0]?.operation).toContain('total: 15');
      expect(params('docs.update')[0]).toMatchObject({ confirmed: true });
      expect(actions.conflicts().size).toBe(0);
    });

    it('overwrite cancelled in the confirm dialog sends nothing and keeps the conflict and edits', async () => {
      await conflictWith(orderText(1, 77));
      useProfile(false, true);
      confirmAnswer = false;
      expect(await actions.overwrite(keyOf(1))).toBe(false);
      expect(confirms).toHaveLength(1);
      expect(fake.requests).toHaveLength(0);
      expect(actions.message()).toBeNull();
      expect(actions.conflicts().has(keyOf(1))).toBe(true);
      expect(stringifyEJson(edits.get(keyOf(1))?.current as BsonDocument)).toBe(orderText(1, 15));
      expect(actions.isBusy(keyOf(1))).toBe(false);
    });

    it('overwrite is refused on a read-only profile', async () => {
      await conflictWith(orderText(1, 77));
      useProfile(true, false);
      expect(await actions.overwrite(keyOf(1))).toBe(false);
      expect(fake.requests).toHaveLength(0);
      expect(actions.message()?.text).toContain('Reports is read-only.');
      expect(actions.conflicts().has(keyOf(1))).toBe(true);
      expect(edits.isModified(keyOf(1))).toBe(true);
    });

    it('overwrite that fails for another reason keeps the conflict and the local version', async () => {
      await conflictWith(orderText(1, 77));
      fake.fail('docs.update', { code: 'SERVER_ERROR', message: 'Document failed validation' });
      expect(await actions.overwrite(keyOf(1))).toBe(false);
      expect(actions.message()?.text).toMatch(/^Not saved: .*Document failed validation/s);
      expect(actions.conflicts().has(keyOf(1))).toBe(true);
      expect(stringifyEJson(edits.get(keyOf(1))?.current as BsonDocument)).toBe(orderText(1, 15));
      expect(changed).toEqual([]);
    });

    it('overwrite ignores a second click while the first write runs', async () => {
      await conflictWith(orderText(1, 77));
      const answer = deferred<{ modified: boolean }>();
      fake.handle('docs.update', () => answer.promise);
      const first = actions.overwrite(keyOf(1));
      await Promise.resolve();
      expect(actions.isBusy(keyOf(1))).toBe(true);
      expect(await actions.overwrite(keyOf(1))).toBe(false);
      expect(await actions.saveMerged(keyOf(1), order(1, 15, 3))).toBe(false);
      answer.resolve({ modified: true });
      expect(await first).toBe(true);
      expect(params('docs.update')).toHaveLength(1);
    });

    it('overwrite with nothing left to write (the server has the local version) keeps it', async () => {
      await conflictWith(orderText(1, 15));
      expect(await actions.overwrite(keyOf(1))).toBe(true);
      expect(fake.requestsFor('docs.update')).toHaveLength(0);
      expect(actions.conflicts().size).toBe(0);
      expect(edits.modified()).toBe(false);
    });

    it('overwrite does nothing when no edits are left (undone after the conflict)', async () => {
      await conflictWith(orderText(1, 77));
      edits.undo();
      expect(edits.isModified(keyOf(1))).toBe(false);
      expect(await actions.overwrite(keyOf(1))).toBe(false);
      expect(fake.requests).toHaveLength(0);
      expect(actions.conflicts().has(keyOf(1))).toBe(true);
      // Keep server version still resolves it.
      await actions.keepServer(keyOf(1));
      expect(actions.conflicts().size).toBe(0);
      expect(changed.at(-1)).toEqual([keyOf(1), orderText(1, 99, 99)]);
    });

    it('overwrite and merge are refused for a document edited under a since-cleared projection', async () => {
      const loaded = parseEJsonDocument('{"_id":{"$numberInt":"1"},"total":{"$numberInt":"10"}}');
      fake.fail('docs.update', {
        code: 'CONFLICT',
        message: 'x',
        detail: { current: orderText(1, 77, 3) },
      });
      edits.edit(
        loaded,
        parseEJsonDocument('{"_id":{"$numberInt":"1"},"total":{"$numberInt":"15"}}'),
        true,
      );
      await actions.save(keyOf(1));
      fake.respond('docs.update', { modified: true });
      fake.requests.length = 0;
      projection = undefined;
      expect(actions.isPartial(keyOf(1))).toBe(true);
      expect(actions.resolveBlocker(keyOf(1))).toBe('projection');
      expect(await actions.overwrite(keyOf(1))).toBe(false);
      expect(actions.message()?.text).toBe(PROJECTION_RESOLVE_REFUSED);
      expect(await actions.saveMerged(keyOf(1), order(1, 15, 3))).toBe(false);
      expect(fake.requests).toHaveLength(0);
      expect(actions.conflicts().has(keyOf(1))).toBe(true);
      expect(stringifyEJson(edits.get(keyOf(1))?.original as BsonDocument)).toBe(
        stringifyEJson(loaded),
      );
    });

    describe('with a projection that hides parts of fields', () => {
      const loaded = parseEJsonDocument(
        '{"_id":{"$numberInt":"1"},"addr":{"city":"Bonn"},"tags":["p"]}',
      );
      const server =
        '{"_id":{"$numberInt":"1"},"addr":{"city":"Köln","street":"Hauptstr. 1"},"tags":["p","q"]}';

      async function projectedConflict(query: string): Promise<void> {
        projection = query;
        fake.fail('docs.update', { code: 'CONFLICT', message: 'x', detail: { current: server } });
        edits.edit(
          loaded,
          parseEJsonDocument('{"_id":{"$numberInt":"1"},"addr":{"city":"Berlin"},"tags":["p"]}'),
        );
        expect(await actions.save(keyOf(1))).toBe(false);
        fake.respond('docs.update', { modified: true });
        fake.requests.length = 0;
      }

      it.each([
        ['a dotted path', '{"addr.city":{"$numberInt":"1"},"tags":{"$numberInt":"1"}}'],
        ['$slice', '{"addr":{"$numberInt":"1"},"tags":{"$slice":{"$numberInt":"1"}}}'],
        ['$elemMatch', '{"addr":{"$numberInt":"1"},"tags":{"$elemMatch":{"$eq":"p"}}}'],
      ])(
        'refuses overwrite and merge under %s, never unsetting hidden sub-fields',
        async (_name, query) => {
          await projectedConflict(query);
          expect(actions.resolveBlocker(keyOf(1))).toBe('projection');
          expect(await actions.overwrite(keyOf(1))).toBe(false);
          expect(actions.message()?.text).toBe(PROJECTION_RESOLVE_REFUSED);
          const merged = parseEJsonDocument(
            '{"_id":{"$numberInt":"1"},"addr":{"city":"Berlin"},"tags":["p"]}',
          );
          expect(await actions.saveMerged(keyOf(1), merged)).toBe(false);
          expect(fake.requests).toHaveLength(0);
          expect(actions.conflicts().has(keyOf(1))).toBe(true);
          expect(edits.isModified(keyOf(1))).toBe(true);
          // Keep server version stays available.
          await actions.keepServer(keyOf(1));
          expect(actions.conflicts().size).toBe(0);
          expect(edits.modified()).toBe(false);
        },
      );
    });

    it('allows overwrite under an exclusion projection of top-level fields; hidden ones stay', async () => {
      projection = '{"qty":{"$numberInt":"0"}}';
      const loaded = parseEJsonDocument('{"_id":{"$numberInt":"1"},"total":{"$numberInt":"10"}}');
      fake.fail('docs.update', {
        code: 'CONFLICT',
        message: 'x',
        detail: { current: orderText(1, 77, 3) },
      });
      edits.edit(
        loaded,
        parseEJsonDocument('{"_id":{"$numberInt":"1"},"total":{"$numberInt":"15"}}'),
      );
      await actions.save(keyOf(1));
      fake.respond('docs.update', { modified: true });
      fake.requests.length = 0;
      expect(actions.resolveBlocker(keyOf(1))).toBeNull();
      expect(await actions.overwrite(keyOf(1))).toBe(true);
      expect(params('docs.update')[0]).toMatchObject({
        update: '{"$set":{"total":{"$numberInt":"15"}}}',
        expected: '{"total":{"$eq":{"$numberInt":"77"}}}',
      });
    });

    it('cancelled, refused or failed overwrites leave the edit session as it was', async () => {
      await conflictWith(orderText(1, 77, 3));
      edits.edit(order(1), order(1, 15, 4));
      const before = edits.get(keyOf(1));
      const unchanged = () => {
        expect(edits.get(keyOf(1))).toEqual(before);
        expect(edits.canUndo()).toBe(true);
        expect(actions.conflicts().has(keyOf(1))).toBe(true);
      };
      // Cancelled in the production confirm dialog.
      useProfile(false, true);
      confirmAnswer = false;
      expect(await actions.overwrite(keyOf(1))).toBe(false);
      expect(await actions.saveMerged(keyOf(1), order(1, 15, 3))).toBe(false);
      unchanged();
      // Refused on a read-only profile.
      useProfile(true, false);
      expect(await actions.overwrite(keyOf(1))).toBe(false);
      unchanged();
      // Failed for another reason, and a new conflict.
      useProfile(false, false);
      fake.fail('docs.update', { code: 'SERVER_ERROR', message: 'Document failed validation' });
      expect(await actions.overwrite(keyOf(1))).toBe(false);
      unchanged();
      fake.fail('docs.update', {
        code: 'CONFLICT',
        message: 'x',
        detail: { current: orderText(1, 88) },
      });
      expect(await actions.saveMerged(keyOf(1), order(1, 15, 3))).toBe(false);
      unchanged();
      // Undo still walks the user's own edits from the loaded version.
      edits.undo();
      expect(stringifyEJson(edits.get(keyOf(1))?.current as BsonDocument)).toBe(orderText(1, 15));
      // A plain Save still checks against the loaded version, not the server version shown.
      fake.respond('docs.update', { modified: true });
      fake.requests.length = 0;
      edits.redo();
      expect(await actions.save(keyOf(1))).toBe(true);
      expect(params('docs.update')[0]).toMatchObject({
        expected: '{"total":{"$eq":{"$numberInt":"10"}},"qty":{"$eq":{"$numberInt":"1"}}}',
      });
    });

    it('a successful overwrite or merge leaves no unsaved edits and no undo steps for the document', async () => {
      await conflictWith(orderText(1, 77, 3));
      edits.edit(order(2), order(2, 25));
      expect(await actions.overwrite(keyOf(1))).toBe(true);
      expect(edits.isModified(keyOf(1))).toBe(false);
      // Only document 2's step is left.
      edits.undo();
      expect(edits.canUndo()).toBe(false);
      expect(edits.modified()).toBe(false);
      edits.redo();

      fake.fail('docs.update', {
        code: 'CONFLICT',
        message: 'x',
        detail: { current: orderText(1, 88) },
      });
      edits.edit(order(1), order(1, 16));
      expect(await actions.save(keyOf(1))).toBe(false);
      fake.respond('docs.update', { modified: true });
      expect(await actions.saveMerged(keyOf(1), order(1, 16, 5))).toBe(true);
      expect(edits.isModified(keyOf(1))).toBe(false);
      edits.undo();
      expect(edits.isModified(keyOf(2))).toBe(false);
      expect(edits.canUndo()).toBe(false);
    });

    it('overwrite and merge are refused while the server version is unknown; keep server reads it', async () => {
      fake.fail('docs.update', { code: 'CONFLICT', message: 'x', detail: { current: 42 } });
      fake.fail('docs.get', { code: 'SERVER_ERROR', message: 'connection reset' });
      edits.edit(order(1), order(1, 15));
      await actions.save(keyOf(1));
      fake.respond('docs.update', { modified: true });
      fake.requests.length = 0;
      expect(await actions.overwrite(keyOf(1))).toBe(false);
      expect(actions.message()?.text).toBe(SERVER_UNKNOWN_REFUSED);
      expect(await actions.saveMerged(keyOf(1), order(1, 15))).toBe(false);
      expect(fake.requestsFor('docs.update')).toHaveLength(0);
      expect(fake.requestsFor('docs.insert')).toHaveLength(0);
      expect(edits.isModified(keyOf(1))).toBe(true);

      // Still unreadable: the page keeps its loaded version (not removed, not replaced).
      await actions.keepServer(keyOf(1));
      expect(changed).toEqual([]);
      expect(edits.modified()).toBe(false);
      expect(actions.conflicts().size).toBe(0);
    });

    it('keep server version of an unknown server version shows it once readable', async () => {
      fake.fail('docs.update', { code: 'CONFLICT', message: 'x', detail: { current: 42 } });
      fake.fail('docs.get', { code: 'SERVER_ERROR', message: 'connection reset' });
      edits.edit(order(1), order(1, 15));
      await actions.save(keyOf(1));
      fake.respond('docs.get', { doc: orderText(1, 99, 99), sliced: [] });
      await actions.keepServer(keyOf(1));
      expect(changed).toEqual([[keyOf(1), orderText(1, 99, 99)]]);
    });

    it('re-insert on a production profile asks first, showing the insertOne', async () => {
      await conflictWith(null);
      useProfile(false, true);
      expect(await actions.overwrite(keyOf(1))).toBe(true);
      expect(confirms).toHaveLength(1);
      expect(confirms[0]?.operation).toMatch(/insert/i);
      expect(params('docs.insert')[0]).toMatchObject({ confirmed: true });
    });

    it('re-insert that fails keeps the conflict and the local version', async () => {
      await conflictWith(null);
      fake.fail('docs.insert', { code: 'SERVER_ERROR', message: 'E11000 duplicate key error' });
      expect(await actions.overwrite(keyOf(1))).toBe(false);
      expect(actions.message()?.text).toMatch(/^Not inserted: .*duplicate key/s);
      expect(actions.conflicts().has(keyOf(1))).toBe(true);
      expect(edits.isModified(keyOf(1))).toBe(true);
    });

    it('re-insert shows the local version when it cannot be read back', async () => {
      await conflictWith(null);
      fake.fail('docs.get', { code: 'SERVER_ERROR', message: 'connection reset' });
      expect(await actions.overwrite(keyOf(1))).toBe(true);
      expect(changed.at(-1)).toEqual([keyOf(1), orderText(1, 15)]);
      expect(actions.message()?.text).toBe('Inserted your version again.');
    });

    it('keepServer reads the server version back with the query projection', async () => {
      await conflictWith(orderText(1, 77));
      projection = '{"total":{"$numberInt":"1"}}';
      await actions.keepServer(keyOf(1));
      expect(params('docs.get')).toEqual([
        { profileId: 'p1', db: 'shop', coll: 'orders', id: keyOf(1), projection },
      ]);
    });

    it('keepServer shows the server version from the conflict when it cannot be read back', async () => {
      await conflictWith(orderText(1, 77, 3));
      fake.fail('docs.get', { code: 'SERVER_ERROR', message: 'connection reset' });
      await actions.keepServer(keyOf(1));
      expect(changed.at(-1)).toEqual([keyOf(1), orderText(1, 77, 3)]);
      expect(edits.modified()).toBe(false);
      expect(actions.conflicts().size).toBe(0);
      expect(actions.message()?.text).toMatch(/Kept the server version/);
    });

    it('saveMerged works when the local edits were undone (merged from the server version)', async () => {
      await conflictWith(orderText(1, 77, 3));
      edits.undo();
      expect(await actions.saveMerged(keyOf(1), order(1, 77, 5))).toBe(true);
      expect(params('docs.update')[0]).toMatchObject({
        update: '{"$set":{"qty":{"$numberInt":"5"}}}',
        expected: '{"qty":{"$eq":{"$numberInt":"3"}}}',
      });
      expect(actions.conflicts().size).toBe(0);
    });

    it('saveMerged is not offered for a document deleted on the server', async () => {
      await conflictWith(null);
      expect(await actions.saveMerged(keyOf(1), order(1, 15))).toBe(false);
      expect(fake.requests).toHaveLength(0);
      expect(actions.conflicts().has(keyOf(1))).toBe(true);
    });

    it('saveMerged refuses a document without an _id', async () => {
      await conflictWith(orderText(1, 77));
      const noId = parseEJsonDocument('{"total":{"$numberInt":"15"}}');
      expect(await actions.saveMerged(keyOf(1), noId)).toBe(false);
      expect(fake.requests).toHaveLength(0);
      expect(actions.message()?.text).toMatch(/must keep the _id/);
    });

    it('saveMerged with a projection unsets a loaded field removed, never a hidden one', async () => {
      projection = '{"total":{"$numberInt":"1"},"note":{"$numberInt":"1"}}';
      const loaded = parseEJsonDocument(
        '{"_id":{"$numberInt":"1"},"total":{"$numberInt":"10"},"note":"call first"}',
      );
      fake.fail('docs.update', {
        code: 'CONFLICT',
        message: 'x',
        detail: {
          current:
            '{"_id":{"$numberInt":"1"},"total":{"$numberInt":"77"},"qty":{"$numberInt":"3"},"note":"call first"}',
        },
      });
      edits.edit(
        loaded,
        parseEJsonDocument(
          '{"_id":{"$numberInt":"1"},"total":{"$numberInt":"15"},"note":"call first"}',
        ),
        true,
      );
      await actions.save(keyOf(1));
      fake.respond('docs.update', { modified: true });
      fake.requests.length = 0;
      // The merge keeps total 15 and drops the note; qty is hidden by the projection.
      const merged = parseEJsonDocument('{"_id":{"$numberInt":"1"},"total":{"$numberInt":"15"}}');
      expect(await actions.saveMerged(keyOf(1), merged)).toBe(true);
      expect(params('docs.update')[0]).toMatchObject({
        update: '{"$set":{"total":{"$numberInt":"15"}},"$unset":{"note":""}}',
        expected: '{"total":{"$eq":{"$numberInt":"77"}},"note":{"$eq":"call first"}}',
      });
    });

    it('saveMerged with a projection after the edits were undone compares only the merged fields', async () => {
      await conflictWith(orderText(1, 77, 3));
      edits.undo();
      projection = '{"total":{"$numberInt":"1"}}';
      const merged = parseEJsonDocument('{"_id":{"$numberInt":"1"},"total":{"$numberInt":"20"}}');
      expect(await actions.saveMerged(keyOf(1), merged)).toBe(true);
      // qty is not in the merged document: it is not unset.
      expect(params('docs.update')[0]).toMatchObject({
        update: '{"$set":{"total":{"$numberInt":"20"}}}',
        expected: '{"total":{"$eq":{"$numberInt":"77"}}}',
      });
    });

    it('isPartial follows the projection and the partial flag of the edits', async () => {
      edits.edit(order(1), order(1, 15));
      expect(actions.isPartial(keyOf(1))).toBe(false);
      projection = '{"total":{"$numberInt":"1"}}';
      expect(actions.isPartial(keyOf(1))).toBe(true);
      expect(actions.isPartial(keyOf(9))).toBe(true);
      projection = undefined;
      edits.edit(order(2), order(2, 25), true);
      expect(actions.isPartial(keyOf(2))).toBe(true);
      expect(actions.isPartial(keyOf(9))).toBe(false);
    });
  });

  // Round 2: the paths the CR-1..CR-6 fixes added.
  describe('conflict resolution after the fixes', () => {
    const addrLoaded = parseEJsonDocument('{"_id":{"$numberInt":"1"},"addr":{"city":"Bonn"}}');
    const addrEdited = parseEJsonDocument('{"_id":{"$numberInt":"1"},"addr":{"city":"Berlin"}}');
    const addrServer = '{"_id":{"$numberInt":"1"},"addr":{"city":"Köln","street":"Hauptstr. 1"}}';

    it('resolveBlocker is null without a conflict and for a document deleted on the server', async () => {
      expect(actions.resolveBlocker(keyOf(1))).toBeNull();
      projection = '{"addr.city":{"$numberInt":"1"}}';
      fake.fail('docs.update', { code: 'CONFLICT', message: 'x', detail: { current: null } });
      edits.edit(order(1), order(1, 15));
      await actions.save(keyOf(1));
      expect(actions.conflicts().get(keyOf(1))?.current).toBeNull();
      expect(actions.resolveBlocker(keyOf(1))).toBeNull();
      // The re-insert is still refused because the document may be partial.
      fake.requests.length = 0;
      expect(await actions.overwrite(keyOf(1))).toBe(false);
      expect(fake.requests).toHaveLength(0);
      expect(actions.message()?.text).toMatch(/^Not inserted: with a projection/);
    });

    it('resolveBlocker is null for a whole document without a projection', async () => {
      fake.fail('docs.update', {
        code: 'CONFLICT',
        message: 'x',
        detail: { current: orderText(1, 77) },
      });
      edits.edit(order(1), order(1, 15));
      await actions.save(keyOf(1));
      expect(actions.resolveBlocker(keyOf(1))).toBeNull();
    });

    // TW-2: the projection check looks only at the projection active now, not at the one the
    // document was loaded with. Recorded assumption: hidden (sub-)fields are never unset.
    // The edit is recorded as CollectionView and RawEditor do under a dotted projection
    // (hidesSubFields), which still refuses once a top-level projection is run (TW-3).
    it.each([
      ['overwrite', () => actions.overwrite(keyOf(1))],
      ['merge', () => actions.saveMerged(keyOf(1), addrEdited)],
    ])(
      '%s never unsets a sub-field hidden by a dotted projection after a top-level one is run',
      async (_name, resolve) => {
        // Edited under {"addr.city": 1}: the loaded addr has only city.
        projection = '{"addr.city":{"$numberInt":"1"}}';
        fake.fail('docs.update', {
          code: 'CONFLICT',
          message: 'x',
          detail: { current: addrServer },
        });
        edits.edit(addrLoaded, addrEdited, true, true);
        expect(await actions.save(keyOf(1))).toBe(false);
        expect(actions.resolveBlocker(keyOf(1))).toBe('projection');
        fake.respond('docs.update', { modified: true });
        fake.requests.length = 0;
        // The user runs a top-level projection; the unsaved edit (loaded with addr.city only) stays.
        projection = '{"addr":{"$numberInt":"1"}}';
        await resolve();
        // Refused, or written without touching addr.street (which the user never loaded).
        expect(params('docs.replace')).toHaveLength(0);
        for (const update of params('docs.update')) {
          expect(String(update['update'])).not.toContain('street');
        }
      },
    );

    // TW-2 fix: the edit remembers that its projection hid parts of fields.
    it('keeps Overwrite and Merge blocked for an edit made under a dotted projection', async () => {
      projection = '{"addr.city":{"$numberInt":"1"}}';
      fake.fail('docs.update', { code: 'CONFLICT', message: 'x', detail: { current: addrServer } });
      edits.edit(addrLoaded, addrEdited, true, true);
      expect(await actions.save(keyOf(1))).toBe(false);
      fake.respond('docs.update', { modified: true });
      fake.requests.length = 0;
      projection = '{"addr":{"$numberInt":"1"}}';
      expect(actions.resolveBlocker(keyOf(1))).toBe('projection');
      expect(await actions.overwrite(keyOf(1))).toBe(false);
      expect(await actions.saveMerged(keyOf(1), addrEdited)).toBe(false);
      expect(fake.requests).toHaveLength(0);
      expect(actions.message()?.text).toMatch(/hides parts of fields/);
      expect(edits.get(keyOf(1))?.current).toBe(addrEdited);
    });

    // TW-3: under a top-level projection addr was loaded whole, so a sub-field only the server has
    // is a server change the user is shown: Overwrite and Merge write the local version and unset it.
    it.each([
      ['overwrite', () => actions.overwrite(keyOf(1))],
      ['merge', () => actions.saveMerged(keyOf(1), addrEdited)],
    ])(
      '%s under a top-level projection unsets a sub-field the server added to a loaded field',
      async (_name, resolve) => {
        projection = '{"total":{"$numberInt":"1"},"addr":{"$numberInt":"1"}}';
        fake.fail('docs.update', {
          code: 'CONFLICT',
          message: 'x',
          detail: { current: addrServer },
        });
        edits.edit(addrLoaded, addrEdited, true);
        expect(await actions.save(keyOf(1))).toBe(false);
        expect(actions.resolveBlocker(keyOf(1))).toBeNull();
        fake.respond('docs.update', { modified: true });
        fake.requests.length = 0;
        expect(await resolve()).toBe(true);
        expect(params('docs.replace')).toHaveLength(0);
        const [update] = params('docs.update');
        expect(update?.['update']).toBe(
          '{"$set":{"addr.city":"Berlin"},"$unset":{"addr.street":""}}',
        );
        expect(actions.message()?.text).not.toMatch(/projection/);
      },
    );

    it('still unsets a loaded sub-field the user removed, under a top-level projection', async () => {
      projection = '{"addr":{"$numberInt":"1"}}';
      const loaded = parseEJsonDocument(
        '{"_id":{"$numberInt":"1"},"addr":{"city":"Bonn","street":"Hauptstr. 1"}}',
      );
      fake.fail('docs.update', { code: 'CONFLICT', message: 'x', detail: { current: addrServer } });
      edits.edit(loaded, addrEdited, true);
      expect(await actions.save(keyOf(1))).toBe(false);
      fake.respond('docs.update', { modified: true });
      fake.requests.length = 0;
      expect(await actions.overwrite(keyOf(1))).toBe(true);
      const [update] = params('docs.update');
      expect(String(update?.['update'])).toContain('"$unset":{"addr.street":""}');
    });

    // Round 4 (TW-3 fix): the unset of server-only sub-fields applies only to entries without
    // hidesSubFields; flagged entries stay refused whatever projection is active now.
    describe('TW-3: server-only sub-fields of loaded fields', () => {
      const conflictOn = async (doc: BsonDocument, current: string, hides = false) => {
        fake.fail('docs.update', { code: 'CONFLICT', message: 'x', detail: { current } });
        edits.edit(addrLoaded, doc, true, hides);
        expect(await actions.save(keyOf(1))).toBe(false);
        fake.respond('docs.update', { modified: true });
        fake.requests.length = 0;
      };

      it('Overwrite under a top-level exclusion projection unsets the sub-field, not the hidden field', async () => {
        projection = '{"note":{"$numberInt":"0"}}';
        await conflictOn(
          addrEdited,
          '{"_id":{"$numberInt":"1"},"note":"hidden","addr":{"city":"Köln","street":"Hauptstr. 1"}}',
        );
        expect(actions.resolveBlocker(keyOf(1))).toBeNull();
        expect(await actions.overwrite(keyOf(1))).toBe(true);
        const [update] = params('docs.update');
        expect(update?.['update']).toBe(
          '{"$set":{"addr.city":"Berlin"},"$unset":{"addr.street":""}}',
        );
        expect(String(update?.['expected'])).not.toContain('note');
      });

      it('an Overwrite that unsets the sub-field and meets a newer server change conflicts again', async () => {
        projection = '{"addr":{"$numberInt":"1"}}';
        await conflictOn(addrEdited, addrServer);
        const newer = '{"_id":{"$numberInt":"1"},"addr":{"city":"Ulm","street":"Hauptstr. 2"}}';
        fake.fail('docs.update', { code: 'CONFLICT', message: 'x', detail: { current: newer } });
        expect(await actions.overwrite(keyOf(1))).toBe(false);
        const [update] = params('docs.update');
        expect(String(update?.['update'])).toContain('"$unset":{"addr.street":""}');
        expect(String(update?.['expected'])).toContain('Hauptstr. 1');
        expect(edits.get(keyOf(1))?.current).toBe(addrEdited);
        const street = actions
          .conflicts()
          .get(keyOf(1))
          ?.current?.fields.find((f) => f.key === 'addr');
        expect(JSON.stringify(street)).toContain('Hauptstr. 2');
        expect(actions.resolveBlocker(keyOf(1))).toBeNull();
      });

      it.each([
        ['a top-level projection', '{"addr":{"$numberInt":"1"}}'],
        ['no projection', undefined],
      ])(
        'a flagged entry is still refused with %s active now, and nothing is sent',
        async (_name, now) => {
          projection = '{"addr.city":{"$numberInt":"1"}}';
          await conflictOn(addrEdited, addrServer, true);
          projection = now;
          expect(actions.resolveBlocker(keyOf(1))).toBe('projection');
          expect(await actions.overwrite(keyOf(1))).toBe(false);
          expect(await actions.saveMerged(keyOf(1), addrEdited)).toBe(false);
          expect(fake.requests).toHaveLength(0);
          expect(actions.message()?.text).toMatch(/hides parts of fields/);
          expect(edits.get(keyOf(1))?.hidesSubFields).toBe(true);
        },
      );

      it('a plain Save of a flagged entry still writes its loaded sub-field edit', async () => {
        projection = '{"addr.city":{"$numberInt":"1"}}';
        edits.edit(addrLoaded, addrEdited, true, true);
        expect(await actions.save(keyOf(1))).toBe(true);
        const [update] = params('docs.update');
        expect(update?.['update']).toBe('{"$set":{"addr.city":"Berlin"}}');
      });
    });

    // Round 3: the unset safety net must not block legitimate writes of partial documents.
    describe('the unset safety net lets legitimate writes through', () => {
      const full = parseEJsonDocument(
        '{"_id":{"$numberInt":"1"},"total":{"$numberInt":"10"},"note":"n","addr":{"city":"Bonn","street":"Hauptstr. 1"}}',
      );
      const without = (doc: BsonDocument, ...keys: string[]): BsonDocument => ({
        type: 'object',
        fields: doc.fields.filter((f) => !keys.includes(f.key)),
      });

      it('a plain Save of a partial document unsets a loaded top-level field', async () => {
        projection = '{"total":{"$numberInt":"1"},"note":{"$numberInt":"1"}}';
        const loaded = without(full, 'addr');
        edits.edit(loaded, without(loaded, 'note'), true);
        expect(await actions.save(keyOf(1))).toBe(true);
        expect(params('docs.update')[0]).toMatchObject({
          update: '{"$unset":{"note":""}}',
          expected: '{"note":{"$eq":"n"}}',
        });
      });

      it('a plain Save under a dotted projection unsets a loaded sub-field', async () => {
        projection = '{"addr.city":{"$numberInt":"1"}}';
        edits.edit(
          addrLoaded,
          parseEJsonDocument('{"_id":{"$numberInt":"1"},"addr":{}}'),
          true,
          true,
        );
        expect(await actions.save(keyOf(1))).toBe(true);
        expect(params('docs.update')[0]?.['update']).toBe('{"$unset":{"addr.city":""}}');
      });

      it('a second Save after the first one unsets a field of the saved baseline', async () => {
        projection = '{"total":{"$numberInt":"1"},"note":{"$numberInt":"1"}}';
        const loaded = without(full, 'addr');
        const first = parseEJsonDocument(
          '{"_id":{"$numberInt":"1"},"total":{"$numberInt":"15"},"note":"n"}',
        );
        edits.edit(loaded, first, true);
        expect(await actions.save(keyOf(1))).toBe(true);
        // The read-back answers with a different document; edit on from what the user has.
        edits.edit(first, without(first, 'note'), true);
        expect(await actions.save(keyOf(1))).toBe(true);
        expect(params('docs.update')[1]?.['update']).toBe('{"$unset":{"note":""}}');
      });

      it('Overwrite unsets a loaded top-level field the user removed, under a top-level projection', async () => {
        projection = '{"total":{"$numberInt":"1"},"note":{"$numberInt":"1"}}';
        const loaded = without(full, 'addr');
        fake.fail('docs.update', {
          code: 'CONFLICT',
          message: 'x',
          detail: { current: stringifyEJson(full).replace('"n"', '"server"') },
        });
        edits.edit(loaded, without(loaded, 'note'), true);
        expect(await actions.save(keyOf(1))).toBe(false);
        fake.respond('docs.update', { modified: true });
        fake.requests.length = 0;
        expect(await actions.overwrite(keyOf(1))).toBe(true);
        // addr is hidden by the projection: it is neither unset nor checked.
        expect(params('docs.update')[0]).toMatchObject({
          update: '{"$unset":{"note":""}}',
          expected: '{"note":{"$eq":"server"}}',
        });
      });

      it('Merge manually without a loaded field unsets it, under a top-level projection', async () => {
        projection = '{"total":{"$numberInt":"1"},"note":{"$numberInt":"1"}}';
        const loaded = without(full, 'addr');
        fake.fail('docs.update', {
          code: 'CONFLICT',
          message: 'x',
          detail: { current: stringifyEJson(full).replace('"n"', '"server"') },
        });
        edits.edit(
          loaded,
          parseEJsonDocument('{"_id":{"$numberInt":"1"},"total":{"$numberInt":"15"},"note":"n"}'),
          true,
        );
        expect(await actions.save(keyOf(1))).toBe(false);
        fake.respond('docs.update', { modified: true });
        fake.requests.length = 0;
        const merged = parseEJsonDocument('{"_id":{"$numberInt":"1"},"total":{"$numberInt":"15"}}');
        expect(await actions.saveMerged(keyOf(1), merged)).toBe(true);
        expect(params('docs.update')[0]?.['update']).toBe(
          '{"$set":{"total":{"$numberInt":"15"}},"$unset":{"note":""}}',
        );
      });

      it('Overwrite without a projection unsets a sub-field only the server has', async () => {
        fake.fail('docs.update', {
          code: 'CONFLICT',
          message: 'x',
          detail: { current: addrServer },
        });
        edits.edit(addrLoaded, addrEdited);
        expect(await actions.save(keyOf(1))).toBe(false);
        fake.respond('docs.update', { modified: true });
        fake.requests.length = 0;
        expect(await actions.overwrite(keyOf(1))).toBe(true);
        expect(String(params('docs.update')[0]?.['update'])).toContain(
          '"$unset":{"addr.street":""}',
        );
      });
    });

    it('reads the server version as unknown when the reread returns text that is not EJSON', async () => {
      fake.fail('docs.update', { code: 'CONFLICT', message: 'x', detail: { current: 42 } });
      fake.respond('docs.get', { doc: '{not ejson', sliced: [] });
      edits.edit(order(1), order(1, 15));
      expect(await actions.save(keyOf(1))).toBe(false);
      expect(actions.conflicts().get(keyOf(1))).toStrictEqual({
        key: keyOf(1),
        current: undefined,
      });
      expect(actions.resolveBlocker(keyOf(1))).toBe('server-unknown');
      // Not mistaken for a deletion.
      expect(actions.message()?.text).not.toMatch(/deleted/);
    });

    it('keeps the document busy while a conflict without a readable version is read again', async () => {
      const reread = deferred<{ doc: string | null; sliced: never[] }>();
      fake.handle('docs.get', () => reread.promise);
      fake.fail('docs.update', { code: 'CONFLICT', message: 'x', detail: { current: 42 } });
      edits.edit(order(1), order(1, 15));
      const saving = actions.save(keyOf(1));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(params('docs.get')).toHaveLength(1);
      expect(actions.isBusy(keyOf(1))).toBe(true);
      // No conflict is shown yet, and a second save is ignored.
      expect(actions.conflicts().has(keyOf(1))).toBe(false);
      expect(await actions.save(keyOf(1))).toBe(false);
      reread.resolve({ doc: orderText(1, 77), sliced: [] });
      expect(await saving).toBe(false);
      expect(actions.isBusy(keyOf(1))).toBe(false);
      expect(stringifyEJson(actions.conflicts().get(keyOf(1))?.current as BsonDocument)).toBe(
        orderText(1, 77),
      );
      expect(params('docs.update')).toHaveLength(1);
    });

    it('keeps an edit made while the overwrite was on its way', async () => {
      fake.fail('docs.update', {
        code: 'CONFLICT',
        message: 'x',
        detail: { current: orderText(1, 77, 1) },
      });
      const loaded = order(1);
      edits.edit(loaded, order(1, 15));
      await actions.save(keyOf(1));
      const answer = deferred<{ modified: boolean }>();
      fake.handle('docs.update', () => answer.promise);
      fake.requests.length = 0;
      const writing = actions.overwrite(keyOf(1));
      await Promise.resolve();
      edits.edit(loaded, order(1, 15, 4));
      answer.resolve({ modified: true });
      expect(await writing).toBe(true);
      expect(params('docs.update')[0]).toMatchObject({
        update: '{"$set":{"total":{"$numberInt":"15"}}}',
        expected: '{"total":{"$eq":{"$numberInt":"77"}}}',
      });
      // The written version is the baseline; the qty edit is left to save.
      expect(stringifyEJson(edits.get(keyOf(1))?.original as BsonDocument)).toBe(orderText(1, 15));
      expect(stringifyEJson(edits.get(keyOf(1))?.current as BsonDocument)).toBe(
        orderText(1, 15, 4),
      );
      expect(actions.conflicts().size).toBe(0);
    });

    it('keepServer of an unknown server version reads it back with the query projection', async () => {
      fake.fail('docs.update', { code: 'CONFLICT', message: 'x', detail: { current: 42 } });
      fake.fail('docs.get', { code: 'SERVER_ERROR', message: 'connection reset' });
      edits.edit(order(1), order(1, 15));
      await actions.save(keyOf(1));
      fake.respond('docs.get', { doc: orderText(1, 99, 99), sliced: [] });
      fake.requests.length = 0;
      projection = '{"total":{"$numberInt":"1"}}';
      await actions.keepServer(keyOf(1));
      expect(params('docs.get')).toEqual([
        { profileId: 'p1', db: 'shop', coll: 'orders', id: keyOf(1), projection },
      ]);
    });
  });

  describe('visibleFields', () => {
    it("keeps the top-level fields one of the shown documents has, in the document's order", () => {
      const server = parseEJsonDocument('{"_id":1,"c":3,"b":2,"a":1,"hidden":0}');
      const shown = [parseEJsonDocument('{"a":9,"_id":1}'), parseEJsonDocument('{"b":8}')];
      expect(stringifyEJson(visibleFields(server, shown))).toBe(
        stringifyEJson(parseEJsonDocument('{"_id":1,"b":2,"a":1}')),
      );
    });

    it('is empty without shown documents', () => {
      expect(visibleFields(order(1), []).fields).toEqual([]);
    });
  });

  describe('isTopLevelProjection', () => {
    it.each([
      '{}',
      '{"a":{"$numberInt":"1"},"b":{"$numberInt":"1"}}',
      '{"a":{"$numberInt":"0"}}',
      '{"a":true,"_id":false}',
      '{"a":{"$numberDouble":"1.0"},"b":{"$numberLong":"0"}}',
      '{"a":{"$numberDouble":"0.0"},"b":{"$numberLong":"1"}}',
    ])('accepts %s', (projection) => {
      expect(isTopLevelProjection(projection)).toBe(true);
    });

    it.each([
      '{"addr.city":{"$numberInt":"1"}}',
      '{"tags":{"$slice":{"$numberInt":"2"}}}',
      '{"tags":{"$elemMatch":{"x":{"$numberInt":"1"}}}}',
      '{"score":{"$meta":"textScore"}}',
      '{"a":"$b"}',
      '{"a":{"$numberInt":"2"}}',
      '{"a":{"$numberLong":"2"}}',
      '{"a":{"$numberDouble":"0.5"}}',
      '{"$a":{"$numberInt":"1"}}',
      'not ejson',
    ])('refuses %s', (projection) => {
      expect(isTopLevelProjection(projection)).toBe(false);
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

    it('says "Not deleted" when the delete fails', async () => {
      fake.fail('docs.delete', { code: 'SERVER_ERROR', message: 'not authorized' });
      expect(await actions.delete(order(1))).toBe(false);
      expect(actions.message()?.text).toMatch(/^Not deleted: [\s\S]*not authorized/);
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
      expect(actions.message()?.text).toMatch(/^Not inserted: [\s\S]*E11000 duplicate key error/);
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

  // doc-paging x conflict-ui: a large document shown with its long arrays cut (`slicedOf`) goes
  // through the reworked Save/conflict paths. Every read-back keeps the arrays cut (`sliceAbove`),
  // and a version shown without a read-back keeps the cut flags; nothing is shown when there is
  // no version to show (`saved === undefined`).
  describe('a large document with cut arrays in the conflict paths', () => {
    const ITEMS = [{ path: 'items', total: 50_000, loaded: 100 }] as const;
    /** `{_id: 1, name, items: [n strings]}` as canonical EJSON (fictitious). */
    const bigText = (name: string, n = 3) =>
      JSON.stringify({
        _id: { $numberInt: '1' },
        name,
        items: Array.from({ length: n }, (_, i) => `SKU-${i}`),
      });
    const big = (name: string, n?: number) => parseEJsonDocument(bigText(name, n));
    let changes: [string, string | null, readonly unknown[] | undefined][];
    let cut: { above: number; arrays: readonly (typeof ITEMS)[number][] } | undefined;

    beforeEach(() => {
      changes = [];
      cut = { above: 100, arrays: ITEMS };
      actions.setHost({
        ...host(),
        slicedOf: () => cut,
        documentChanged: (key, doc, sliced) => changes.push([key, doc, sliced]),
      });
    });

    /** Renames the large document (marked partial, as the collection view does) into a conflict. */
    async function conflictWith(detail: unknown): Promise<void> {
      fake.fail('docs.update', { code: 'CONFLICT', message: 'x', detail });
      edits.edit(big('large order'), big('renamed order'), true);
      expect(await actions.save(keyOf(1))).toBe(false);
      fake.respond('docs.update', { modified: true });
      fake.requests.length = 0;
    }

    it('a conflicting save keeps the edits and reports nothing changed to the host', async () => {
      await conflictWith({ current: bigText('renamed elsewhere') });
      expect(actions.conflicts().get(keyOf(1))?.current).toEqual(big('renamed elsewhere'));
      expect(edits.get(keyOf(1))?.partial).toBe(true);
      expect(changes).toEqual([]);
    });

    it('keepServer reads the server version back cut, with the sliced arrays it answers', async () => {
      await conflictWith({ current: bigText('renamed elsewhere') });
      fake.respond('docs.get', { doc: bigText('renamed elsewhere'), sliced: [...ITEMS] });
      await actions.keepServer(keyOf(1));
      expect(params('docs.get')).toEqual([
        { profileId: 'p1', db: 'shop', coll: 'orders', id: keyOf(1), sliceAbove: 100 },
      ]);
      expect(changes).toEqual([[keyOf(1), bigText('renamed elsewhere'), ITEMS]]);
      expect(edits.modified()).toBe(false);
      expect(actions.conflicts().size).toBe(0);
    });

    it('keepServer passes no cut arrays when the read-back answers the document whole', async () => {
      await conflictWith({ current: bigText('shrunk elsewhere') });
      fake.respond('docs.get', { doc: bigText('shrunk elsewhere'), sliced: [] });
      await actions.keepServer(keyOf(1));
      expect(changes).toEqual([[keyOf(1), bigText('shrunk elsewhere'), undefined]]);
    });

    it('keepServer shows the conflict version whole (no cut flags) when the read-back fails', async () => {
      // The conflict carries the whole server document, so it is not cut (review CR-8).
      await conflictWith({ current: bigText('renamed elsewhere') });
      fake.fail('docs.get', { code: 'SERVER_ERROR', message: 'connection reset' });
      await actions.keepServer(keyOf(1));
      expect(params('docs.get')[0]).toMatchObject({ sliceAbove: 100 });
      expect(changes).toEqual([[keyOf(1), bigText('renamed elsewhere'), undefined]]);
    });

    it('the conflict remembers the cut arrays of the loaded document', async () => {
      await conflictWith({ current: bigText('renamed elsewhere') });
      // Later the document is no longer on the shown page: the conflict still knows it is cut.
      cut = undefined;
      expect(actions.conflicts().get(keyOf(1))?.cut).toEqual(ITEMS);
      expect(actions.resolveBlocker(keyOf(1))).toBe('partial');
    });

    it('keepServer of an unknown server version shows nothing when the read-back fails too', async () => {
      // No readable version in the conflict, and reading it fails: the server version is unknown.
      fake.fail('docs.get', { code: 'SERVER_ERROR', message: 'connection reset' });
      await conflictWith({ current: 42 });
      expect(actions.conflicts().get(keyOf(1))?.current).toBeUndefined();
      await actions.keepServer(keyOf(1));
      // `saved === undefined`: the page keeps what it shows (and its cut flags) untouched.
      expect(params('docs.get')).toEqual([
        { profileId: 'p1', db: 'shop', coll: 'orders', id: keyOf(1), sliceAbove: 100 },
      ]);
      expect(changes).toEqual([]);
      expect(edits.modified()).toBe(false);
      expect(actions.conflicts().size).toBe(0);
    });

    it('keepServer of an unknown server version shows the cut read-back when it works', async () => {
      fake.fail('docs.get', { code: 'SERVER_ERROR', message: 'connection reset' });
      await conflictWith({ current: 42 });
      fake.respond('docs.get', { doc: bigText('renamed elsewhere'), sliced: [...ITEMS] });
      await actions.keepServer(keyOf(1));
      expect(changes).toEqual([[keyOf(1), bigText('renamed elsewhere'), ITEMS]]);
    });

    it('Overwrite and Merge manually are refused for the partial document, nothing is written', async () => {
      await conflictWith({ current: bigText('renamed elsewhere') });
      expect(actions.resolveBlocker(keyOf(1))).toBe('partial');
      expect(await actions.overwrite(keyOf(1))).toBe(false);
      // No projection is active: the refusal names the partial load, as Save's does.
      expect(actions.message()?.text).toContain('loaded only partly');
      expect(actions.message()?.text).toContain('long arrays are read page by page');
      expect(actions.message()?.text).not.toContain('Clear the projection');
      actions.clearMessage();
      expect(await actions.saveMerged(keyOf(1), big('merged order'))).toBe(false);
      expect(actions.message()?.text).toContain('long arrays are read page by page');
      expect(fake.requests).toHaveLength(0);
      expect(changes).toEqual([]);
      expect(edits.get(keyOf(1))?.current).toEqual(big('renamed order'));
    });

    it('a cut document is blocked even under a top-level projection', async () => {
      projection = '{"name":{"$numberInt":"1"},"items":{"$numberInt":"1"}}';
      await conflictWith({ current: bigText('renamed elsewhere') });
      expect(actions.resolveBlocker(keyOf(1))).toBe('partial');
      expect(await actions.overwrite(keyOf(1))).toBe(false);
      expect(actions.message()?.text).toContain('long arrays are read page by page');
      expect(fake.requests).toHaveLength(0);
    });

    it('re-inserting a large document deleted on the server is refused (it is partial)', async () => {
      await conflictWith({ current: null });
      expect(await actions.overwrite(keyOf(1))).toBe(false);
      expect(actions.message()?.text).toContain('Not inserted');
      expect(actions.message()?.text).toContain('long arrays are read page by page');
      expect(actions.message()?.text).not.toContain('with a projection active');
      // Running the query again can't bring a deleted document back (review CR-3).
      expect(actions.message()?.text).toMatch(/Keep it deleted\.$/);
      expect(actions.message()?.text).not.toContain('run the query');
      expect(fake.requests).toHaveLength(0);
      expect(changes).toEqual([]);
    });

    it('a save after the conflict was kept reads back cut and passes the new cut arrays', async () => {
      await conflictWith({ current: bigText('renamed elsewhere') });
      fake.respond('docs.get', { doc: bigText('renamed elsewhere'), sliced: [...ITEMS] });
      await actions.keepServer(keyOf(1));
      edits.edit(big('renamed elsewhere'), big('renamed twice'), true);
      fake.fail('docs.get', { code: 'SERVER_ERROR', message: 'connection reset' });
      fake.requests.length = 0;
      changes = [];
      expect(await actions.save(keyOf(1))).toBe(true);
      expect(params('docs.update')).toHaveLength(1);
      expect(params('docs.get')[0]).toMatchObject({ sliceAbove: 100 });
      // Not readable: the saved version (still cut) is shown with the cut flags.
      expect(changes).toEqual([[keyOf(1), bigText('renamed twice'), ITEMS]]);
    });
  });
});
