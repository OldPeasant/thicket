import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { type BsonDocument, type BsonValue, parseEJson } from '@thicket/core/bson';
import { parseShellSyntaxDocument, printShellSyntax } from '@thicket/core/shellsyntax';

import { WriteControl } from '../../safety/write-control.directive';
import {
  DocumentActions,
  type ResolveBlocker,
  type SaveConflict,
  visibleFields,
} from '../document-actions.service';
import { DocumentEdits } from '../edit-session';
import { type DiffRow, diffLines } from './line-diff';

/** One conflict as shown: both versions aligned line by line. */
interface ConflictItem {
  readonly key: string;
  readonly idText: string;
  /** The local version (with the unsaved edits); `null` when no edits are left. */
  readonly local: BsonDocument | null;
  /** The server version: changed, deleted, or changed but not readable. */
  readonly state: 'changed' | 'deleted' | 'unknown';
  /**
   * Why Overwrite and Merge manually are not offered: the projection the document was loaded with
   * (`'projection'`), or it is a large document whose long arrays were cut (`'partial'`).
   */
  readonly blocked: 'projection' | 'partial' | null;
  /** Arrays of a large document that were loaded only partly: only their loaded items are compared. */
  readonly cut: readonly CutArray[];
  /** Only the fields loaded with the query's projection are compared. */
  readonly partial: boolean;
  readonly rows: readonly DiffRow[];
  readonly differences: number;
}

/** A cut array as compared: `loaded` items of the local version, `total` on the server now. */
interface CutArray {
  readonly path: string;
  readonly loaded: number;
  /** Length of the array in the server version (`null`: it has no array there). */
  readonly total: number | null;
}

const INDENT = 2;

function lines(doc: BsonDocument | null): string[] {
  return doc === null ? [] : printShellSyntax(doc, { indent: INDENT }).split('\n');
}

/**
 * The conflict view of a collection tab (SPEC.md M1 "Conflict detection"): for every save
 * refused because the document changed on the server, the local and the server version side by
 * side with the differing lines highlighted, and Overwrite / Keep server version / Merge manually.
 */
