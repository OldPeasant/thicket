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
import { type BsonDocument, parseEJsonDocument, stringifyEJson } from '@thicket/core/bson';
import { printShellSyntax } from '@thicket/core/shellsyntax';

import {
  ConflictView,
  DocumentActions,
  DocumentEdits,
  DocumentHeader,
  documentKey,
  DraftDocuments,
  EditBar,
  handleEditKeys,
  isTopLevelProjection,
} from '../document';
import { fromExplorerValue, toExplorerValue } from '../explorer/bson-value.util';
import { ExportPanel } from '../io/export-panel';
import { ImportPanel } from '../io/import-panel';
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
import { NumberDefaultService } from '../explorer/services/number-default.service';
import { PanelService } from '../explorer/services/panel.service';
import { RevealService } from '../explorer/services/reveal.service';
import { SchemaService } from '../explorer/services/schema.service';
import { TableOrientationService } from '../explorer/services/table-orientation.service';
import { WorkspaceService, type WorkspaceTab } from '../layout/workspace.service';
import { aggregationTabId } from '../aggregation/aggregation-view';
import { RawEditor } from '../raw-editor/raw-editor';
import { ProfileSafetyService } from '../safety/profile-safety.service';
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
 * the pager, the edit bar and the result views (table, document list, raw). Edits in the table
 * and the document list stay in the tab's `DocumentEdits` until saved (`DocumentActions`). Each
 * tab has its own explorer state (search, collapse, columns), so the explorer services are
 * provided per view.
 */
