import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { pageWindow, type PageWindow } from '../page.util';
import { PagerComponent } from './pager.component';

@Component({
  standalone: true,
  imports: [PagerComponent],
  template: `<app-pager [window]="window()" [noun]="noun()" (pageChange)="changes.push($event)" />`,
})
class Host {
  readonly window = signal<PageWindow>(pageWindow(2000, 100, 0));
  readonly noun = signal('items');
  readonly changes: number[] = [];
}

describe('PagerComponent', () => {
  let fixture: ComponentFixture<Host>;
  const host = () => fixture.componentInstance;
  const el = () => fixture.nativeElement as HTMLElement;
  const get = <T extends HTMLElement>(testId: string): T => {
    const found = el().querySelector<T>(`[data-testid="${testId}"]`);
    if (!found) throw new Error(`no ${testId}`);
    return found;
  };
  const show = async (w: PageWindow) => {
    host().window.set(w);
    await fixture.whenStable();
  };
  const type = (value: string, how: 'enter' | 'blur' = 'enter') => {
    const input = get<HTMLInputElement>('nested-pager-page');
    input.value = value;
    input.dispatchEvent(
      how === 'enter' ? new KeyboardEvent('keydown', { key: 'Enter' }) : new Event('blur'),
    );
    return input;
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [provideZonelessChangeDetection()],
    });
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('shows the range with thousands separators, the noun and the page count', () => {
    expect(get('nested-pager-range').textContent?.trim()).toBe('1–100 of 2,000 items');
    expect(get('nested-pager').textContent).toContain('of 20');
    expect(get<HTMLInputElement>('nested-pager-page').value).toBe('1');
    expect(get('nested-pager').getAttribute('aria-label')).toBe('Pages of items');
  });

  it('names the entries as told', async () => {
    host().noun.set('fields');
    await show(pageWindow(250, 100, 2));
    expect(get('nested-pager-range').textContent?.trim()).toBe('201–250 of 250 fields');
    expect(get('nested-pager-page').getAttribute('aria-label')).toBe('Page of fields (1 to 3)');
  });

  it('disables first/previous on the first page and next/last on the last', async () => {
    const disabled = (id: string) => get<HTMLButtonElement>(id).disabled;
    expect([
      disabled('nested-pager-first'),
      disabled('nested-pager-prev'),
      disabled('nested-pager-next'),
      disabled('nested-pager-last'),
    ]).toEqual([true, true, false, false]);
    await show(pageWindow(2000, 100, 19));
    expect([
      disabled('nested-pager-first'),
      disabled('nested-pager-prev'),
      disabled('nested-pager-next'),
      disabled('nested-pager-last'),
    ]).toEqual([false, false, true, true]);
    await show(pageWindow(2000, 100, 6));
    expect(disabled('nested-pager-prev') || disabled('nested-pager-next')).toBe(false);
  });

  it('emits the 0-based page for each button', async () => {
    await show(pageWindow(2000, 100, 6));
    get<HTMLButtonElement>('nested-pager-next').click();
    get<HTMLButtonElement>('nested-pager-prev').click();
    get<HTMLButtonElement>('nested-pager-last').click();
    get<HTMLButtonElement>('nested-pager-first').click();
    expect(host().changes).toEqual([7, 5, 19, 0]);
  });

  it('jumps to a typed page on Enter and on leaving the field (1-based input)', () => {
    type('7');
    type(' 12 ', 'blur');
    expect(host().changes).toEqual([6, 11]);
  });

  it('clamps a typed page to the existing pages', () => {
    type('999');
    expect(host().changes).toEqual([19]);
    // 0 and negatives go to the first page, which is already shown: nothing to emit.
    type('0');
    type('-3');
    expect(host().changes).toEqual([19]);
  });

  it('ignores empty, non-numeric and fractional input and shows the current page again', async () => {
    await show(pageWindow(2000, 100, 6));
    for (const bad of ['', '   ', 'abc', '2.5', '1e']) {
      const input = type(bad);
      expect(input.value).toBe('7');
    }
    expect(host().changes).toEqual([]);
  });

  it('does not emit for the page already shown', async () => {
    await show(pageWindow(2000, 100, 6));
    type('7');
    expect(host().changes).toEqual([]);
  });

  it('keeps clicks on the pager from reaching the row around it', () => {
    let reached = false;
    el().addEventListener('click', () => (reached = true));
    get<HTMLButtonElement>('nested-pager-next').click();
    expect(reached).toBe(false);
    expect(host().changes).toEqual([1]);
  });
});
