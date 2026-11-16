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
