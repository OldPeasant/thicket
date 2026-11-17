import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type BsonDocument, parseEJsonDocument } from '@thicket/core/bson';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../api';
import { FakeThicketBridge, provideFakeThicket } from '../../api/testing';
import { type DocumentHost, DocumentEdits } from '../../document';
import { ConfirmService, type ConfirmRequest } from '../../safety/confirm.service';
import { ProfileSafetyService } from '../../safety/profile-safety.service';
import { MultiEdit, type SelectedDocument } from './multi-edit.service';
import type { FieldEdit } from './multi-edit.util';

/** `{_id: id, status}` as canonical EJSON. */
const orderText = (id: number, status = 'open') =>
  `{"_id":{"$numberInt":"${id}"},"status":"${status}"}`;
const order = (id: number, status?: string): BsonDocument =>
  parseEJsonDocument(orderText(id, status));
const keyOf = (id: number) => `{"$numberInt":"${id}"}`;
const idOfKey = (key: string) => Number((JSON.parse(key) as { $numberInt: string }).$numberInt);
const rows = (...ids: number[]): SelectedDocument[] =>
  ids.map((id) => ({ doc: order(id), partial: false }));
const SHIPPED: FieldEdit = {
  action: 'set',
  path: 'status',
  value: { type: 'string', value: 'shipped' },
};

