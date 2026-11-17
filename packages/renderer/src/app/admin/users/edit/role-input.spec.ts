import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import type { RoleRef } from '../users-roles.model';
import { RoleInput } from './role-input';

describe('RoleInput', () => {
  let fixture: ComponentFixture<RoleInput>;
  let picked: RoleRef[];

  const el = () => fixture.nativeElement as HTMLElement;
  const get = <T extends HTMLElement>(id: string): T => {
    const found = el().querySelector<T>(`[data-testid="${id}"]`);
    if (found === null) throw new Error(`no element ${id}`);
    return found;
  };
  const field = () => get<HTMLInputElement>('role-input');
  const button = () => get<HTMLButtonElement>('role-add');
  const alert = () => el().querySelector('[role="alert"]');
  const suggestions = () =>
    [...el().querySelectorAll('datalist option')].map((o) => o.getAttribute('value'));
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
  };
  const type = async (value: string) => {
    field().value = value;
    field().dispatchEvent(new Event('input'));
    await settle();
  };
  const enter = async () => {
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    await settle();
  };

  async function create(inputs: Record<string, unknown> = {}) {
    fixture = TestBed.createComponent(RoleInput);
    fixture.componentRef.setInput('db', 'shop');
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.componentInstance.picked.subscribe((ref) => picked.push(ref));
    await settle();
  }

  beforeEach(() => {
    picked = [];
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('emits the typed role of its database and empties the field by default', async () => {
    await create();
    await type('clerk');
    button().click();
    await settle();
    expect(picked).toEqual([{ role: 'clerk', db: 'shop' }]);
    expect(field().value).toBe('');
    expect(button().disabled).toBe(true);
  });

  it('Enter picks the role like the button, name@db names another database', async () => {
    await create();
    await type('readAnyDatabase@admin');
    await enter();
    expect(picked).toEqual([{ role: 'readAnyDatabase', db: 'admin' }]);
  });

  it('with clearOnPick off the role stays in the field until clear() is called', async () => {
    await create({ clearOnPick: false });
    await type('nope');
    button().click();
    await settle();
    expect(picked).toEqual([{ role: 'nope', db: 'shop' }]);
    expect(field().value).toBe('nope');
    expect(button().disabled).toBe(false);
    fixture.componentInstance.clear();
    await settle();
    expect(field().value).toBe('');
    expect(button().disabled).toBe(true);
  });

  it('a malformed role shows an alert, marks the field invalid and emits nothing', async () => {
    await create({ clearOnPick: false });
    await type('clerk@');
    await enter();
    expect(picked).toEqual([]);
    expect(alert()?.textContent).toContain('The database is missing after "@"');
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(field().value).toBe('clerk@');
  });

  it('clear() also ends a shown error', async () => {
    await create();
    await type('@shop');
    await enter();
    expect(alert()?.textContent).toContain('The role name is missing');
    fixture.componentInstance.clear();
    await settle();
    expect(alert()).toBeNull();
    expect(field().getAttribute('aria-invalid')).toBeNull();
    expect(field().value).toBe('');
  });

  it('typing again ends the error', async () => {
    await create();
    await type('clerk@');
    await enter();
    expect(alert()).not.toBeNull();
    await type('clerk');
    expect(alert()).toBeNull();
  });

  it('while disabled, Enter emits nothing and keeps the text', async () => {
    await create({ clearOnPick: true });
    await type('clerk');
    fixture.componentRef.setInput('disabled', true);
    await settle();
    expect(field().disabled).toBe(true);
    expect(button().disabled).toBe(true);
    await enter();
    expect(picked).toEqual([]);
    expect(field().value).toBe('clerk');
  });

  it('suggests admin roles as name@admin outside admin, none when the roles go to a role there', async () => {
    await create({ known: ['clerk'] });
    expect(suggestions()).toContain('clerk');
    expect(suggestions()).toContain('read');
    expect(suggestions()).toContain('readAnyDatabase@admin');
    fixture.componentRef.setInput('forRole', true);
    await settle();
    expect(suggestions()).toContain('clerk');
    expect(suggestions()).toContain('read');
    expect(suggestions().some((s) => s?.includes('@'))).toBe(false);
  });

  it('in admin a role still gets the admin roles, by their plain names', async () => {
    await create({ forRole: true });
    fixture.componentRef.setInput('db', 'admin');
    await settle();
    expect(suggestions()).toContain('readAnyDatabase');
    expect(suggestions()).toContain('read');
    expect(suggestions().some((s) => s?.includes('@'))).toBe(false);
  });

  it('two fields get their own suggestion lists', async () => {
    await create();
    const first = field().getAttribute('list');
    const other = TestBed.createComponent(RoleInput);
    other.componentRef.setInput('db', 'shop');
    await other.whenStable();
    const second = (other.nativeElement as HTMLElement)
      .querySelector('[data-testid="role-input"]')
      ?.getAttribute('list');
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    expect(el().querySelector('datalist')?.id).toBe(first);
  });
});
