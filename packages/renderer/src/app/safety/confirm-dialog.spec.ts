import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { ConfirmDialog } from './confirm-dialog';
import { ConfirmService, type ConfirmRequest } from './confirm.service';

const OPERATION = 'db.getSiblingDB("shop").getCollection("orders").deleteMany({ status: "old" })';

function request(extra: Partial<ConfirmRequest> = {}): ConfirmRequest {
  return { title: 'Delete documents', operation: OPERATION, confirmLabel: 'Delete', ...extra };
}

describe('ConfirmDialog', () => {
  let fixture: ComponentFixture<ConfirmDialog>;
  let service: ConfirmService;
  let el: HTMLElement;

  const dialog = () => el.querySelector<HTMLElement>('[data-testid="confirm-dialog"]');
  const ok = () => el.querySelector<HTMLButtonElement>('[data-testid="confirm-ok"]');
  const cancel = () => el.querySelector<HTMLButtonElement>('[data-testid="confirm-cancel"]');
  const typeField = () => el.querySelector<HTMLInputElement>('[data-testid="confirm-type"]');
  const render = () => fixture.whenStable();

  async function type(text: string): Promise<void> {
    const input = typeField();
    if (!input) throw new Error('no type-to-confirm field');
    input.value = text;
    input.dispatchEvent(new Event('input'));
    await render();
  }

  beforeEach(async () => {
    fixture = TestBed.createComponent(ConfirmDialog);
    service = TestBed.inject(ConfirmService);
    el = fixture.nativeElement as HTMLElement;
    document.body.appendChild(el);
    await render();
  });

  it('renders nothing while no confirmation is asked', () => {
    expect(dialog()).toBeNull();
  });

  it('shows the exact operation text, the title, connection and detail', async () => {
    void service.confirm(
      request({
        connection: { name: 'prod-eu', production: true },
        namespace: 'shop.orders',
        detail: 'Affects 3 documents.',
      }),
    );
    await render();
    expect(dialog()?.getAttribute('role')).toBe('alertdialog');
    expect(dialog()?.getAttribute('aria-modal')).toBe('true');
    expect(el.querySelector('[data-testid="confirm-operation"]')?.textContent).toBe(OPERATION);
    expect(el.querySelector('#confirm-title')?.textContent).toBe('Delete documents');
    expect(el.querySelector('[data-testid="confirm-target"]')?.textContent).toContain('prod-eu');
    expect(el.querySelector('[data-testid="confirm-production"]')?.textContent).toBe('Production');
    expect(dialog()?.classList).toContain('production');
    expect(el.querySelector('[data-testid="confirm-detail"]')?.textContent).toBe(
      'Affects 3 documents.',
    );
    expect(ok()?.textContent?.trim()).toBe('Delete');
  });

  it('shows no production flag for other connections', async () => {
    void service.confirm(request({ connection: { name: 'dev', production: false } }));
    await render();
    expect(el.querySelector('[data-testid="confirm-production"]')).toBeNull();
    expect(dialog()?.classList).not.toContain('production');
  });

  it('cancel aborts: the promise resolves false and the dialog closes', async () => {
    const answer = service.confirm(request());
    await render();
    cancel()?.click();
    await expect(answer).resolves.toBe(false);
    await render();
    expect(dialog()).toBeNull();
  });

  it('Escape aborts', async () => {
    const answer = service.confirm(request());
    await render();
    dialog()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect(answer).resolves.toBe(false);
  });

  it('the confirm button resolves true', async () => {
    const answer = service.confirm(request());
    await render();
    expect(ok()?.disabled).toBe(false);
    ok()?.click();
    await expect(answer).resolves.toBe(true);
  });

  it('enforces type-to-confirm: disabled until the exact name is typed', async () => {
    const answer = service.confirm(request({ typeToConfirm: 'orders' }));
    await render();
    expect(typeField()).not.toBeNull();
    expect(el.querySelector('.type')?.textContent).toContain('orders');
    expect(ok()?.disabled).toBe(true);

    await type('order');
    expect(ok()?.disabled).toBe(true);
    expect(typeField()?.getAttribute('aria-invalid')).toBe('true');
    await type('Orders');
    expect(ok()?.disabled).toBe(true);
    await type('orders ');
    expect(ok()?.disabled).toBe(true);

    await type('orders');
    expect(ok()?.disabled).toBe(false);
    ok()?.click();
    await expect(answer).resolves.toBe(true);
  });

  it('Enter in the name field confirms only when it matches', async () => {
    const answer = service.confirm(request({ typeToConfirm: 'orders' }));
    await render();
    await type('nope');
    typeField()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await render();
    expect(dialog()).not.toBeNull();
    await type('orders');
    typeField()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await expect(answer).resolves.toBe(true);
  });

  it('the service refuses answer(true) without the typed name', async () => {
    const answer = service.confirm(request({ typeToConfirm: 'orders' }));
    await render();
    service.answer(true);
    await expect(answer).resolves.toBe(false);
  });

  it('starts each request with an empty name field', async () => {
    const first = service.confirm(request({ typeToConfirm: 'orders' }));
    const second = service.confirm(request({ typeToConfirm: 'orders', title: 'Second' }));
    await render();
    await type('orders');
    ok()?.click();
    await expect(first).resolves.toBe(true);
    await render();
    expect(el.querySelector('#confirm-title')?.textContent).toBe('Second');
    expect(typeField()?.value).toBe('');
    expect(ok()?.disabled).toBe(true);
    service.answer(true);
    await expect(second).resolves.toBe(false);
  });

  it('focuses the name field, Cancel for risky writes, else the confirm button', async () => {
    void service.confirm(request({ typeToConfirm: 'orders' }));
    await render();
    expect(document.activeElement).toBe(typeField());
    service.answer(false);

    void service.confirm(request({ destructive: true }));
    await render();
    expect(document.activeElement).toBe(cancel());
    service.answer(false);

    void service.confirm(request());
    await render();
    expect(document.activeElement).toBe(ok());
    service.answer(false);
  });

  it('returns focus to the element focused before it opened', async () => {
    const before = document.createElement('button');
    document.body.appendChild(before);
    before.focus();
    void service.confirm(request());
    await render();
    expect(document.activeElement).not.toBe(before);
    cancel()?.click();
    await render();
    expect(document.activeElement).toBe(before);
    before.remove();
  });

  it('does not try to focus an element removed while the dialog was open', async () => {
    const before = document.createElement('button');
    document.body.appendChild(before);
    before.focus();
    void service.confirm(request());
    await render();
    before.remove();
    cancel()?.click();
    await render();
    expect(dialog()).toBeNull();
    expect(document.activeElement).not.toBe(before);
  });

  it('keeps Tab inside the dialog', async () => {
    void service.confirm(request());
    await render();
    const operation = el.querySelector<HTMLElement>('[data-testid="confirm-operation"]');
    ok()?.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    ok()?.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(operation);
    const back = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    operation?.dispatchEvent(back);
    expect(document.activeElement).toBe(ok());
  });

  it('Tab between inner controls is left to the browser', async () => {
    void service.confirm(request());
    await render();
    cancel()?.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    cancel()?.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(cancel());
  });

  it('shows the namespace without a connection', async () => {
    void service.confirm(request({ namespace: 'shop.orders' }));
    await render();
    expect(el.querySelector('[data-testid="confirm-target"]')).toBeNull();
    expect(el.querySelector('.ns')?.textContent).toBe('shop.orders');
  });

  it('shows neither target nor detail when the request has none', async () => {
    void service.confirm(request());
    await render();
    expect(el.querySelector('.target')).toBeNull();
    expect(el.querySelector('[data-testid="confirm-detail"]')).toBeNull();
    expect(typeField()).toBeNull();
  });

  it('marks destructive writes', async () => {
    void service.confirm(request({ destructive: true }));
    await render();
    expect(dialog()?.classList).toContain('destructive');
  });

  it('focuses Cancel on production connections', async () => {
    void service.confirm(request({ connection: { name: 'prod-eu', production: true } }));
    await render();
    expect(document.activeElement).toBe(cancel());
  });

  it('Escape in the name field aborts even with the name typed', async () => {
    const answer = service.confirm(request({ typeToConfirm: 'orders' }));
    await render();
    await type('orders');
    typeField()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect(answer).resolves.toBe(false);
  });

  it('Enter outside the name field does not confirm', async () => {
    let settled = false;
    void service.confirm(request()).then(() => (settled = true));
    await render();
    el.querySelector('[data-testid="confirm-operation"]')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    await render();
    expect(settled).toBe(false);
    expect(dialog()).not.toBeNull();
  });

  it('the name field is not marked invalid while empty', async () => {
    void service.confirm(request({ typeToConfirm: 'orders' }));
    await render();
    expect(typeField()?.getAttribute('aria-invalid')).toBe('false');
    await type('orders');
    expect(typeField()?.getAttribute('aria-invalid')).toBe('false');
  });

  it('shows type-to-confirm text verbatim (no HTML interpretation)', async () => {
    void service.confirm(
      request({ typeToConfirm: '<b>x</b>', operation: 'db.getCollection("<img src=x>")' }),
    );
    await render();
    expect(el.querySelector('.type b')).toBeNull();
    expect(el.querySelector('.word')?.textContent).toBe('<b>x</b>');
    expect(el.querySelector('[data-testid="confirm-operation"] img')).toBeNull();
  });
});
