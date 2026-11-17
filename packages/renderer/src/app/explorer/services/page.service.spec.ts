import { TestBed } from '@angular/core/testing';
import { computed } from '@angular/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { PageService } from './page.service';

describe('PageService', () => {
  let pages: PageService;

  beforeEach(() => {
    pages = TestBed.inject(PageService);
  });

  it('shows the first page of a node it has not seen', () => {
    expect(pages.window('items', 2000, 100)).toMatchObject({ page: 0, start: 0, end: 100 });
  });

  it('keeps one page per key: rows of a table page independently', () => {
    pages.set('rows.0.items', 3);
    expect(pages.window('rows.0.items', 2000, 100).page).toBe(3);
    expect(pages.window('rows.1.items', 2000, 100).page).toBe(0);
  });

  it('stores a negative, fractional or NaN page as a valid page number', () => {
    pages.set('a', -4);
    expect(pages.window('a', 500, 100).page).toBe(0);
    pages.set('a', 2.7);
    expect(pages.window('a', 500, 100).page).toBe(2);
    pages.set('a', Number.NaN);
    expect(pages.window('a', 500, 100).page).toBe(0);
  });

  it('clamps the shown page to the length now, but remembers the chosen one', () => {
    pages.set('a', 9);
    // A search left 250 entries: the last page of those.
    expect(pages.window('a', 250, 100).page).toBe(2);
    // The search is cleared: back to the page chosen.
    expect(pages.window('a', 2000, 100).page).toBe(9);
  });

  it('ensure shows the page holding a position (a jump, a new entry)', () => {
    pages.ensure('a', 650, 100);
    expect(pages.window('a', 2000, 100)).toMatchObject({ page: 6, start: 600, end: 700 });
    pages.ensure('a', 1999, 100);
    expect(pages.window('a', 2000, 100).page).toBe(19);
  });

  it('is reactive: a computed window follows set', () => {
    const shown = computed(() => pages.window('a', 2000, 100).start);
    expect(shown()).toBe(0);
    pages.set('a', 4);
    expect(shown()).toBe(400);
  });

  it('clear forgets every page', () => {
    pages.set('a', 4);
    pages.set('b', 2);
    pages.clear();
    expect(pages.window('a', 2000, 100).page).toBe(0);
    expect(pages.window('b', 2000, 100).page).toBe(0);
  });
});
