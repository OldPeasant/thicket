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

  /** Selects the indices `0 … total-1`, or none. */
  setAll(total: number, on: boolean): void {
    this.rows.set(on ? new Set(Array.from({ length: total }, (_, i) => i)) : new Set());
  }

  clear(): void {
    if (this.rows().size > 0) this.rows.set(new Set());
  }
}
