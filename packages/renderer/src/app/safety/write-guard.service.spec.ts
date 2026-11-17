import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ApiError } from '../api/api-error';
import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import { ConfirmDialog } from './confirm-dialog';
import { ConfirmService } from './confirm.service';
import { ProfileSafetyService } from './profile-safety.service';
import { WriteGuard } from './write-guard.service';

const DOC = '{"_id":{"$oid":"64b7f0c2a1b2c3d4e5f60718"}}';

describe('WriteGuard (with the fake API)', () => {
  let fake: FakeThicketBridge;
  let guard: WriteGuard;
  let confirm: ConfirmService;
  let safety: ProfileSafetyService;
  let fixture: ComponentFixture<ConfirmDialog>;
  let el: HTMLElement;

  const render = () => fixture.whenStable();
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const insert = (profileId: string) =>
    guard.run('docs.insert', { profileId, db: 'shop', coll: 'orders', docs: [DOC] });

  beforeEach(async () => {
    fake = new FakeThicketBridge()
      .respond('docs.insert', { insertedIds: ['{"$oid":"64b7f0c2a1b2c3d4e5f60718"}'] })
      .respond('docs.deleteMany', { deleted: 1500 })
      .respond('docs.updateMany', { matched: 2, modified: 2 });
    TestBed.configureTestingModule({ providers: [provideFakeThicket(fake)] });
    guard = TestBed.inject(WriteGuard);
    confirm = TestBed.inject(ConfirmService);
    safety = TestBed.inject(ProfileSafetyService);
    safety.set({ id: 'prod', name: 'prod-eu', readOnly: false, production: true });
    safety.set({ id: 'dev', name: 'local', readOnly: false, production: false });
    safety.set({ id: 'ro', name: 'reporting', readOnly: true, production: true });
    fixture = TestBed.createComponent(ConfirmDialog);
    el = fixture.nativeElement as HTMLElement;
    document.body.appendChild(el);
    await render();
  });

  it('production: nothing is sent before the dialog; confirmed: true only after confirming', async () => {
    const done = insert('prod');
    await render();
    await flush();
    expect(fake.requests).toHaveLength(0);
    expect(el.querySelector('[data-testid="confirm-operation"]')?.textContent).toContain(
      'insertOne({',
    );
    el.querySelector<HTMLButtonElement>('[data-testid="confirm-ok"]')?.click();
    await expect(done).resolves.toEqual({
      insertedIds: ['{"$oid":"64b7f0c2a1b2c3d4e5f60718"}'],
    });
    const sent = fake.requestsFor('docs.insert');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.params).toMatchObject({ profileId: 'prod', confirmed: true });
  });

  it('production: cancel sends nothing and rejects with CANCELLED', async () => {
    const done = insert('prod');
    await render();
    el.querySelector<HTMLButtonElement>('[data-testid="confirm-cancel"]')?.click();
    await expect(done).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(fake.requests).toHaveLength(0);
  });

  it('non-production single writes are sent at once, without confirmed', async () => {
    await insert('dev');
    expect(confirm.current()).toBeNull();
    const params = fake.requestsFor('docs.insert')[0]?.params as Record<string, unknown>;
    expect(params).not.toHaveProperty('confirmed');
  });

  it('a caller cannot pre-set confirmed: true to skip the dialog', async () => {
    const params = { profileId: 'prod', db: 'shop', coll: 'orders', docs: [DOC], confirmed: true };
    const done = guard.run('docs.insert', params);
    await flush();
    expect(fake.requests).toHaveLength(0);
    expect(confirm.current()).not.toBeNull();
    confirm.answer(false);
    await expect(done).rejects.toMatchObject({ code: 'CANCELLED' });

    const plain = guard.run('docs.insert', { ...params, profileId: 'dev' });
    await plain;
    expect(fake.requestsFor('docs.insert')[0]?.params).not.toHaveProperty('confirmed');
  });

  it('read-only profiles are refused with READ_ONLY before anything is sent', async () => {
    await expect(insert('ro')).rejects.toMatchObject({
      code: 'READ_ONLY',
      message: 'reporting is read-only.',
    } satisfies Partial<ApiError>);
    expect(confirm.current()).toBeNull();
    expect(fake.requests).toHaveLength(0);
  });

  it('bulk writes ask on every profile and carry confirmed: true', async () => {
    const done = guard.run(
      'docs.updateMany',
      { profileId: 'dev', db: 'shop', coll: 'orders', filter: '{}', update: '{"$set":{"a":1}}' },
      { count: 2 },
    );
    await flush();
    expect(fake.requests).toHaveLength(0);
    expect(confirm.current()).toMatchObject({
      title: 'Update documents',
      detail: 'Affects 2 documents.',
      connection: { name: 'local', production: false },
      namespace: 'shop.orders',
    });
    expect(confirm.current()?.typeToConfirm).toBeUndefined();
    confirm.answer(true);
    await done;
    expect(fake.requestsFor('docs.updateMany')[0]?.params).toMatchObject({ confirmed: true });
  });

  it('deleteMany over 1 000 documents needs the collection name typed', async () => {
    const done = guard.run('docs.deleteMany', {
      profileId: 'dev',
      db: 'shop',
      coll: 'orders',
      filter: '{}',
      expectedCount: 1500,
    });
    await render();
    expect(confirm.current()?.typeToConfirm).toBe('orders');
    expect(confirm.current()?.destructive).toBe(true);
    const ok = el.querySelector<HTMLButtonElement>('[data-testid="confirm-ok"]');
    expect(ok?.disabled).toBe(true);
    ok?.click();
    await flush();
    expect(fake.requests).toHaveLength(0);

    const input = el.querySelector<HTMLInputElement>('[data-testid="confirm-type"]');
    if (!input) throw new Error('no name field');
    input.value = 'orders';
    input.dispatchEvent(new Event('input'));
    await render();
    ok?.click();
    await expect(done).resolves.toEqual({ deleted: 1500 });
    expect(fake.requestsFor('docs.deleteMany')[0]?.params).toMatchObject({ confirmed: true });
  });

  it('deleteMany of exactly 1 000 documents does not need the name', async () => {
    const done = guard.run(
      'docs.deleteMany',
      { profileId: 'dev', db: 'shop', coll: 'orders', filter: '{}' },
      { count: 1000 },
    );
    await flush();
    expect(confirm.current()?.typeToConfirm).toBeUndefined();
    confirm.answer(true);
    await done;
  });

  it('alwaysConfirm asks for writes the rules would let through', async () => {
    const done = guard.run(
      'docs.insert',
      { profileId: 'dev', db: 'shop', coll: 'orders', docs: [DOC] },
      { alwaysConfirm: true, title: 'Clone document', confirmLabel: 'Clone' },
    );
    await flush();
    expect(confirm.current()).toMatchObject({ title: 'Clone document', confirmLabel: 'Clone' });
    confirm.answer(true);
    await done;
    expect(fake.requestsFor('docs.insert')[0]?.params).toMatchObject({ confirmed: true });
  });

  it('an abort while the dialog is open closes it and sends nothing', async () => {
    const controller = new AbortController();
    const done = guard.run(
      'docs.insert',
      { profileId: 'prod', db: 'shop', coll: 'orders', docs: [DOC] },
      { signal: controller.signal },
    );
    await flush();
    expect(confirm.current()).not.toBeNull();
    controller.abort();
    expect(confirm.current()).toBeNull();
    confirm.answer(true);
    await expect(done).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(fake.requests).toHaveLength(0);
  });

  it('approve() returns the params to send without sending them', async () => {
    const approved = guard.approve('agg.run', {
      profileId: 'prod',
      db: 'shop',
      coll: 'orders',
      pipeline: '[{"$out":"archive"}]',
    });
    await flush();
    expect(confirm.current()?.operation).toContain('aggregate([');
    confirm.answer(true);
    await expect(approved).resolves.toMatchObject({
      confirmed: true,
      pipeline: expect.any(String),
    });
    expect(fake.requests).toHaveLength(0);
  });

  it('deleteMany of 1 001 documents (count option) needs the name; the option wins over expectedCount', async () => {
    const done = guard.run(
      'docs.deleteMany',
      { profileId: 'dev', db: 'shop', coll: 'orders', filter: '{}', expectedCount: 5 },
      { count: 1001 },
    );
    await flush();
    expect(confirm.current()).toMatchObject({
      typeToConfirm: 'orders',
      detail: 'Affects 1 001 documents.',
    });
    confirm.answer(true);
    await expect(done).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(fake.requests).toHaveLength(0);
  });

  it('deleteMany without a known count does not ask for the name', async () => {
    const done = guard.run('docs.deleteMany', {
      profileId: 'dev',
      db: 'shop',
      coll: 'orders',
      filter: '{}',
    });
    await flush();
    expect(confirm.current()?.typeToConfirm).toBeUndefined();
    expect(confirm.current()?.detail).toBeUndefined();
    confirm.answer(true);
    await done;
  });

  it('updateMany over 1 000 documents does not ask for the name', async () => {
    const done = guard.run(
      'docs.updateMany',
      { profileId: 'dev', db: 'shop', coll: 'orders', filter: '{}', update: '{"$set":{"a":1}}' },
      { count: 50_000 },
    );
    await flush();
    expect(confirm.current()?.typeToConfirm).toBeUndefined();
    expect(confirm.current()?.destructive).toBe(false);
    confirm.answer(true);
    await done;
  });

  it('cancelling a type-to-confirm delete sends nothing', async () => {
    const done = guard.run('docs.deleteMany', {
      profileId: 'prod',
      db: 'shop',
      coll: 'orders',
      filter: '{}',
      expectedCount: 12_431,
    });
    await render();
    expect(el.querySelector('[data-testid="confirm-production"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="confirm-detail"]')?.textContent).toBe(
      'Affects 12 431 documents.',
    );
    el.querySelector<HTMLButtonElement>('[data-testid="confirm-cancel"]')?.click();
    await expect(done).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(fake.requests).toHaveLength(0);
  });

  it('other destructive writes can opt in to type-to-confirm', async () => {
    fake.respond('coll.drop', {});
    const done = guard.run(
      'coll.drop',
      { profileId: 'prod', db: 'shop', coll: 'orders' },
      { typeToConfirm: 'orders', confirmLabel: 'Drop collection' },
    );
    await flush();
    expect(confirm.current()).toMatchObject({
      title: 'Drop collection',
      operation: 'db.getSiblingDB("shop").getCollection("orders").drop()',
      destructive: true,
      typeToConfirm: 'orders',
    });
    confirm.setTyped('orders');
    confirm.answer(true);
    await done;
    expect(fake.requestsFor('coll.drop')[0]?.params).toMatchObject({ confirmed: true });
  });

  it('database writes show the database as namespace; detail and destructive can be overridden', async () => {
    fake.respond('db.drop', {});
    const done = guard.run(
      'db.drop',
      { profileId: 'prod', db: 'shop' },
      { detail: 'Drops 4 collections.', destructive: false },
    );
    await flush();
    expect(confirm.current()).toMatchObject({
      title: 'Drop database',
      namespace: 'shop',
      detail: 'Drops 4 collections.',
      destructive: false,
      connection: { name: 'prod-eu', production: true },
    });
    confirm.answer(true);
    await done;
  });

  it('a single document count reads "1 document"', async () => {
    const done = guard.run(
      'docs.deleteMany',
      { profileId: 'dev', db: 'shop', coll: 'orders', filter: '{}' },
      { count: 1 },
    );
    await flush();
    expect(confirm.current()?.detail).toBe('Affects 1 document.');
    confirm.answer(false);
    await expect(done).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('unknown profiles are not production: single writes go out without a dialog', async () => {
    await insert('unknown');
    expect(confirm.current()).toBeNull();
    expect(fake.requestsFor('docs.insert')[0]?.params).not.toHaveProperty('confirmed');
  });

  it('a bulk write on an unknown profile shows no connection in the dialog', async () => {
    const done = guard.run('docs.deleteMany', {
      profileId: 'unknown',
      db: 'shop',
      coll: 'orders',
      filter: '{}',
    });
    await flush();
    expect(confirm.current()?.connection).toBeUndefined();
    confirm.answer(false);
    await expect(done).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('read-only wins over alwaysConfirm and bulk writes', async () => {
    await expect(
      guard.run(
        'docs.insert',
        { profileId: 'ro', db: 'shop', coll: 'orders', docs: [DOC] },
        { alwaysConfirm: true },
      ),
    ).rejects.toMatchObject({ code: 'READ_ONLY' });
    await expect(
      guard.approve('docs.deleteMany', {
        profileId: 'ro',
        db: 'shop',
        coll: 'orders',
        filter: '{}',
      }),
    ).rejects.toMatchObject({ code: 'READ_ONLY' });
    expect(confirm.current()).toBeNull();
    expect(fake.requests).toHaveLength(0);
  });

  it('a caller-supplied confirmed: false is not sent either', async () => {
    const params = { profileId: 'dev', db: 'shop', coll: 'orders', docs: [DOC], confirmed: false };
    await guard.run('docs.insert', params);
    expect(fake.requestsFor('docs.insert')[0]?.params).not.toHaveProperty('confirmed');
  });

  it('an already aborted signal opens no dialog and sends nothing', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      guard.run(
        'docs.insert',
        { profileId: 'prod', db: 'shop', coll: 'orders', docs: [DOC] },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(confirm.current()).toBeNull();
    expect(fake.requests).toHaveLength(0);
  });

  it('two production writes are confirmed one after the other', async () => {
    const first = insert('prod');
    const second = guard.run('docs.deleteMany', {
      profileId: 'prod',
      db: 'shop',
      coll: 'orders',
      filter: '{}',
    });
    await flush();
    expect(confirm.current()?.title).toBe('Insert documents');
    confirm.answer(false);
    await expect(first).rejects.toMatchObject({ code: 'CANCELLED' });
    await flush();
    expect(confirm.current()?.title).toBe('Delete documents');
    confirm.answer(true);
    await second;
    expect(fake.requests.map((r) => r.method)).toEqual(['docs.deleteMany']);
    expect(fake.requests[0]?.params).toMatchObject({ confirmed: true });
  });

  it('a backend error after confirming reaches the caller', async () => {
    fake.fail('docs.insert', { code: 'CONFIRMATION_REQUIRED', message: 'no' });
    const done = insert('prod');
    await flush();
    confirm.answer(true);
    await expect(done).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    expect(fake.requestsFor('docs.insert')[0]?.params).toMatchObject({ confirmed: true });
  });

  it('needsConfirmation: bulk writes everywhere, other writes on production only', () => {
    expect(guard.needsConfirmation('docs.updateMany', 'dev')).toBe(true);
    expect(guard.needsConfirmation('docs.deleteMany', 'unknown')).toBe(true);
    expect(guard.needsConfirmation('docs.insert', 'dev')).toBe(false);
    expect(guard.needsConfirmation('docs.insert', 'prod')).toBe(true);
    expect(guard.needsConfirmation('coll.drop', 'prod')).toBe(true);
  });

  it('writes without a database (killOp) show no namespace', async () => {
    const done = guard.approve('admin.killOp', { profileId: 'prod', opId: '{"$numberInt":"42"}' });
    await flush();
    expect(confirm.current()).toMatchObject({
      title: 'Kill operation',
      operation: 'db.killOp(42)',
      destructive: true,
    });
    expect(confirm.current()?.namespace).toBeUndefined();
    confirm.answer(true);
    await expect(done).resolves.toMatchObject({ confirmed: true });
  });

  it('flag changes take effect on the next write', async () => {
    safety.set({ id: 'dev', name: 'local', readOnly: true, production: false });
    await expect(insert('dev')).rejects.toMatchObject({ code: 'READ_ONLY' });
    safety.remove('dev');
    await insert('dev');
    expect(fake.requestsFor('docs.insert')).toHaveLength(1);
  });
});

describe('WriteGuard.approveAll (several writes, one confirm)', () => {
  let fake: FakeThicketBridge;
  let guard: WriteGuard;
  let confirm: ConfirmService;

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  /** One `docs.update` per id, as a batch edit of one field sends them. */
  const updates = (profileId: string, ids: number[]) =>
    ids.map((id) => ({
      profileId,
      db: 'shop',
      coll: 'orders',
      id: `{"$numberInt":"${id}"}`,
      update: '{"$set":{"status":"shipped"}}',
      expected: '{"status":{"$eq":"open"}}',
    }));
  const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

  beforeEach(() => {
    fake = new FakeThicketBridge();
    TestBed.configureTestingModule({ providers: [provideFakeThicket(fake)] });
    guard = TestBed.inject(WriteGuard);
    confirm = TestBed.inject(ConfirmService);
    const safety = TestBed.inject(ProfileSafetyService);
    safety.set({ id: 'prod', name: 'prod-eu', readOnly: false, production: true });
    safety.set({ id: 'dev', name: 'local', readOnly: false, production: false });
    safety.set({ id: 'ro', name: 'reporting', readOnly: true, production: true });
  });

  it('an empty batch resolves with nothing and asks nothing', async () => {
    await expect(guard.approveAll('docs.update', [], { alwaysConfirm: true })).resolves.toEqual([]);
    expect(confirm.current()).toBeNull();
  });

  it('non-production without alwaysConfirm: no dialog, params returned without confirmed', async () => {
    const withFlag = updates('dev', [1, 2]).map((p) => ({ ...p, confirmed: true }));
    const approved = await guard.approveAll('docs.update', withFlag);
    expect(confirm.current()).toBeNull();
    expect(approved).toHaveLength(2);
    for (const p of approved) expect(p).not.toHaveProperty('confirmed');
    expect(approved.map((p) => p.id)).toEqual(['{"$numberInt":"1"}', '{"$numberInt":"2"}']);
    // Nothing is sent: the caller sends the approved params.
    expect(fake.requests).toHaveLength(0);
  });

  it('production: one dialog for the whole batch with the count; confirmed: true on every write', async () => {
    const done = guard.approveAll('docs.update', updates('prod', [1, 2, 3]));
    await flush();
    expect(confirm.current()).toMatchObject({
      title: 'Update document',
      detail: 'Affects 3 documents.',
      namespace: 'shop.orders',
      connection: { name: 'prod-eu', production: true },
      destructive: false,
    });
    expect(confirm.current()?.operation.match(/updateOne\(/g)).toHaveLength(3);
    expect(confirm.current()?.operation).not.toContain('more');
    confirm.answer(true);
    const approved = await done;
    expect(approved).toHaveLength(3);
    for (const p of approved) expect(p).toMatchObject({ confirmed: true });
    expect(approved.map((p) => p.id)).toEqual(updates('prod', [1, 2, 3]).map((p) => p.id));
    expect(confirm.current()).toBeNull();
    expect(fake.requests).toHaveLength(0);
  });

  it('alwaysConfirm asks on a non-production profile; options describe the dialog', async () => {
    const done = guard.approveAll('docs.update', updates('dev', [1, 2]), {
      alwaysConfirm: true,
      title: 'Update 2 documents',
      confirmLabel: 'Save 2 documents',
      detail: 'Updates 2 documents, one updateOne each.',
    });
    await flush();
    expect(confirm.current()).toMatchObject({
      title: 'Update 2 documents',
      confirmLabel: 'Save 2 documents',
      detail: 'Updates 2 documents, one updateOne each.',
      connection: { name: 'local', production: false },
    });
    confirm.answer(true);
    await expect(done).resolves.toHaveLength(2);
  });

  it('cancel rejects with CANCELLED', async () => {
    const done = guard.approveAll('docs.update', updates('prod', [1, 2]));
    await flush();
    confirm.answer(false);
    await expect(done).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(fake.requests).toHaveLength(0);
  });

  it('exactly 10 writes are all listed, without a "more" line', async () => {
    const done = guard.approveAll('docs.update', updates('prod', range(10)));
    await flush();
    const operation = confirm.current()?.operation ?? '';
    expect(operation.match(/updateOne\(/g)).toHaveLength(10);
    expect(operation).not.toContain('more');
    expect(confirm.current()?.detail).toBe('Affects 10 documents.');
    confirm.answer(false);
    await expect(done).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('more than 10 writes: the first 10 operations, then how many more (formatted count)', async () => {
    const done = guard.approveAll('docs.update', updates('prod', range(1011)));
    await flush();
    const operation = confirm.current()?.operation ?? '';
    expect(operation.match(/updateOne\(/g)).toHaveLength(10);
    // formatCount separates thousands with a narrow no-break space.
    expect(operation.split('\n').at(-1)).toBe('// … and 1 001 more');
    expect(confirm.current()?.detail).toBe('Affects 1 011 documents.');
    // A batch of updates never needs the collection name typed.
    expect(confirm.current()?.typeToConfirm).toBeUndefined();
    confirm.answer(true);
    await expect(done).resolves.toHaveLength(1011);
  });

  it('the count option overrides the number of writes in the dialog', async () => {
    const done = guard.approveAll('docs.update', updates('prod', [1, 2]), { count: 7 });
    await flush();
    expect(confirm.current()?.detail).toBe('Affects 7 documents.');
    confirm.answer(false);
    await expect(done).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('read-only is refused with READ_ONLY, also with alwaysConfirm', async () => {
    await expect(
      guard.approveAll('docs.update', updates('ro', [1, 2]), { alwaysConfirm: true }),
    ).rejects.toMatchObject({ code: 'READ_ONLY', message: 'reporting is read-only.' });
    expect(confirm.current()).toBeNull();
  });

  it('writes to several profiles in one batch are refused before any dialog', async () => {
    await expect(
      guard.approveAll('docs.update', [...updates('dev', [1]), ...updates('prod', [2])], {
        alwaysConfirm: true,
      }),
    ).rejects.toThrow(/same profile/);
    // Also when the read-only profile is not the first: no write slips past its check.
    await expect(
      guard.approveAll('docs.update', [...updates('dev', [1]), ...updates('ro', [2])]),
    ).rejects.toThrow(/same profile/);
    expect(confirm.current()).toBeNull();
  });

  it('an already aborted signal opens no dialog', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      guard.approveAll('docs.update', updates('prod', [1]), { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(confirm.current()).toBeNull();
  });

  it('an abort while the dialog is open cancels the batch', async () => {
    const controller = new AbortController();
    const done = guard.approveAll('docs.update', updates('prod', [1, 2]), {
      signal: controller.signal,
    });
    await flush();
    expect(confirm.current()).not.toBeNull();
    controller.abort();
    confirm.answer(true);
    await expect(done).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});
