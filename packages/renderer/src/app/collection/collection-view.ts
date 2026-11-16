import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { type BsonDocument, parseEJsonDocument } from '@thicket/core/bson';
import { printShellSyntax } from '@thicket/core/shellsyntax';

import { toExplorerValue } from '../explorer/bson-value.util';
import { JsonExplorerComponent } from '../explorer/json-explorer.component';
import { JsonFormComponent } from '../explorer/json-form/json-form.component';
import { BsonDisplayService } from '../explorer/services/bson-display.service';
import { CollapseService } from '../explorer/services/collapse.service';
import { ColumnSyncService } from '../explorer/services/column-sync.service';
import { EditModeService } from '../explorer/services/edit-mode.service';
import { FilterService } from '../explorer/services/filter.service';
import { FocusService } from '../explorer/services/focus.service';
import { JsonLinesService } from '../explorer/services/json-lines.service';
import { JumpService } from '../explorer/services/jump.service';
import { LayoutService } from '../explorer/services/layout.service';
import { NodeVisibilityService } from '../explorer/services/node-visibility.service';
import { PanelService } from '../explorer/services/panel.service';
import { RevealService } from '../explorer/services/reveal.service';
import { SchemaService } from '../explorer/services/schema.service';
import { TableOrientationService } from '../explorer/services/table-orientation.service';
import type { WorkspaceTab } from '../layout/workspace.service';
import type { CollectionTabData } from '../sidebar/sidebar-tree.service';
import { CollectionResults, PAGE_SIZES } from './collection-results.service';
import {
  EMPTY_QUERY,
  parseQuery,
  type QueryErrors,
  type QueryField,
  type QueryText,
} from './query.util';

/** How the page of documents is shown. */
export type ResultView = 'table' | 'list' | 'raw';

/** Text format of the raw view. */
export type RawFormat = 'shell' | 'ejson';

const FIELD_LABELS: Record<QueryField, string> = {
  filter: 'Filter',
  projection: 'Projection',
  sort: 'Sort',
  collation: 'Collation',
  limit: 'Limit',
};

let nextUid = 0;

const numberFormat = new Intl.NumberFormat();

/**
 * A collection tab: the query bar (filter, projection, sort, collation, limit in shell syntax),
 * the pager and the result views (table, document list, raw). Editing documents is a later task:
 * the explorer is shown read-only here. Each tab has its own explorer state (search, collapse,
 * columns), so the explorer services are provided per view.
 */
@Component({
  selector: 'app-collection-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [JsonExplorerComponent, JsonFormComponent],
  providers: [
    CollectionResults,
    BsonDisplayService,
    CollapseService,
    ColumnSyncService,
    EditModeService,
    FilterService,
    FocusService,
    JsonLinesService,
    JumpService,
    LayoutService,
    NodeVisibilityService,
    PanelService,
    RevealService,
    SchemaService,
    TableOrientationService,
  ],
  templateUrl: './collection-view.html',
  styleUrl: './collection-view.css',
})
export class CollectionView {
  readonly tab = input.required<WorkspaceTab>();

  protected readonly results = inject(CollectionResults);
  protected readonly display = inject(BsonDisplayService);
  protected readonly pageSizes = PAGE_SIZES;
  protected readonly labels = FIELD_LABELS;

  /** What is typed in the query bar. */
  protected readonly text = signal<QueryText>({ ...EMPTY_QUERY });
  /** Errors of the last Run; a field's error goes away when it is edited. */
  protected readonly errors = signal<QueryErrors>({});
  protected readonly errorList = computed(() =>
    (Object.entries(this.errors()) as [QueryField, string][]).map(([field, message]) => ({
      field,
      message,
    })),
  );
  protected readonly view = signal<ResultView>('table');
  protected readonly rawFormat = signal<RawFormat>('shell');

  /** Reopening the tab gives a new tab object; only a changed namespace runs the query again. */
  protected readonly target = computed(
    () => {
      const data = this.tab().data as Partial<CollectionTabData> | undefined;
      return {
        profileId: data?.profileId ?? '',
        db: data?.db ?? '',
        coll: data?.coll ?? this.tab().title,
      };
    },
    {
      equal: (a, b) => a.profileId === b.profileId && a.db === b.db && a.coll === b.coll,
    },
  );

