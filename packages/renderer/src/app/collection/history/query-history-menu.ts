import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
  viewChildren,
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
  host: {
    '(keydown.escape)': 'closeAndFocus($event)',
    '(document:pointerdown)': 'closeOnOutside($event)',
  },
})
export class QueryHistoryMenu {
  /** What the query bar holds now (saved as a favorite). */
  readonly current = input.required<SavedQuery>();
  /** A favorite or recent query was picked. */
  readonly apply = output<SavedQuery>();

  protected readonly history = inject(QueryHistory);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
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
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');
  private readonly favoriteButtons = viewChildren<ElementRef<HTMLButtonElement>>('favoritePick');

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

  /** A press outside the button and its panel closes the panel (like any dropdown). */
  protected closeOnOutside(event: Event): void {
    if (!this.open()) return;
    const target = event.target;
    if (target instanceof Node && this.host.nativeElement.contains(target)) return;
    this.open.set(false);
  }

  protected pick(query: SavedQuery): void {
    this.open.set(false);
    // The picked button leaves the DOM: keep keyboard focus on the History button.
    this.toggleButton()?.nativeElement.focus();
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

  protected async remove(id: string, index: number): Promise<void> {
    await this.history.deleteFavorite(id);
    // Failed (the favorite and its focused button are still there) or the panel was closed.
    if (!this.open() || this.history.favorites().some((f) => f.id === id)) return;
    // The focused delete button left the DOM: focus the next favorite (or the one before it, if
    // the last was deleted), or the name field when no favorite is left.
    afterNextRender(
      () => {
        const buttons = this.favoriteButtons();
        const next = buttons[Math.min(index, buttons.length - 1)] ?? this.nameInput();
        next?.nativeElement.focus();
      },
      { injector: this.injector },
    );
  }

  protected clear(): void {
    void this.history.clear();
  }
}
