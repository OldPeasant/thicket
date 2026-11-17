import { Component, EventEmitter, Input, Output } from '@angular/core';
import type { PageWindow } from '../page.util';

const numberFormat = new Intl.NumberFormat('en-US');

/**
 * First / previous / page field / next / last for a large array or object
 * inside a document, with the range shown ("101–200 of 2,000"). Emits the
 * 0-based page to show; the parent keeps the page (PageService).
 */
@Component({
  selector: 'app-pager',
  standalone: true,
  templateUrl: './pager.component.html',
  styleUrl: './pager.component.css',
})
export class PagerComponent {
  @Input({ required: true }) window!: PageWindow;
  /** What the entries are called in labels ("items", "fields", "lines"). */
  @Input() noun = 'items';
  @Output() pageChange = new EventEmitter<number>();

  get rangeText(): string {
    const w = this.window;
    return `${numberFormat.format(w.start + 1)}–${numberFormat.format(w.end)} of ${numberFormat.format(w.length)}`;
  }

  get pagesText(): string {
    return numberFormat.format(this.window.pages);
  }

  go(page: number): void {
    const target = Math.min(Math.max(0, page), this.window.pages - 1);
    if (target !== this.window.page) this.pageChange.emit(target);
  }

  /** The page field: a valid number goes there, anything else shows the current page again. */
  jump(input: HTMLInputElement): void {
    const n = Number(input.value.trim());
    if (input.value.trim() !== '' && Number.isInteger(n)) this.go(n - 1);
    input.value = String(this.window.page + 1);
  }
}