  /** The page's documents in the BSON model (`null` for one that could not be read). */
  protected readonly docs = computed<readonly (BsonDocument | null)[]>(() =>
    (this.results.page()?.docs ?? []).map((text) => {
      try {
        return parseEJsonDocument(text);
      } catch {
        return null;
      }
    }),
  );
  protected readonly explorerDocs = computed(() =>
    this.docs().map((doc) => (doc === null ? null : toExplorerValue(doc))),
  );
  protected readonly rawText = computed(() => {
    const page = this.results.page();
    if (page === null) return '';
    if (this.rawFormat() === 'ejson') return page.docs.join('\n');
    return this.docs()
      .map((doc) =>
        doc === null ? '// unreadable document' : printShellSyntax(doc, { indent: 2 }),
      )
      .join('\n');
  });

  /**
   * The page's position is unknown: it was counted from the end (last page) without any count.
   * The pager then names it relative to the end instead of guessing a number.
   */
  protected readonly positionUnknown = computed(
    () => this.results.pagesFromEnd() !== null && this.results.count() === null,
  );
  /** "1–50", the rows shown, or `null` before a page arrived. */
  protected readonly rowRange = computed(() => {
    const page = this.results.page();
    if (page === null) return null;
    if (page.docs.length === 0) return 'No documents';
    if (this.positionUnknown()) {
      const n = numberFormat.format(page.docs.length);
      const back = this.results.pagesFromEnd() ?? 0;
      if (back === 0) return `Last ${n}`;
      return `${n}, ${back} ${back === 1 ? 'page' : 'pages'} before the last`;
    }
    const from = page.firstRow + 1;
    return `${numberFormat.format(from)}–${numberFormat.format(page.firstRow + page.docs.length)}`;
  });
  /** "10 000" / "~10 000", or `null` without a count. */
  protected readonly countText = computed(() => {
    const count = this.results.count();
    if (count === null) return null;
    return `${count.exact ? '' : '~'}${numberFormat.format(count.value)}`;
  });
  protected readonly pagesText = computed(() => {
    const pages = this.results.pageCount();
    const count = this.results.count();
    if (pages === null || count === null) return null;
    return `${count.exact ? '' : '~'}${numberFormat.format(pages)}`;
  });
  /** The page number for the jump field ('' when unknown). */
  protected readonly pageNumber = computed(() =>
    this.positionUnknown() ? '' : String(this.results.paging().pageIndex + 1),
  );

  /** Prefix of element ids (tab ids may contain any character). */
  protected readonly uid = `coll-view-${++nextUid}`;

  private readonly jumpInput = viewChild<ElementRef<HTMLInputElement>>('jumpInput');

  constructor() {
    // Opening the tab shows page 1 of the whole collection.
    effect(() => {
      const target = this.target();
      untracked(() => {
        this.results.setTarget(target);
        this.run();
      });
    });
    // Documents are not edited here yet (doc-edit-save): the explorer shows them read-only.
    inject(EditModeService).setReadOnly(true);
  }

  protected edit(field: QueryField, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.text.update((t) => ({ ...t, [field]: value }));
    if (this.errors()[field] !== undefined) {
      this.errors.update(
        (e) =>
          Object.fromEntries(Object.entries(e).filter(([key]) => key !== field)) as QueryErrors,
      );
    }
  }

  /** Parses the query bar; runs it only when every field is valid. */
  protected run(event?: Event): void {
    event?.preventDefault();
    const parsed = parseQuery(this.text());
    if (!parsed.ok) {
      this.errors.set(parsed.errors);
      return;
    }
    this.errors.set({});
    this.results.run(parsed.query);
  }

  protected reset(): void {
    this.text.set({ ...EMPTY_QUERY });
    this.run();
  }

  /** Jumps to the page typed (Enter or leaving the field). */
  protected jump(): void {
    const input = this.jumpInput()?.nativeElement;
    if (input === undefined) return;
    const page = Number(input.value);
    if (Number.isInteger(page) && page >= 1) this.results.jump(page);
    else input.value = this.pageNumber();
  }

  protected changePageSize(event: Event): void {
    this.results.setPageSize(Number((event.target as HTMLSelectElement).value));
  }

  protected errorId(field: QueryField): string {
    return `${this.uid}-${field}-error`;
  }
}