@Component({
  selector: 'app-conflict-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WriteControl],
  template: `
    @for (item of items(); track item.key) {
      <section
        class="conflict"
        data-testid="conflict-view"
        [attr.data-key]="item.key"
        [attr.aria-label]="'Conflict on ' + item.idText"
      >
        <header class="head">
          <h3 class="title" data-testid="conflict-title">
            @switch (item.state) {
              @case ('changed') {
                Changed on the server since you loaded it
              }
              @case ('deleted') {
                Deleted on the server since you loaded it
              }
              @default {
                Changed on the server; its current version could not be read
              }
            }
          </h3>
          <code class="id">{{ item.idText }}</code>
          <span class="count" data-testid="conflict-count">{{ countText(item) }}</span>
        </header>
        @if (item.state === 'unknown') {
          <p class="note" data-testid="conflict-note">
            Keep the server version to load it again, then edit again.
          </p>
        } @else if (item.blocked === 'projection') {
          <p class="note" data-testid="conflict-note">
            Overwrite and Merge manually are not available: the document was loaded with a
            projection that hides parts of fields or is no longer active, so they could change data
            you did not load. To use them, clear the projection, run the query again and edit again.
          </p>
        } @else if (item.blocked === 'partial') {
          <p class="note" data-testid="conflict-note">
            Overwrite and Merge manually are not available: the document was loaded only partly
            (with a projection, or a large document whose long arrays are read page by page), so
            they could change data that was not loaded. Keep the server version, then edit single
            values again.
          </p>
        }

        @if (item.state === 'changed' && item.cut.length > 0) {
          <ul class="note cut" data-testid="conflict-cut-note">
            @for (array of item.cut; track array.path) {
              <li>{{ cutText(array) }}</li>
            }
          </ul>
        } @else if (item.partial && item.local !== null) {
          <p class="note" data-testid="conflict-note">
            Only the fields loaded with the query's projection are compared; the others stay as they
            are on the server.
          </p>
        }

        @if (item.state !== 'unknown') {
          <div class="sides" role="table" [attr.aria-label]="'Your version and the server version'">
            <div class="side-head" role="row">
              <span role="columnheader">Your version</span>
              <span role="columnheader">Server version</span>
            </div>
            <div class="rows" role="rowgroup">
              @for (row of item.rows; track $index) {
                <div class="row" role="row" [attr.data-kind]="row.kind" data-testid="conflict-row">
                  <pre
                    class="cell local"
                    role="cell"
                    [class.gap]="row.left === null"
                    [class.diff]="row.kind !== 'same' && row.left !== null"
                    data-testid="conflict-local"
                  ><span class="mark" aria-hidden="true">{{ row.kind !== 'same' && row.left !== null ? '+' : ' ' }}</span>@if (localLabel(row); as srText) {<span class="sr-only">{{ srText }}</span>}{{ row.left ?? '' }}</pre>
                  <pre
                    class="cell server"
                    role="cell"
                    [class.gap]="row.right === null"
                    [class.diff]="row.kind !== 'same' && row.right !== null"
                    data-testid="conflict-server"
                  ><span class="mark" aria-hidden="true">{{ row.kind !== 'same' && row.right !== null ? '−' : ' ' }}</span>@if (serverLabel(row); as srText) {<span class="sr-only">{{ srText }}</span>}{{ row.right ?? '' }}</pre>
                </div>
              }
            </div>
          </div>
        }

        @if (merging(item)) {
          <div class="merge">
            <label class="merge-label" [for]="uid() + '-merge-' + $index">
              Merged document (shell syntax): it replaces the server version
            </label>
            <textarea
              class="merge-text"
              data-testid="conflict-merge-text"
              spellcheck="false"
              [id]="uid() + '-merge-' + $index"
              [rows]="mergeRows()"
              [value]="mergeText()"
              [attr.aria-invalid]="mergeError() ? true : null"
              (input)="mergeInput($event)"
            ></textarea>
            @if (mergeError(); as error) {
              <p class="message error" role="alert" data-testid="conflict-merge-error">
                {{ error }}
              </p>
            }
          </div>
        }

        <div class="actions">
          @if (merging(item)) {
            <button
              type="button"
              class="btn"
              data-testid="conflict-merge-cancel"
              (click)="closeMerge()"
            >
              Cancel merge
            </button>
            <button
              type="button"
              class="btn primary"
              data-testid="conflict-merge-save"
              [appWriteControl]="profileId()"
              [disabledWhen]="busy(item.key)"
              (click)="saveMerged(item.key)"
            >
              Save merged document
            </button>
          } @else {
            <button
              type="button"
              class="btn"
              data-testid="conflict-keep-server"
              [disabled]="busy(item.key)"
              (click)="keepServer(item.key)"
            >
              {{ item.state === 'deleted' ? 'Keep it deleted' : 'Keep server version' }}
            </button>
            @if (item.state === 'changed' && item.local !== null && item.blocked === null) {
              <button
                type="button"
                class="btn"
                data-testid="conflict-merge"
                [appWriteControl]="profileId()"
                [disabledWhen]="busy(item.key)"
                (click)="openMerge(item)"
              >
                Merge manually
              </button>
            }
            @if (item.state !== 'unknown' && item.local !== null && item.blocked === null) {
              <button
                type="button"
                class="btn danger"
                data-testid="conflict-overwrite"
                [appWriteControl]="profileId()"
                [disabledWhen]="busy(item.key)"
                [title]="
                  item.state === 'changed'
                    ? 'Replace the server version with yours'
                    : 'Insert your version again'
                "
                (click)="overwrite(item.key)"
              >
                {{
                  item.state === 'changed'
                    ? 'Overwrite with your version'
                    : 'Insert your version again'
                }}
              </button>
            }
          }
        </div>
      </section>
    }
  `,
  styleUrl: '../document-controls.css',
  styles: `
    .conflict {
      margin: 0.5rem 0.75rem;
      padding: 0.5rem 0.75rem 0.625rem;
      background: var(--bg-panel);
      border: 1px solid var(--danger-border);
      border-left-width: 4px;
      border-radius: 4px;
    }
    .head {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 0.25rem 0.75rem;
    }
    .title {
      margin: 0;
      font-size: 1em;
      font-weight: 600;
      color: var(--danger-text);
    }
    .id {
      font-family: var(--font-mono);
      color: var(--text-muted);
    }
    .count {
      margin-left: auto;
      color: var(--text-muted);
    }
    .note {
      margin: 0.25rem 0 0;
      color: var(--text-muted);
    }
    .note.cut {
      padding-left: 1.25rem;
    }
    .sides {
      margin-top: 0.5rem;
      border: 1px solid var(--border);
      border-radius: 4px;
      overflow: auto;
      max-height: 24rem;
      background: var(--bg-input);
    }
    .side-head,
    .row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
    .side-head {
      position: sticky;
      top: 0;
      z-index: 1;
      background: var(--bg-elevated);
      border-bottom: 1px solid var(--border);
      color: var(--text-muted);
    }
    .side-head span {
      padding: 0.2rem 0.5rem;
    }
    .side-head span + span,
    .cell.server {
      border-left: 1px solid var(--border);
    }
    .cell {
      margin: 0;
      padding: 0 0.5rem 0 0.25rem;
      font-family: var(--font-mono);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      min-height: 1.4em;
    }
    .mark {
      display: inline-block;
      width: 1.25em;
      color: var(--text-faint);
      user-select: none;
    }
    .cell.local.diff {
      background: var(--accent-bg);
    }
    .cell.local.diff .mark {
      color: var(--accent);
    }
    .cell.server.diff {
      background: var(--danger-bg);
    }
    .cell.server.diff .mark {
      color: var(--danger-text);
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .cell.gap {
      background: repeating-linear-gradient(135deg, transparent 0 4px, var(--bg-hover) 4px 5px);
    }
    .merge {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      margin-top: 0.5rem;
    }
    .merge-label {
      color: var(--text-muted);
    }
    .merge-text {
      font-family: var(--font-mono);
      font-size: inherit;
      color: var(--text);
      background: var(--bg-input);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 0.375rem 0.5rem;
      resize: vertical;
    }
    .merge-text[aria-invalid='true'] {
      border-color: var(--danger-border);
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: 0.375rem;
      margin-top: 0.5rem;
    }
  `,
})
export class ConflictView {
  /** Profile the documents are written to (write controls follow its read-only flag). */
  readonly profileId = input.required<string>();
  /** Prefix of element ids, unique per collection tab. */
  readonly uid = input('conflicts');

