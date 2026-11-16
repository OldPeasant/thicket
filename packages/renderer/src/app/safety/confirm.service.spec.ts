import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { ConfirmService, type ConfirmRequest } from './confirm.service';

function request(title: string, extra: Partial<ConfirmRequest> = {}): ConfirmRequest {
  return { title, operation: `db.op("${title}")`, confirmLabel: 'Confirm', ...extra };
}

describe('ConfirmService', () => {
  let service: ConfirmService;

  beforeEach(() => {
    service = TestBed.inject(ConfirmService);
  });

  it('shows nothing until a confirmation is asked', () => {
    expect(service.current()).toBeNull();
  });

  it('answer() without a shown request does nothing', () => {
    expect(() => service.answer(true)).not.toThrow();
    expect(service.current()).toBeNull();
  });

  it('shows one request at a time; later ones wait and are answered separately', async () => {
    const first = service.confirm(request('first'));
    const second = service.confirm(request('second'));
    expect(service.current()?.title).toBe('first');

    service.answer(false);
    await expect(first).resolves.toBe(false);
    expect(service.current()?.title).toBe('second');

    service.answer(true);
    await expect(second).resolves.toBe(true);
    expect(service.current()).toBeNull();
  });

  it('an aborted signal withdraws the shown request: it resolves false and the next one shows', async () => {
    const controller = new AbortController();
    const first = service.confirm(request('first'), controller.signal);
    const second = service.confirm(request('second'));
    expect(service.current()?.title).toBe('first');

    controller.abort();
    await expect(first).resolves.toBe(false);
    expect(service.current()?.title).toBe('second');

    service.answer(true);
    await expect(second).resolves.toBe(true);
    expect(service.current()).toBeNull();
  });

  it('an aborted signal withdraws a waiting request without touching the shown one', async () => {
    const controller = new AbortController();
    const first = service.confirm(request('first'));
    const second = service.confirm(request('second'), controller.signal);

    controller.abort();
    await expect(second).resolves.toBe(false);
    expect(service.current()?.title).toBe('first');

    service.answer(true);
    await expect(first).resolves.toBe(true);
    expect(service.current()).toBeNull();
  });

  it('an already aborted signal shows nothing; an abort after the answer changes nothing', async () => {
    const aborted = new AbortController();
    aborted.abort();
    await expect(service.confirm(request('gone'), aborted.signal)).resolves.toBe(false);
    expect(service.current()).toBeNull();

    const later = new AbortController();
    const answered = service.confirm(request('answered'), later.signal);
    const next = service.confirm(request('next'));
    service.answer(true);
    await expect(answered).resolves.toBe(true);
    later.abort();
    expect(service.current()?.title).toBe('next');
    service.answer(false);
    await expect(next).resolves.toBe(false);
  });

  it('withdrawing the shown request clears the typed name for the next one', async () => {
    const controller = new AbortController();
    const first = service.confirm(request('first', { typeToConfirm: 'orders' }), controller.signal);
    const second = service.confirm(request('second', { typeToConfirm: 'orders' }));
    service.setTyped('orders');
    controller.abort();
    await expect(first).resolves.toBe(false);
    expect(service.current()?.title).toBe('second');
    service.answer(true);
    await expect(second).resolves.toBe(false);
  });

  it('withdrawing a waiting request keeps the name typed into the shown one', async () => {
    const controller = new AbortController();
    const first = service.confirm(request('first', { typeToConfirm: 'orders' }));
    const second = service.confirm(request('second'), controller.signal);
    service.setTyped('orders');
    controller.abort();
    await expect(second).resolves.toBe(false);
    service.answer(true);
    await expect(first).resolves.toBe(true);
    expect(service.current()).toBeNull();
  });

  it('the last shown request withdrawn closes the dialog', async () => {
    const controller = new AbortController();
    const only = service.confirm(request('only'), controller.signal);
    expect(service.current()?.title).toBe('only');
    controller.abort();
    await expect(only).resolves.toBe(false);
    expect(service.current()).toBeNull();
    // A later answer has nothing to answer.
    service.answer(true);
    expect(service.current()).toBeNull();
  });

  it('type-to-confirm: answer(true) is accepted only with the exact text typed', async () => {
    const wrong = service.confirm(request('a', { typeToConfirm: 'orders' }));
    service.setTyped('ORDERS');
    service.answer(true);
    await expect(wrong).resolves.toBe(false);

    const right = service.confirm(request('b', { typeToConfirm: 'orders' }));
    service.setTyped('orders');
    service.answer(true);
    await expect(right).resolves.toBe(true);
  });

  it('the typed text does not carry over to the next request', async () => {
    const first = service.confirm(request('a', { typeToConfirm: 'orders' }));
    const second = service.confirm(request('b', { typeToConfirm: 'orders' }));
    service.setTyped('orders');
    service.answer(true);
    await expect(first).resolves.toBe(true);
    // Nothing typed for the second request: confirming must not use the first one's text.
    service.answer(true);
    await expect(second).resolves.toBe(false);
  });

  it('cancelling a type-to-confirm request resolves false even with the name typed', async () => {
    const answer = service.confirm(request('a', { typeToConfirm: 'orders' }));
    service.setTyped('orders');
    service.answer(false);
    await expect(answer).resolves.toBe(false);
  });
});