/** A promise the test settles explicitly. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

describe('MultiEdit', () => {
  let fake: FakeThicketBridge;
  let multi: MultiEdit;
  let edits: DocumentEdits;
  let changed: [string, string | null][];
  let projection: string | undefined;
  let confirms: ConfirmRequest[];
  let confirmAnswer: () => Promise<boolean>;

  const host = (): DocumentHost => ({
    profileId: 'p1',
    db: 'shop',
    coll: 'orders',
    projection: () => projection,
    documentChanged: (key, doc) => changed.push([key, doc]),
  });
  const updates = () =>
    fake.requestsFor('docs.update').map((r) => r.params as Record<string, unknown>);

  beforeEach(() => {
    fake = new FakeThicketBridge();
    fake.respond('docs.update', { modified: true });
    fake.handle('docs.get', (p) => ({ doc: orderText(idOfKey(p.id), 'server'), sliced: [] }));
    changed = [];
    projection = undefined;
    confirms = [];
    confirmAnswer = () => Promise.resolve(true);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideFakeThicket(fake),
        DocumentEdits,
        MultiEdit,
      ],
    });
    vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockImplementation((request) => {
      confirms.push(request);
      return confirmAnswer();
    });
    TestBed.inject(ProfileSafetyService).set({
      id: 'p1',
      name: 'Local',
      readOnly: false,
      production: false,
    });
    edits = TestBed.inject(DocumentEdits);
    multi = TestBed.inject(MultiEdit);
    multi.setHost(host());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses to work before setHost', async () => {
    const fresh = TestBed.runInInjectionContext(() => new MultiEdit());
    await expect(fresh.save(rows(1), SHIPPED)).rejects.toThrow(/setHost/);
  });

  it('three documents: one confirm with the count, then one conflict-checked docs.update each', async () => {
    const result = await multi.save(rows(1, 2, 3), SHIPPED);
    expect(result).toEqual({ saved: 3, unchanged: 0, conflicts: [], failed: [] });
    expect(confirms).toHaveLength(1);
    expect(confirms[0]).toMatchObject({
      title: 'Update 3 documents',
      confirmLabel: 'Save 3 documents',
      detail: 'Updates 3 documents, one updateOne each.',
      namespace: 'shop.orders',
    });
    expect(confirms[0]?.operation.match(/updateOne\(/g)).toHaveLength(3);
    expect(updates()).toEqual(
      [1, 2, 3].map((id) => ({
        profileId: 'p1',
        db: 'shop',
        coll: 'orders',
        id: keyOf(id),
        update: '{"$set":{"status":"shipped"}}',
        expected: '{"status":{"$eq":"open"}}',
        confirmed: true,
      })),
    );
    // Each saved document is read back and shown in the page.
    expect(changed.map(([k]) => k)).toEqual([keyOf(1), keyOf(2), keyOf(3)]);
    expect(changed[0]?.[1]).toBe(orderText(1, 'server'));
  });

  it('asks even on a non-production profile (one dialog for the batch, always)', async () => {
    await multi.save(rows(1), SHIPPED);
    expect(confirms).toHaveLength(1);
    expect(confirms[0]).toMatchObject({
      title: 'Update 1 document',
      confirmLabel: 'Save 1 document',
      connection: { name: 'Local', production: false },
    });
  });

  it('one conflicting document is reported and reloaded; the others are saved', async () => {
    fake.handle('docs.update', (p) => {
      if (p.id === keyOf(2)) {
        throw new ApiError({
          code: 'CONFLICT',
          message: 'changed',
          detail: { current: orderText(2, 'packed') },
        });
      }
      return { modified: true };
    });
    const result = await multi.save(rows(1, 2, 3), SHIPPED);
    expect(result).toEqual({
      saved: 2,
      unchanged: 0,
      conflicts: [{ label: '2', reason: 'changed on the server since it was loaded' }],
      failed: [],
    });
    // Every document was tried, in order.
    expect(updates().map((p) => p['id'])).toEqual([keyOf(1), keyOf(2), keyOf(3)]);
    // The conflicting document was reloaded too, so the table shows the server version.
    expect(fake.requestsFor('docs.get').map((r) => (r.params as { id: string }).id)).toEqual([
      keyOf(1),
      keyOf(2),
      keyOf(3),
    ]);
    expect(changed.map(([k]) => k)).toEqual([keyOf(1), keyOf(2), keyOf(3)]);
  });

  it('a document deleted on the server since loading is reported and removed from the page', async () => {
    fake.handle('docs.update', (p) => {
      if (p.id === keyOf(1)) {
        throw new ApiError({ code: 'CONFLICT', message: 'gone', detail: { current: null } });
      }
      return { modified: true };
    });
    const result = await multi.save(rows(1, 2), SHIPPED);
    expect(result.saved).toBe(1);
    expect(result.conflicts).toEqual([
      { label: '1', reason: 'deleted on the server since it was loaded', deleted: true },
    ]);
    expect(changed).toContainEqual([keyOf(1), null]);
    // The report is kept for the panel, which may outlive the deleted rows.
    expect(multi.result()).toEqual(result);
    expect(fake.requestsFor('docs.get').map((r) => (r.params as { id: string }).id)).toEqual([
      keyOf(2),
    ]);
  });

  it('a CONFLICT without a readable detail counts as changed and is reloaded', async () => {
    fake.fail('docs.update', { code: 'CONFLICT', message: 'changed' });
    const result = await multi.save(rows(1), SHIPPED);
    expect(result.conflicts).toEqual([
      { label: '1', reason: 'changed on the server since it was loaded' },
    ]);
    expect(fake.requestsFor('docs.get')).toHaveLength(1);
  });

  it('another error on one document is listed as failed and does not stop the others', async () => {
    fake.handle('docs.update', (p) => {
      if (p.id === keyOf(1)) {
        throw new ApiError({ code: 'SERVER_ERROR', message: 'Document failed validation' });
      }
      return { modified: true };
    });
    const result = await multi.save(rows(1, 2), SHIPPED);
    expect(result.saved).toBe(1);
    expect(result.conflicts).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.label).toBe('1');
    expect(result.failed[0]?.reason).toContain('Document failed validation');
    // The failed document is not read back (the page keeps the loaded version).
    expect(fake.requestsFor('docs.get').map((r) => (r.params as { id: string }).id)).toEqual([
      keyOf(2),
    ]);
  });

  it('documents that already have the value are counted, not sent', async () => {
    const selected = [
      { doc: order(1, 'shipped'), partial: false },
      { doc: order(2), partial: false },
    ];
    const result = await multi.save(selected, SHIPPED);
    expect(result).toEqual({ saved: 1, unchanged: 1, conflicts: [], failed: [] });
    expect(updates().map((p) => p['id'])).toEqual([keyOf(2)]);
    expect(confirms[0]?.detail).toBe(
      'Updates 1 document, one updateOne each (1 already have this value).',
    );
  });

  it('when every document already has the value: no dialog, nothing sent', async () => {
    const result = await multi.save([{ doc: order(1, 'shipped'), partial: false }], SHIPPED);
    expect(result).toEqual({ saved: 0, unchanged: 1, conflicts: [], failed: [] });
    expect(confirms).toHaveLength(0);
    expect(fake.requests).toHaveLength(0);
  });

  it('an empty selection sends nothing', async () => {
    expect(await multi.save([], SHIPPED)).toEqual({
      saved: 0,
      unchanged: 0,
      conflicts: [],
      failed: [],
    });
    expect(confirms).toHaveLength(0);
  });

  it('a row with unsaved edits refuses the whole batch before asking', async () => {
    edits.edit(order(2), order(2, 'edited'));
    await expect(multi.save(rows(1, 2, 3), SHIPPED)).rejects.toThrow(
      /^2 has unsaved edits: save or revert/,
    );
    expect(confirms).toHaveLength(0);
    expect(fake.requests).toHaveLength(0);
    // Reverted: the batch goes through.
    edits.discard(keyOf(2));
    await expect(multi.save(rows(1, 2, 3), SHIPPED)).resolves.toMatchObject({ saved: 3 });
  });

  it('a partly loaded row allows top-level fields only', async () => {
    const selected = [
      { doc: order(1), partial: false },
      { doc: order(2), partial: true },
    ];
    const nested: FieldEdit = {
      action: 'set',
      path: 'address.city',
      value: { type: 'string', value: 'Gent' },
    };
    await expect(multi.save(selected, nested)).rejects.toThrow(/^2 was loaded only partly/);
    expect(fake.requests).toHaveLength(0);
    await expect(multi.save(selected, SHIPPED)).resolves.toMatchObject({ saved: 2 });
  });

  it('under a projection, a top-level field the loaded row lacks is refused (set and remove)', async () => {
    projection = '{"name":{"$numberInt":"1"}}';
    const selected = [
      { doc: parseEJsonDocument('{"_id":{"$numberInt":"1"},"name":"a"}'), partial: true },
    ];
    const msg =
      '1 was loaded only partly: status isn’t loaded, clear the projection to change it across rows.';
    await expect(multi.save(selected, SHIPPED)).rejects.toThrow(msg);
    await expect(multi.save(selected, { action: 'unset', path: 'status' })).rejects.toThrow(msg);
    expect(confirms).toHaveLength(0);
    expect(fake.requests).toHaveLength(0);
    // A loaded top-level field is fine.
    const name: FieldEdit = { action: 'set', path: 'name', value: { type: 'string', value: 'b' } };
    await expect(multi.save(selected, name)).resolves.toMatchObject({ saved: 1 });
  });

  it('a top-level field that is a cut array is refused; other fields of the row are fine', async () => {
    multi.setHost({
      ...host(),
      slicedOf: (key) =>
        key === keyOf(1)
          ? { above: 50, arrays: [{ path: 'items', total: 120, loaded: 50 }] }
          : undefined,
    });
    const selected = [
      {
        doc: parseEJsonDocument('{"_id":{"$numberInt":"1"},"status":"open","items":[]}'),
        partial: true,
      },
    ];
    await expect(multi.save(selected, { action: 'unset', path: 'items' })).rejects.toThrow(
      '1 was loaded only partly: items was loaded cut (a long array), open the document to change it.',
    );
    expect(fake.requests).toHaveLength(0);
    // Without a projection a missing top-level field is really missing: set adds it.
    const extra: FieldEdit = { action: 'set', path: 'tag', value: { type: 'string', value: 'x' } };
    await expect(multi.save(selected, extra)).resolves.toMatchObject({ saved: 1 });
    await expect(multi.save(selected, SHIPPED)).resolves.toMatchObject({ saved: 1 });
  });

  it('a cut array below the top-level field is refused; a field that only starts alike is not', async () => {
    multi.setHost({
      ...host(),
      slicedOf: () => ({ above: 50, arrays: [{ path: 'meta.items', total: 120, loaded: 50 }] }),
    });
    const selected = [
      {
        doc: parseEJsonDocument('{"_id":{"$numberInt":"1"},"meta":{"items":[]},"me":"x"}'),
        partial: true,
      },
    ];
    await expect(multi.save(selected, { action: 'unset', path: 'meta' })).rejects.toThrow(
      '1 was loaded only partly: meta was loaded cut (a long array), open the document to change it.',
    );
    expect(fake.requests).toHaveLength(0);
    // "me" and "met" are not "meta": no refusal.
    await expect(multi.save(selected, { action: 'unset', path: 'me' })).resolves.toMatchObject({
      saved: 1,
    });
    const met: FieldEdit = { action: 'set', path: 'met', value: { type: 'string', value: 'y' } };
    await expect(multi.save(selected, met)).resolves.toMatchObject({ saved: 1 });
  });

  it('a batch refused before sending clears the report of the previous batch', async () => {
    await multi.save(rows(1), SHIPPED);
    expect(multi.result()).not.toBeNull();
    edits.edit(order(2), order(2, 'edited'));
    await expect(multi.save(rows(2), SHIPPED)).rejects.toThrow(/unsaved edits/);
    expect(multi.result()).toBeNull();
  });

  it('keeps the last result until clearResult or the next batch', async () => {
    expect(multi.result()).toBeNull();
    const result = await multi.save(rows(1), SHIPPED);
    expect(multi.result()).toBe(result);
    multi.clearResult();
    expect(multi.result()).toBeNull();
    await multi.save(rows(1), SHIPPED);
    confirmAnswer = () => Promise.resolve(false);
    await expect(multi.save(rows(2), SHIPPED)).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(multi.result()).toBeNull();
  });

  it('a document the edit cannot apply to refuses the batch, naming it and how many more', async () => {
    const selected = [
      { doc: parseEJsonDocument('{"_id":{"$numberInt":"1"},"address":"n/a"}'), partial: false },
      { doc: parseEJsonDocument('{"_id":{"$numberInt":"2"},"address":"none"}'), partial: false },
      { doc: order(3), partial: false },
    ];
    const edit: FieldEdit = {
      action: 'set',
      path: 'address.city',
      value: { type: 'string', value: 'Gent' },
    };
    await expect(multi.save(selected, edit)).rejects.toThrow(
      'Not saved: 1: address is not a document (and 1 more).',
    );
    expect(confirms).toHaveLength(0);
    expect(fake.requests).toHaveLength(0);
  });

  it('a document without _id refuses the batch', async () => {
    const selected = [
      { doc: parseEJsonDocument('{"status":"open"}'), partial: false },
      { doc: order(1), partial: false },
    ];
    await expect(multi.save(selected, SHIPPED)).rejects.toThrow(
      /^Not saved: \(no _id\): a document without _id can’t be updated\.$/,
    );
    expect(fake.requests).toHaveLength(0);
  });

  it('cancel in the dialog sends nothing and rejects with CANCELLED', async () => {
    confirmAnswer = () => Promise.resolve(false);
    await expect(multi.save(rows(1, 2), SHIPPED)).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(fake.requests).toHaveLength(0);
    expect(multi.busy()).toBe(false);
  });

  it('a read-only profile is refused with READ_ONLY without a dialog', async () => {
    TestBed.inject(ProfileSafetyService).set({
      id: 'p1',
      name: 'Reporting',
      readOnly: true,
      production: false,
    });
    await expect(multi.save(rows(1), SHIPPED)).rejects.toMatchObject({ code: 'READ_ONLY' });
    expect(confirms).toHaveLength(0);
    expect(fake.requests).toHaveLength(0);
    expect(multi.busy()).toBe(false);
  });

  it('is busy while confirming and sending, and refuses a second batch meanwhile', async () => {
    const answer = deferred<boolean>();
    confirmAnswer = () => answer.promise;
    const first = multi.save(rows(1), SHIPPED);
    await Promise.resolve();
    expect(multi.busy()).toBe(true);
    await expect(multi.save(rows(2), SHIPPED)).rejects.toThrow(/already running/);
    answer.resolve(true);
    await expect(first).resolves.toMatchObject({ saved: 1 });
    expect(multi.busy()).toBe(false);
    expect(updates().map((p) => p['id'])).toEqual([keyOf(1)]);
  });

  it('sends the documents one after the other, not in parallel', async () => {
    const pending: (() => void)[] = [];
    fake.handle(
      'docs.update',
      () => new Promise((resolve) => pending.push(() => resolve({ modified: true }))),
    );
    const done = multi.save(rows(1, 2), SHIPPED);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    expect(updates()).toHaveLength(1);
    pending[0]?.();
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending[1]?.();
    await expect(done).resolves.toMatchObject({ saved: 2 });
  });

  it('reads back with the query projection; an unreadable document stays as loaded', async () => {
    projection = '{"status":{"$numberInt":"1"}}';
    fake.handle('docs.get', (p) => {
      if (p.id === keyOf(2)) throw new ApiError({ code: 'SERVER_ERROR', message: 'down' });
      return { doc: orderText(idOfKey(p.id), 'server'), sliced: [] };
    });
    const result = await multi.save(rows(1, 2), SHIPPED);
    // A read-back failure is not a save failure.
    expect(result).toEqual({ saved: 2, unchanged: 0, conflicts: [], failed: [] });
    expect(fake.requestsFor('docs.get')[0]?.params).toMatchObject({ projection });
    expect(changed.map(([k]) => k)).toEqual([keyOf(1)]);
  });

  it('reads back with the cut of a partly loaded document and passes its sliced arrays', async () => {
    const seen: unknown[] = [];
    multi.setHost({
      ...host(),
      slicedOf: (key) => (key === keyOf(1) ? { above: 50, arrays: [] } : undefined),
      documentChanged: (key, doc, sliced) => seen.push([key, doc, sliced]),
    });
    fake.handle('docs.get', (p) => ({
      doc: orderText(idOfKey(p.id), 'server'),
      sliced: p.id === keyOf(1) ? [{ path: 'items', total: 120, loaded: 50 }] : [],
    }));
    await multi.save(rows(1, 2), SHIPPED);
    const gets = fake.requestsFor('docs.get').map((r) => r.params as Record<string, unknown>);
    expect(gets[0]).toMatchObject({ id: keyOf(1), sliceAbove: 50 });
    expect(gets[1]).not.toHaveProperty('sliceAbove');
    expect(seen[0]).toEqual([
      keyOf(1),
      orderText(1, 'server'),
      [{ path: 'items', total: 120, loaded: 50 }],
    ]);
    expect(seen[1]).toEqual([keyOf(2), orderText(2, 'server'), undefined]);
  });

  it('lists the first 10 operations in the dialog, then how many more', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => i + 1);
    await multi.save(rows(...ids), SHIPPED);
    const operation = confirms[0]?.operation ?? '';
    expect(operation.match(/updateOne\(/g)).toHaveLength(10);
    expect(operation.split('\n').at(-1)).toBe('// … and 2 more');
    expect(confirms[0]?.title).toBe('Update 12 documents');
    expect(updates()).toHaveLength(12);
  });
});
