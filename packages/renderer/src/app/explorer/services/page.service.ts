import { Injectable, signal, type WritableSignal } from '@angular/core';
import { pageOf, pageWindow, type PageWindow } from '../page.util';

// Which page each large array/object shows, keyed by the node's instance id
// (`uid`, unique per array row, so two rows' `items` page independently).
// Only the page number is kept here: the values themselves stay in the
// document, so an edit made on one page is still there after paging away
// and back. Meant to live as long as the document view that provides it.
@Injectable({ providedIn: 'root' })
export class PageService {
  private readonly signals = new Map<string, WritableSignal<number>>();

  private page(key: string): WritableSignal<number> {
    let sig = this.signals.get(key);
    if (!sig) {
      sig = signal(0);
      this.signals.set(key, sig);
    }
    return sig;
  }

  /** The entries the node at `key` shows now (its page clamped to `length`). */
  window(key: string, length: number, size: number): PageWindow {
    return pageWindow(length, size, this.page(key)());
  }

  set(key: string, page: number): void {
    this.page(key).set(Math.max(0, Math.floor(page) || 0));
  }

  /** Shows the page holding the entry at `position` (a jump to a node, a new entry). */
  ensure(key: string, position: number, size: number): void {
    this.set(key, pageOf(position, size));
  }

  /** Every node back to its first page (views showing one read their page again). */
  clear(): void {
    for (const sig of this.signals.values()) sig.set(0);
    this.signals.clear();
  }
}