  private readonly actions = inject(DocumentActions);
  private readonly edits = inject(DocumentEdits);

  /** The conflict whose merge editor is open. */
  protected readonly mergeKey = signal<string | null>(null);
  protected readonly mergeText = signal('');
  protected readonly mergeError = signal<string | null>(null);
  protected readonly mergeRows = computed(() =>
    Math.min(24, Math.max(6, this.mergeText().split('\n').length + 1)),
  );

  protected readonly items = computed(() =>
    [...this.actions.conflicts().values()].map((c) => this.item(c)),
  );

  constructor() {
    // The merge editor belongs to one "changed" conflict: it closes when that conflict goes away
    // (revert, a save from the edit bar) or its server version is no longer a document (a merged
    // save found it deleted), so a later conflict on the same document starts afresh.
    effect(() => {
      const key = this.mergeKey();
      if (key === null) return;
      const conflict = this.actions.conflicts().get(key);
      if (conflict === undefined || !isChanged(conflict)) untracked(() => this.closeMerge());
    });
  }

  /** The merge editor is open for this conflict (only while its server version is a document). */
  protected merging(item: ConflictItem): boolean {
    return this.mergeKey() === item.key && item.state === 'changed';
  }

  protected countText(item: ConflictItem): string {
    if (item.state !== 'changed') return '';
    if (item.local === null) return 'No unsaved edits left';
    const n = item.differences;
    return n === 0 ? 'No differences' : `${n} differing ${n === 1 ? 'line' : 'lines'}`;
  }

