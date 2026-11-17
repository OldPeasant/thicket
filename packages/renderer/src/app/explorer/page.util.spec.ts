import { describe, expect, it } from 'vitest';

import { DEFAULT_NESTED_PAGE_SIZE, formPageKey, pageCount, pageOf, pageWindow } from './page.util';

describe('page.util', () => {
  it('defaults to 100 entries per page (SPEC nestedPageSize)', () => {
    expect(DEFAULT_NESTED_PAGE_SIZE).toBe(100);
  });

  describe('pageCount', () => {
    it('is at least 1, also for an empty container', () => {
      expect(pageCount(0, 100)).toBe(1);
      expect(pageCount(1, 100)).toBe(1);
    });

    it('counts pages around the page-size boundary', () => {
      expect(pageCount(99, 100)).toBe(1);
      expect(pageCount(100, 100)).toBe(1);
      expect(pageCount(101, 100)).toBe(2);
      expect(pageCount(2000, 100)).toBe(20);
      expect(pageCount(2001, 100)).toBe(21);
    });

    it('treats a size below 1 as 1 (never divides by zero)', () => {
      expect(pageCount(5, 0)).toBe(5);
      expect(pageCount(5, -3)).toBe(5);
    });
  });

  describe('pageWindow', () => {
    it('is unpaged at or below the page size and paged just above it', () => {
      expect(pageWindow(100, 100, 0)).toEqual({
        page: 0,
        pages: 1,
        start: 0,
        end: 100,
        length: 100,
        paged: false,
      });
      expect(pageWindow(101, 100, 0)).toMatchObject({ pages: 2, end: 100, paged: true });
    });

    it('gives the window of a middle page and a short last page', () => {
      expect(pageWindow(2000, 100, 6)).toMatchObject({ page: 6, start: 600, end: 700 });
      expect(pageWindow(2001, 100, 20)).toMatchObject({ page: 20, start: 2000, end: 2001 });
    });

    it('clamps a page past the end to the last page (a container that shrank)', () => {
      expect(pageWindow(250, 100, 9)).toMatchObject({ page: 2, start: 200, end: 250 });
      expect(pageWindow(50, 100, 3)).toMatchObject({ page: 0, start: 0, end: 50, paged: false });
    });

    it('clamps a negative, fractional or NaN page', () => {
      expect(pageWindow(500, 100, -2).page).toBe(0);
      expect(pageWindow(500, 100, 2.9).page).toBe(2);
      expect(pageWindow(500, 100, Number.NaN).page).toBe(0);
    });

    it('shows an empty container as one empty page', () => {
      expect(pageWindow(0, 100, 0)).toEqual({
        page: 0,
        pages: 1,
        start: 0,
        end: 0,
        length: 0,
        paged: false,
      });
    });

    it('floors a fractional size and uses at least 1 per page', () => {
      expect(pageWindow(10, 2.5, 1)).toMatchObject({ pages: 5, start: 2, end: 4 });
      expect(pageWindow(3, 0, 2)).toMatchObject({ pages: 3, start: 2, end: 3, paged: true });
    });
  });

  describe('pageOf', () => {
    it('is the page holding a position', () => {
      expect(pageOf(0, 100)).toBe(0);
      expect(pageOf(99, 100)).toBe(0);
      expect(pageOf(100, 100)).toBe(1);
      expect(pageOf(650, 100)).toBe(6);
      expect(pageOf(1999, 100)).toBe(19);
    });

    it('puts a negative position on the first page and guards a size below 1', () => {
      expect(pageOf(-5, 100)).toBe(0);
      expect(pageOf(7, 0)).toBe(7);
    });
  });

  it('keys the form page apart from the table page of the same node', () => {
    expect(formPageKey('items')).toBe('form:items');
    expect(formPageKey('items')).not.toBe('items');
  });
});
