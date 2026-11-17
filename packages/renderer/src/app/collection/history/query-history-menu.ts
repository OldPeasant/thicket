import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MAX_FAVORITE_NAME_LENGTH, type SavedQuery } from '@thicket/contract';

import { QueryHistory } from './query-history.service';

/** The query as the mongosh chain it runs, on one line (`{…}.sort(…).limit(10)`). */
export function describeQuery(query: SavedQuery): string {
  const projection = query.projection.trim();
  let text = `find(${query.filter.trim() || '{}'}${projection ? `, ${projection}` : ''})`;
  if (query.sort.trim()) text += `.sort(${query.sort.trim()})`;
  if (query.collation.trim()) text += `.collation(${query.collation.trim()})`;
  if (query.limit.trim()) text += `.limit(${query.limit.trim()})`;
  return text;
}

const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' });

let nextUid = 0;

/**
 * The query bar's History button and its panel: save the query bar as a named favorite, re-run a
 * favorite or a recent query (emits `apply`; the collection view fills the bar and runs it),
 * delete favorites, clear the history. The data lives in the view's `QueryHistory`.
 */
@Component({
  selector: 'app-query-history-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './query-history-menu.html',
  styleUrl: './query-history-menu.css',
  host: { '(keydown.escape)': 'closeAndFocus($event)' },
})
export class QueryHistoryMenu {
  /** What the query bar holds now (saved as a favorite). */
  readonly current = input.required<SavedQuery>();
  /** A favorite or recent query was picked. */
  readonly apply = output<SavedQuery>();

  protected readonly history = inject(QueryHistory);
  protected readonly open = signal(false);
  protected readonly name = signal('');
  protected readonly saving = signal(false);
  protected readonly maxName = MAX_FAVORITE_NAME_LENGTH;
  protected readonly uid = `query-history-${++nextUid}`;
  protected readonly describe = describeQuery;
  protected readonly canSave = computed(() => this.name().trim() !== '' && !this.saving());
  /** Saving would replace the favorite of that name. */
  protected readonly replaces = computed(() => {
    const lower = this.name().trim().toLowerCase();
    return lower !== '' && this.history.favorites().some((f) => f.name.toLowerCase() === lower);
  });

  private readonly toggleButton = viewChild<ElementRef<HTMLButtonElement>>('toggleButton');

  protected time(at: string): string {
    const date = new Date(at);
    return Number.isNaN(date.getTime()) ? '' : timeFormat.format(date);
  }

  protected toggle(): void {
    this.open.update((open) => !open);
  }

  protected closeAndFocus(event: Event): void {
    if (!this.open()) return;
    event.stopPropagation();
    this.open.set(false);
    this.toggleButton()?.nativeElement.focus();
  }

  protected pick(query: SavedQuery): void {
    this.open.set(false);
    this.apply.emit({ ...query });
  }

  protected typeName(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    // The panel is inside the query bar's form: Enter here must not run the query.
    event.stopPropagation();
    if (!this.canSave()) return;
    this.saving.set(true);
    try {
      if (await this.history.saveFavorite(this.name().trim(), this.current())) this.name.set('');
    } finally {
      this.saving.set(false);
    }
  }

  protected remove(id: string): void {
    void this.history.deleteFavorite(id);
  }

  protected clear(): void {
    void this.history.clear();
  }
}
