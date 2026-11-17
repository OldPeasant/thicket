import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { JsonExplorerComponent } from '../json-explorer.component';
import { lineUid, parseJsonLines } from '../json-lines.util';
import { JsonLinesService, LINES_PAGE_KEY, LINES_PAGE_SIZE } from './json-lines.service';
import { JumpService } from './jump.service';
import { LayoutService } from './layout.service';
import { PageService } from './page.service';
import type { Layout } from '../layout.util';
import { formPageKey } from '../page.util';
import { appendKey } from '../../schema';

interface Item {
  n: number;
  name: string;
}
const items = (length: number, prefix = 'item'): Item[] =>
  Array.from({ length }, (_, i) => ({ n: i, name: `${prefix} ${i}` }));

@Component({
  standalone: true,
  imports: [JsonExplorerComponent],
  template: `<app-json-explorer
    [value]="doc()"
    [layout]="layout()"
    (valueChange)="doc.set($event)"
  />`,
})
class Host {
  readonly doc = signal<unknown>({ _id: 1, items: items(2000) });
  readonly layout = signal<Layout>('tables');
}

/** The JumpService takes the user to a node on a page other than the one shown. */
describe('JumpService and paging inside a document', () => {
  let fixture: ComponentFixture<Host>;
  const el = () => fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
  };
  const ranges = () =>
    [...el().querySelectorAll('[data-testid="nested-pager-range"]')].map((r) =>
      r.textContent?.trim(),
    );

  // jsdom has no scrollIntoView. The jump looks for the node's marker for up to
  // 20 × 50 ms after the call, so the stub stays until those retries are over.
  const scroll = vi.fn();
  const original = Element.prototype.scrollIntoView as Element['scrollIntoView'] | undefined;
  beforeAll(() => {
    Element.prototype.scrollIntoView = scroll;
  });
  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    if (original) Element.prototype.scrollIntoView = original;
    else delete (Element.prototype as Partial<Element>).scrollIntoView;
  });

  beforeEach(async () => {
    scroll.mockClear();
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [provideZonelessChangeDetection()],
    });
    fixture = TestBed.createComponent(Host);
    await settle();
  });

  it('pages a 2 000-item array to the page holding the target item', async () => {
    expect(ranges()).toEqual(['1–100 of 2,000 items']);
    TestBed.inject(JumpService).toPath(['items', 650, 'name'], fixture.componentInstance.doc());
    await settle();
    expect(ranges()).toEqual(['601–700 of 2,000 items']);
    expect(el().textContent).toContain('item 650');
  });

  it('pages back to an earlier page and to the last one', async () => {
    const jump = TestBed.inject(JumpService);
    jump.toPath(['items', 1999, 'n'], fixture.componentInstance.doc());
    await settle();
    expect(ranges()).toEqual(['1,901–2,000 of 2,000 items']);
    jump.toPath(['items', 5, 'n'], fixture.componentInstance.doc());
    await settle();
    expect(ranges()).toEqual(['1–100 of 2,000 items']);
  });

  it('pages only the array on the way to the node, not the same field of other rows', async () => {
    const doc = {
      _id: 1,
      rows: [0, 1, 2].map((r) => ({ r, tags: items(250, `row${r} tag`).map((t) => t.name) })),
    };
    fixture.componentInstance.doc.set(doc);
    await settle();
    expect(ranges()).toEqual(['1–100 of 250 items', '1–100 of 250 items', '1–100 of 250 items']);
    TestBed.inject(JumpService).toPath(['rows', 1, 'tags', 180], doc);
    await settle();
    expect(ranges()).toEqual(['1–100 of 250 items', '101–200 of 250 items', '1–100 of 250 items']);
    expect(el().textContent).toContain('row1 tag 180');
  });

  it('in a JSON Lines file, pages the list of lines and then the array inside the line', () => {
    const text = Array.from({ length: 120 }, (_, i) =>
      JSON.stringify({ n: i, tags: Array.from({ length: 150 }, (_, k) => `t${k}`) }),
    ).join('\n');
    const lines = parseJsonLines(text, true);
    if (!lines) throw new Error('test file is not JSON Lines');
    TestBed.inject(JsonLinesService).set(lines);
    const pages = TestBed.inject(PageService);
    TestBed.inject(JumpService).toPath([75, 'tags', 130], undefined);
    // Line 75 is on the second page of 50 lines; item 130 on the second page of 100 items.
    expect(pages.window(LINES_PAGE_KEY, 120, LINES_PAGE_SIZE).page).toBe(1);
    expect(pages.window(appendKey(lineUid(75), 'tags'), 150, 100).page).toBe(1);
    // Other lines' arrays keep their page.
    expect(pages.window(appendKey(lineUid(74), 'tags'), 150, 100).page).toBe(0);
    TestBed.inject(JsonLinesService).set(undefined);
  });

  it('in the form layout, pages an object by its form page', async () => {
    const big = Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`k${i}`, `v${i}`]));
    const doc = { _id: 1, big };
    fixture.componentInstance.doc.set(doc);
    // The view showing the explorer keeps both in step (LayoutService for the jump).
    TestBed.inject(LayoutService).choose('form');
    fixture.componentInstance.layout.set('form');
    await settle();
    expect(el().querySelector('app-json-form')).not.toBeNull();
    expect(ranges()).toEqual(['1–100 of 250 fields']);
    TestBed.inject(JumpService).toPath(['big', 'k230'], doc);
    await settle();
    const pages = TestBed.inject(PageService);
    // The form's key of `big` shows the third page; the table's key of the same node is untouched.
    const uid = appendKey('', 'big');
    expect(pages.window(formPageKey(uid), 250, 100).page).toBe(2);
    expect(pages.window(uid, 250, 100).page).toBe(0);
    expect(ranges()).toContain('201–250 of 250 fields');
    // The field, now on the page shown, is scrolled to.
    await vi.waitFor(() => expect(scroll).toHaveBeenCalled());
    const target = scroll.mock.contexts[0] as Element;
    expect(target.textContent).toContain('k230');
  });
});
