import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { JsonExplorerComponent } from './json-explorer.component';
import { ArraySliceService } from './services/array-slice.service';
import { EditModeService } from './services/edit-mode.service';
import { NestedPageSizeService } from './services/nested-page-size.service';

interface Item {
  n: number;
  name: string;
}
const items = (length: number): Item[] =>
  Array.from({ length }, (_, i) => ({ n: i, name: `item ${i}` }));

// The explorer as a document view uses it: it owns the document and takes every edit back.
@Component({
  standalone: true,
  imports: [JsonExplorerComponent],
  template: `<app-json-explorer [value]="doc()" (valueChange)="doc.set($event)" />`,
})
class Host {
  readonly doc = signal<unknown>({ _id: 1, items: items(2000) });
}

describe('Paging inside a document', () => {
  let fixture: ComponentFixture<Host>;
  const el = () => fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
  };
  const pager = () => {
    const found = el().querySelector<HTMLElement>('[data-testid="nested-pager"]');
    if (!found) throw new Error('no pager');
    return found;
  };
  const range = () => pager().querySelector('[data-testid="pager-range"]')?.textContent?.trim();
  const click = async (testId: string) => {
    pager().querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)?.click();
    await settle();
  };
  const jumpTo = async (page: string) => {
    const input = pager().querySelector<HTMLInputElement>('[data-testid="pager-page"]');
    if (!input) throw new Error('no page field');
    input.value = page;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await settle();
    return input;
  };
  /** The `name` values shown, in order (string inputs in edit mode, text otherwise). */
  const names = () =>
    [...el().querySelectorAll<HTMLInputElement>('input.val-input.str')].map((i) => i.value);
  const docItems = () => (fixture.componentInstance.doc() as { items: Item[] }).items;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [provideZonelessChangeDetection()],
    });
    TestBed.inject(EditModeService).toggle();
    fixture = TestBed.createComponent(Host);
    await settle();
  });

  it('shows a 2 000-item array one page of 100 at a time, with a pager', () => {
    expect(range()).toBe('1–100 of 2,000 items');
    expect(names()).toHaveLength(100);
    expect(names()[0]).toBe('item 0');
    expect(names()[99]).toBe('item 99');
    expect(pager().textContent).toContain('of 20');
    expect(el().querySelector('.reveal-btn')).toBeNull();
  });

  it('goes to the next, last, previous and first page', async () => {
    await click('pager-next');
    expect(range()).toBe('101–200 of 2,000 items');
    expect(names()[0]).toBe('item 100');
    await click('pager-last');
    expect(range()).toBe('1,901–2,000 of 2,000 items');
    expect(names().at(-1)).toBe('item 1999');
    expect(pager().querySelector<HTMLButtonElement>('[data-testid="pager-next"]')?.disabled).toBe(
      true,
    );
    await click('pager-prev');
    expect(range()).toBe('1,801–1,900 of 2,000 items');
    await click('pager-first');
    expect(range()).toBe('1–100 of 2,000 items');
    expect(pager().querySelector<HTMLButtonElement>('[data-testid="pager-prev"]')?.disabled).toBe(
      true,
    );
  });

  it('jumps to a typed page; an invalid page number keeps the page shown', async () => {
    const input = await jumpTo('7');
    expect(range()).toBe('601–700 of 2,000 items');
    expect(names()[0]).toBe('item 600');
    expect(input.value).toBe('7');

    await jumpTo('abc');
    expect(range()).toBe('601–700 of 2,000 items');
    expect(pager().querySelector<HTMLInputElement>('[data-testid="pager-page"]')?.value).toBe('7');

    // Beyond the last page: the last page.
    await jumpTo('99');
    expect(range()).toBe('1,901–2,000 of 2,000 items');
  });

  it('keeps an edit made on page 7 when paging away and back', async () => {
    await jumpTo('7');
    const cell = [...el().querySelectorAll<HTMLInputElement>('input.val-input.str')].find(
      (i) => i.value === 'item 650',
    );
    if (!cell) throw new Error('item 650 not shown on page 7');
    cell.value = 'edited 650';
    cell.dispatchEvent(new Event('blur'));
    await settle();
    expect(docItems()[650]?.name).toBe('edited 650');

    await click('pager-first');
    expect(names()).not.toContain('edited 650');
    await click('pager-next');
    await jumpTo('20');

    await jumpTo('7');
    expect(range()).toBe('601–700 of 2,000 items');
    expect(names()[50]).toBe('edited 650');
    // Nothing else changed, and the array is still whole.
    expect(docItems()).toHaveLength(2000);
    expect(docItems()[649]?.name).toBe('item 649');
    expect(docItems()[651]?.name).toBe('item 651');
  });

  it('follows the page size setting', async () => {
    TestBed.inject(NestedPageSizeService).size.set(500);
    await settle();
    expect(range()).toBe('1–500 of 2,000 items');
    expect(names()).toHaveLength(500);
  });

  it('shows an array at or below the page size without a pager', async () => {
    fixture.componentInstance.doc.set({ _id: 1, items: items(100) });
    await settle();
    expect(el().querySelector('[data-testid="nested-pager"]')).toBeNull();
    expect(names()).toHaveLength(100);
  });

  it('pages objects with more than a page of fields', async () => {
    const big = Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`k${i}`, `v${i}`]));
    fixture.componentInstance.doc.set({ _id: 1, big });
    await settle();
    expect(range()).toBe('1–100 of 250 fields');
    await click('pager-last');
    expect(range()).toBe('201–250 of 250 fields');
    expect(names()[0]).toBe('v200');
  });

  it('adding an item to a paged array shows the page it landed on', async () => {
    const add = [...el().querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.title === 'Add item' || b.title === 'Add row',
    );
    if (!add) throw new Error('no add button');
    add.click();
    await settle();
    expect(docItems()).toHaveLength(2001);
    expect(range()).toBe('2,001–2,001 of 2,001 items');
  });
});

