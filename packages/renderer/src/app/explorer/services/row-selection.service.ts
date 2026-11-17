import { Injectable, computed, signal } from '@angular/core';

/**
 * Selected rows of the explorer's root table (an array shown one row per item), by item index.
 * Optional: only a host that provides it (the collection tab, for editing a field across rows)
 * gets the checkbox column, and only while `enabled` is on.
 */
@Injectable()
export class RowSelectionService {
  /** Show the checkbox column. */
  readonly enabled = signal(false);
  private readonly rows = signal<ReadonlySet<number>>(new Set());
  /** Selected item indices, ascending. */
  readonly selected = computed(() => [...this.rows()].sort((a, b) => a - b));
  readonly count = computed(() => this.rows().size);

  isSelected(index: number): boolean {
    return this.rows().has(index);
  }

  toggle(index: number, on: boolean): void {
    this.rows.update((set) => {
      if (set.has(index) === on) return set;
      const next = new Set(set);
      if (on) next.add(index);
      else next.delete(index);
      return next;
    });
  }

  /**
   * The "select all" box of the rows shown (`indices`): on selects exactly them (rows hidden by the
   * search or on another page are dropped), off unselects them.
   */
  setAll(indices: readonly number[], on: boolean): void {
    if (on) {
      this.rows.set(new Set(indices));
      return;
    }
    this.rows.update((set) => {
      const next = new Set(set);
      for (const i of indices) next.delete(i);
      return next.size === set.size ? set : next;
    });
  }

  /** Row `index` left the list: it is unselected and the rows below it move up one. */
  removeRow(index: number): void {
    this.rows.update((set) => {
      if (set.size === 0) return set;
      const next = new Set<number>();
      for (const i of set) {
        if (i < index) next.add(i);
        else if (i > index) next.add(i - 1);
      }
      return next;
    });
  }

  clear(): void {
    if (this.rows().size > 0) this.rows.set(new Set());
  }
}
