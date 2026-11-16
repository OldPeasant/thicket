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

  it('an abort while the dialog is open sends nothing', async () => {
    const controller = new AbortController();
    const done = guard.run(
      'docs.insert',
      { profileId: 'prod', db: 'shop', coll: 'orders', docs: [DOC] },
      { signal: controller.signal },
    );
    await flush();
    controller.abort();
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

  it('flag changes take effect on the next write', async () => {
    safety.set({ id: 'dev', name: 'local', readOnly: true, production: false });
    await expect(insert('dev')).rejects.toMatchObject({ code: 'READ_ONLY' });
    safety.remove('dev');
    await insert('dev');
    expect(fake.requestsFor('docs.insert')).toHaveLength(1);
  });
});