describe('Paging a partly loaded array (large document)', () => {
  let fixture: ComponentFixture<Host>;
  const el = () => fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
  };
  /** The item names shown (`item 123`), in order. */
  const names = () =>
    [...el().querySelectorAll('.val')]
      .map((v) => /^"?(item \d+)"?$/.exec(v.textContent?.trim() ?? '')?.[1])
      .filter((t): t is string => t !== undefined);
  const pagerButton = (testId: string) =>
    el().querySelector<HTMLButtonElement>(`[data-testid="nested-pager"] [data-testid="${testId}"]`);

  let calls: { skip: number; limit: number }[];
  let fail: boolean;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [provideZonelessChangeDetection()],
    });
    calls = [];
    fail = false;
    fixture = TestBed.createComponent(Host);
    const loaded = items(100);
    fixture.componentInstance.doc.set({ _id: 1, items: loaded });
    TestBed.inject(ArraySliceService).register(loaded, {}, 'items', {
      total: 50_000,
      load: (skip, limit) => {
        calls.push({ skip, limit });
        if (fail) return Promise.reject(new Error('server gone'));
        return Promise.resolve(
          Array.from({ length: limit }, (_, i) => ({ n: skip + i, name: `item ${skip + i}` })),
        );
      },
    });
    await settle();
  });

  it('shows the loaded first page without reading anything', () => {
    expect(
      el().querySelector('[data-testid="nested-pager"] [data-testid="pager-range"]')?.textContent,
    ).toContain('1–100 of 50,000');
    expect(names()[0]).toBe('item 0');
    expect(calls).toEqual([]);
  });

  it('reads other pages from the source and does not read them twice', async () => {
    pagerButton('pager-next')?.click();
    await settle();
    expect(calls).toEqual([{ skip: 100, limit: 100 }]);
    expect(names()[0]).toBe('item 100');
    pagerButton('pager-last')?.click();
    await settle();
    expect(names().at(-1)).toBe('item 49999');
    pagerButton('pager-first')?.click();
    await settle();
    pagerButton('pager-next')?.click();
    await settle();
    expect(calls).toEqual([
      { skip: 100, limit: 100 },
      { skip: 49_900, limit: 100 },
    ]);
  });

  it('can not be edited, and says why', async () => {
    TestBed.inject(EditModeService).toggle();
    await settle();
    // `_id` (outside the array) stays editable; nothing in the array is.
    expect(el().querySelector('input.val-input.str')).toBeNull();
    expect(el().querySelectorAll('input.val-input')).toHaveLength(1);
    expect(el().querySelector('button[title="Delete item"]')).toBeNull();
    expect(el().querySelector('[data-testid="slice-note"]')?.textContent).toContain(
      "can't be edited",
    );
  });

  it('shows a failed read with a retry', async () => {
    fail = true;
    pagerButton('pager-next')?.click();
    await settle();
    expect(el().querySelector('[data-testid="slice-error"]')?.textContent).toContain('server gone');
    fail = false;
    el().querySelector<HTMLButtonElement>('[data-testid="slice-error"] button')?.click();
    await settle();
    expect(el().querySelector('[data-testid="slice-error"]')).toBeNull();
    expect(names()[0]).toBe('item 100');
  });
});
