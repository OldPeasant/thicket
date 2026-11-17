import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { type BsonDocument, parseEJson } from '@thicket/core/bson';
import { parseShellSyntaxDocument, printShellSyntax } from '@thicket/core/shellsyntax';

import { WriteControl } from '../../safety/write-control.directive';
import { DocumentActions, type SaveConflict, visibleFields } from '../document-actions.service';
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
  /** Overwrite and Merge manually can't respect the projection the document was loaded with. */
  readonly blocked: boolean;
  /** Only the fields loaded with the query's projection are compared. */
  readonly partial: boolean;
  readonly rows: readonly DiffRow[];
  readonly differences: number;
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
        } @else if (item.blocked) {
          <p class="note" data-testid="conflict-note">
            Overwrite and Merge manually are not available: the document was loaded with a
            projection that hides parts of fields or is no longer active, so they could change data
            you did not load. To use them, clear the projection, run the query again and edit again.
          </p>
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

        @if (mergeKey() === item.key) {
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
          @if (mergeKey() === item.key) {
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
            @if (item.state === 'changed' && item.local !== null && !item.blocked) {
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
            @if (item.state !== 'unknown' && item.local !== null && !item.blocked) {
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

  protected countText(item: ConflictItem): string {
    if (item.state !== 'changed') return '';
    if (item.local === null) return 'No unsaved edits left';
    const n = item.differences;
    return n === 0 ? 'No differences' : `${n} differing ${n === 1 ? 'line' : 'lines'}`;
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
      blocked: this.actions.resolveBlocker(conflict.key) === 'projection',
      partial,
      rows,
      differences: rows.filter((r) => r.kind !== 'same').length,
    };
  }
}

function idText(key: string): string {
  try {
    return printShellSyntax(parseEJson(key));
  } catch {
    return key;
  }
}