  protected cutText(array: CutArray): string {
    const items = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'item' : 'items'}`;
    const head = `${array.path}: read page by page, so only the first ${items(array.loaded)} are compared`;
    return array.total === null ? `${head}.` : `${head} (the server has ${items(array.total)}).`;
  }

  /** What a screen reader says before a differing line of the local version (the `+` mark). */
  protected localLabel(row: DiffRow): string | null {
    if (row.kind === 'same' || row.left === null) return null;
    return row.right === null ? 'Only in your version: ' : 'Changed: ';
  }

  /** What a screen reader says before a differing line of the server version (the `−` mark). */
  protected serverLabel(row: DiffRow): string | null {
    if (row.kind === 'same' || row.right === null) return null;
    return row.left === null ? 'Only on the server: ' : 'Changed: ';
  }

  protected busy(key: string): boolean {
    return this.actions.isBusy(key);
  }

  protected overwrite(key: string): void {
    void this.actions.overwrite(key);
  }

  protected keepServer(key: string): void {
    if (this.mergeKey() === key) this.closeMerge();
    void this.actions.keepServer(key);
  }

  protected openMerge(item: ConflictItem): void {
    if (item.local === null) return;
    this.mergeKey.set(item.key);
    this.mergeText.set(printShellSyntax(item.local, { indent: INDENT }));
    this.mergeError.set(null);
  }

  protected closeMerge(): void {
    this.mergeKey.set(null);
    this.mergeText.set('');
    this.mergeError.set(null);
  }

  protected mergeInput(event: Event): void {
    this.mergeText.set((event.target as HTMLTextAreaElement).value);
    this.mergeError.set(null);
  }

  protected async saveMerged(key: string): Promise<void> {
    let merged: BsonDocument;
    try {
      merged = parseShellSyntaxDocument(this.mergeText());
    } catch (error) {
      this.mergeError.set(error instanceof Error ? error.message : String(error));
      return;
    }
    if (await this.actions.saveMerged(key, merged)) this.closeMerge();
  }

  private item(conflict: SaveConflict): ConflictItem {
    const entry = this.edits.get(conflict.key);
    const local = entry?.current ?? null;
    const partial = this.actions.isPartial(conflict.key);
    let server = conflict.current ?? null;
    // Without edits left there is nothing to compare: the server version is shown as it is.
    if (server !== null && partial && entry !== undefined) {
      server = visibleFields(server, [entry.original, entry.current]);
    }
    // A cut array of a large document: its never-loaded items are no difference, and the server's
    // whole array (maybe many thousands of items) is not shown.
    const cut: CutArray[] = [];
    if (server !== null && conflict.cut !== undefined) {
      for (const array of conflict.cut) {
        const loaded = arrayAt(local, array.path)?.length ?? array.loaded;
        const total = arrayAt(server, array.path)?.length ?? null;
        cut.push({ path: array.path, loaded, total });
        server = truncateArray(server, array.path.split('.'), loaded);
      }
    }
    const rows = conflict.current === undefined ? [] : diffLines(lines(local), lines(server));
    return {
      key: conflict.key,
      idText: `_id: ${idText(conflict.key)}`,
      local,
      state:
        conflict.current === undefined
          ? 'unknown'
          : conflict.current === null
            ? 'deleted'
            : 'changed',
      blocked: blockedBy(this.actions.resolveBlocker(conflict.key)),
      cut,
      partial,
      rows,
      differences: rows.filter((r) => r.kind !== 'same').length,
    };
  }
}

function blockedBy(blocker: ResolveBlocker | null): ConflictItem['blocked'] {
  return blocker === 'projection' || blocker === 'partial' ? blocker : null;
}

/** The items of the array at the dotted `path` of `doc` (document keys only), if there is one. */
function arrayAt(doc: BsonDocument | null, path: string): readonly BsonValue[] | undefined {
  let value: BsonValue | undefined = doc ?? undefined;
  for (const key of path.split('.')) {
    if (value?.type !== 'object') return undefined;
    value = value.fields.find((f) => f.key === key)?.value;
  }
  return value?.type === 'array' ? value.items : undefined;
}

/** `value` with the array at `path` cut to its first `length` items (unchanged without one). */
function truncateArray<T extends BsonValue>(value: T, path: readonly string[], length: number): T {
  const [key, ...rest] = path;
  if (key === undefined) {
    return value.type === 'array' && value.items.length > length
      ? { ...value, items: value.items.slice(0, length) }
      : value;
  }
  if (value.type !== 'object') return value;
  return {
    ...value,
    fields: value.fields.map((f) =>
      f.key === key ? { ...f, value: truncateArray(f.value, rest, length) } : f,
    ),
  };
}

function isChanged(conflict: SaveConflict): boolean {
  return conflict.current !== undefined && conflict.current !== null;
}

function idText(key: string): string {
  try {
    return printShellSyntax(parseEJson(key));
  } catch {
    return key;
  }
}