@Component({
  selector: 'app-collection-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    JsonExplorerComponent,
    JsonFormComponent,
    EditBar,
    ConflictView,
    DocumentHeader,
    DraftDocuments,
    RawEditor,
    ExportPanel,
    ImportPanel,
  ],
  providers: [
    CollectionResults,
    DocumentEdits,
    DocumentActions,
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
  protected readonly edits = inject(DocumentEdits);
  protected readonly actions = inject(DocumentActions);
  private readonly editMode = inject(EditModeService);
  private readonly numbers = inject(NumberDefaultService);
  private readonly safety = inject(ProfileSafetyService);
  private readonly workspace = inject(WorkspaceService);
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
  /** The open import or export panel. */
  protected readonly ioPanel = signal<'export' | 'import' | null>(null);

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
  /** The page's documents as shown: with their unsaved edits. */
  protected readonly shownDocs = computed<readonly (BsonDocument | null)[]>(() =>
    this.docs().map((doc) => (doc === null ? null : this.edits.current(doc))),
  );
  /**
   * Explorer trees of the shown documents. A document that did not change keeps its tree, so an
   * edit in the table can be told apart from the rows it left alone (by identity).
   */
  private readonly trees = new WeakMap<BsonDocument, unknown>();
  protected readonly explorerDocs = computed(() =>
    this.shownDocs().map((doc) => (doc === null ? null : this.treeOf(doc))),
  );
  protected readonly rawText = computed(() => {
    const page = this.results.page();
    if (page === null) return '';
    if (this.rawFormat() === 'ejson') {
      return this.shownDocs()
        .map((doc, i) => (doc === null ? (page.docs[i] ?? '') : stringifyEJson(doc)))
        .join('\n');
    }
    return this.shownDocs()
      .map((doc) =>
        doc === null ? '// unreadable document' : printShellSyntax(doc, { indent: 2 }),
      )
      .join('\n');
  });

  /**
   * The page's position is unknown: it was counted from the end (last page) without an exact
   * count (none, or only an estimate). The pager then names it relative to the end instead of
   * guessing a number. Once counted exactly, the service reads the page again by number.
   */
  protected readonly positionUnknown = computed(() => this.results.pagesFromEnd() !== null);
  /** The shown page is empty, but it is not page 1: the result ended before it. */
  protected readonly emptyPastStart = computed(
    () => this.results.paging().pageIndex > 0 || this.positionUnknown(),
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
  /** Documents of the document list shown in the raw editor instead of the form (by `_id` key). */
  private readonly rawDocs = signal<ReadonlySet<string>>(new Set());
  /** The page was read with a projection: its documents may be partial (see `docChanged`). */
  protected readonly partialDocs = computed(() => this.results.query().projection !== undefined);
  /** That projection may hide parts of fields (see `DocumentEdits.edit`). */
  protected readonly subFieldDocs = computed(() => {
    const projection = this.results.query().projection;
    return projection !== undefined && !isTopLevelProjection(projection);
  });
  protected readonly readOnly = computed(() => this.safety.readOnly(this.target().profileId)());

  protected key(doc: BsonDocument): string | null {
    return documentKey(doc);
  }

  protected isRaw(doc: BsonDocument): boolean {
    const key = documentKey(doc);
    return key !== null && this.rawDocs().has(key);
  }

  /** Switches one document of the document list between the form and the raw editor. */
  protected toggleRaw(doc: BsonDocument): void {
    const key = documentKey(doc);
    if (key === null) return;
    this.rawDocs.update((keys) => {
      const next = new Set(keys);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  private readonly jumpInput = viewChild<ElementRef<HTMLInputElement>>('jumpInput');
  private readonly sizeSelect = viewChild<ElementRef<HTMLSelectElement>>('sizeSelect');
  private readonly runButton = viewChild<ElementRef<HTMLButtonElement>>('runButton');

  constructor() {
    // Whenever a read ends (a page arrived, or it was cancelled or failed), the page field and the
    // page-size select show the page and size actually shown, also when their value didn't change
    // (the bindings only write changed values, so a typed number would otherwise stay).
    effect(() => {
      const loading = this.results.loading();
      this.results.page();
      const pageNumber = this.pageNumber();
      const pageSize = this.results.paging().pageSize;
      const jumpInput = this.jumpInput()?.nativeElement;
      const sizeSelect = this.sizeSelect()?.nativeElement;
      if (loading) return;
      if (jumpInput !== undefined) jumpInput.value = pageNumber;
      if (sizeSelect !== undefined) sizeSelect.value = String(pageSize);
    });
    // Opening the tab shows page 1 of the whole collection.
    effect(() => {
      const target = this.target();
      untracked(() => {
        this.results.setTarget(target);
        this.actions.setHost({
          ...target,
          projection: () => this.results.query().projection,
          documentChanged: (key, doc) => this.documentChanged(key, doc),
        });
        this.run();
      });
    });
    // Read-only profiles show the documents without editing controls.
    effect(() => {
      const readOnly = this.safety.readOnly(this.target().profileId)();
      untracked(() => this.editMode.setReadOnly(readOnly));
    });
    // The table view shows one row per document: the root table (path '') starts horizontal
    // (the explorer's default is one row per field). The user can still flip it.
    const orientation = inject(TableOrientationService);
    if (orientation.read('') === 'v') orientation.toggle('');
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
    // Nothing read (an invalid number, or a page beyond the limit): show the current page again.
    if (!(Number.isInteger(page) && page >= 1 && this.results.jump(page))) {
      input.value = this.pageNumber();
    }
  }

  /** Cancel removes its own button: keyboard focus moves on to Run instead of the page body. */
  protected cancel(): void {
    this.results.cancel();
    this.runButton()?.nativeElement.focus();
  }

  protected changePageSize(event: Event): void {
    this.results.setPageSize(Number((event.target as HTMLSelectElement).value));
  }

  /** The root table changed: an edited row is an edit of its document. */
  protected tableChanged(value: unknown): void {
    if (!Array.isArray(value)) return;
    const shown = this.explorerDocs();
    const docs = this.docs();
    if (value.length === shown.length) {
      value.forEach((tree, i) => {
        if (tree !== shown[i]) this.docChanged(i, tree);
      });
      return;
    }
    if (value.length === shown.length + 1) {
      // A row added in the table is a new document: it becomes a draft to fill in and insert.
      const added = value.find((tree, i) => tree !== shown[i]);
      const doc = this.toDocument(added);
      if (doc !== null) this.actions.cloneDocument(doc);
      return;
    }
    if (value.length === shown.length - 1) {
      // A row removed in the table deletes its document (after the confirm dialog).
      const index = shown.findIndex((tree, i) => tree !== value[i]);
      const doc = docs[index === -1 ? shown.length - 1 : index];
      if (doc) void this.actions.delete(doc);
    }
  }

  /** The document at `index` of the page was edited in the explorer. */
  protected docChanged(index: number, tree: unknown): void {
    const original = this.docs()[index];
    const edited = this.toDocument(tree);
    // With a projection the loaded document may be partial: Save then refuses edits that would
    // replace what the projection hides, also after the projection was cleared.
    const partial = this.partialDocs();
    if (original && edited !== null) {
      this.edits.edit(original, edited, partial, this.subFieldDocs());
    }
  }

  protected keydown(event: KeyboardEvent): void {
    const canWrite = !this.safety.readOnly(this.target().profileId)();
    handleEditKeys(event, this.edits, this.actions, canWrite);
  }

  private toDocument(tree: unknown): BsonDocument | null {
    if (tree === null || typeof tree !== 'object' || Array.isArray(tree)) return null;
    const value = fromExplorerValue(tree, this.numbers.integers());
    return value.type === 'object' ? value : null;
  }

  private treeOf(doc: BsonDocument): unknown {
    let tree = this.trees.get(doc);
    if (tree === undefined) {
      tree = toExplorerValue(doc);
      this.trees.set(doc, tree);
    }
    return tree;
  }

  /** A document of this tab was saved or deleted: the shown page follows. */
  private documentChanged(key: string, doc: string | null): void {
    const index = this.docs().findIndex((d) => d !== null && documentKey(d) === key);
    if (index !== -1) this.results.patchDocument(index, doc);
  }

  /** Opens the aggregation builder of this collection in its own tab. */
  protected openAggregation(): void {
    const tab = this.tab();
    const { profileId, db, coll } = this.target();
    this.workspace.open({
      id: aggregationTabId(profileId, db, coll),
      kind: 'aggregation',
      title: `${coll} aggregation`,
      detail: tab.detail,
      production: tab.production,
      data: { ...tab.data },
    });
  }

  protected toggleIo(panel: 'export' | 'import'): void {
    this.ioPanel.update((open) => (open === panel ? null : panel));
  }

  /** An import into this tab's collection shows its documents. */
  protected imported(coll: string): void {
    if (coll === this.target().coll) this.results.run(this.results.query());
  }

  protected errorId(field: QueryField): string {
    return `${this.uid}-${field}-error`;
  }
}
