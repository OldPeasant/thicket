import { describe, expect, it } from 'vitest';

import { RowSelectionService } from './row-selection.service';

describe('RowSelectionService', () => {
  it('starts disabled with nothing selected', () => {
    const s = new RowSelectionService();
    expect(s.enabled()).toBe(false);
    expect(s.selected()).toEqual([]);
    expect(s.count()).toBe(0);
    expect(s.isSelected(0)).toBe(false);
  });

  it('toggles rows on and off and lists them ascending', () => {
    const s = new RowSelectionService();
    s.toggle(5, true);
    s.toggle(0, true);
    s.toggle(2, true);
    expect(s.selected()).toEqual([0, 2, 5]);
    expect(s.count()).toBe(3);
    expect(s.isSelected(2)).toBe(true);
    s.toggle(2, false);
    expect(s.selected()).toEqual([0, 5]);
    expect(s.isSelected(2)).toBe(false);
  });

  it('sorts numerically, not as text', () => {
    const s = new RowSelectionService();
    for (const i of [10, 9, 100, 1]) s.toggle(i, true);
    expect(s.selected()).toEqual([1, 9, 10, 100]);
  });

  it('a toggle to the current state changes nothing (same selection object)', () => {
    const s = new RowSelectionService();
    s.toggle(1, true);
    const before = s.selected();
    s.toggle(1, true);
    s.toggle(3, false);
    expect(s.selected()).toBe(before);
  });

  it('setAll selects 0 … total-1, or none', () => {
    const s = new RowSelectionService();
    s.toggle(7, true);
    s.setAll(3, true);
    expect(s.selected()).toEqual([0, 1, 2]);
    s.setAll(3, false);
    expect(s.selected()).toEqual([]);
    s.setAll(0, true);
    expect(s.count()).toBe(0);
  });

  it('clear empties the selection and is a no-op when already empty', () => {
    const s = new RowSelectionService();
    const empty = s.selected();
    s.clear();
    expect(s.selected()).toBe(empty);
    s.toggle(4, true);
    s.clear();
    expect(s.selected()).toEqual([]);
    expect(s.count()).toBe(0);
  });

  it('the enabled switch does not change the selection by itself', () => {
    const s = new RowSelectionService();
    s.toggle(1, true);
    s.enabled.set(true);
    s.enabled.set(false);
    expect(s.selected()).toEqual([1]);
  });
});
