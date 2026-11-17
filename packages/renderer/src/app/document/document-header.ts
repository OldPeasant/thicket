import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { BsonDocument } from '@thicket/core/bson';
import { printShellSyntax } from '@thicket/core/shellsyntax';

import { EditModeService } from '../explorer/services/edit-mode.service';
import { WriteControl } from '../safety/write-control.directive';
import { DocumentActions } from './document-actions.service';
import { plural } from './edit-bar';
import { DocumentEdits, documentKey, idOf } from './edit-session';

/**
 * The head of one document in the document list: its `_id`, the modified marker with the change
 * count, and Save / Revert / Undo last save / Clone / Delete for this document.
 */
@Component({
  selector: 'app-document-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WriteControl],
  template: `
    <div class="doc-head" data-testid="doc-header" [attr.data-modified]="modified() ? '' : null">
      <code class="id" [title]="idText()">{{ idText() }}</code>
      @if (modified()) {
        <span class="modified" data-testid="doc-changes">{{ changes() }}</span>
      }
      @if (conflict()) {
        <span class="message error" data-testid="doc-conflict">Changed on the server</span>
      }
      @if (error(); as error) {
        <span class="message error" data-testid="doc-error">{{ error }}</span>
      }
      <span class="group end">
        @if (modified()) {
          <button
            type="button"
            class="btn"
            data-testid="doc-revert"
            [disabled]="busy()"
            (click)="revert()"
          >
            Revert
          </button>
          <button
            type="button"
            class="btn primary"
            data-testid="doc-save"
            [appWriteControl]="profileId()"
            [disabledWhen]="busy() || error() !== null"
            (click)="save()"
          >
            Save
          </button>
        }
        @if (canUndoSave()) {
          <button
            type="button"
            class="btn quiet"
            data-testid="doc-undo-save"
            [title]="
              modified()
                ? 'Save or revert your edits first'
                : 'Write back the version from before the last save'
            "
            [appWriteControl]="profileId()"
            [disabledWhen]="busy() || modified()"
            (click)="undoSave()"
          >
            Undo last save
          </button>
        }
        <button
          type="button"
          class="btn quiet"
          data-testid="doc-clone"
          title="Insert a copy of this document with a new _id"
          [appWriteControl]="profileId()"
          [disabledWhen]="key() === null"
          (click)="clone()"
        >
          Clone
        </button>
        <button
          type="button"
          class="btn danger"
          data-testid="doc-delete"
          [appWriteControl]="profileId()"
          [disabledWhen]="key() === null || busy()"
          (click)="remove()"
        >
          Delete
        </button>
      </span>
    </div>
  `,
  styleUrl: './document-controls.css',
  styles: `
    .doc-head {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.375rem 0.75rem;
      padding: 0.25rem 0;
      margin-bottom: 0.25rem;
      border-bottom: 1px dashed var(--border);
    }
    .id {
      font-family: var(--font-mono);
      color: var(--text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 28rem;
    }
    .end {
      margin-left: auto;
    }
  `,
})
export class DocumentHeader {
  /** The document as loaded from the server. */
  readonly doc = input.required<BsonDocument>();
  /** The document as shown (with its unsaved edits). */
  readonly shown = input.required<BsonDocument>();
  readonly profileId = input.required<string>();

  private readonly edits = inject(DocumentEdits);
  private readonly actions = inject(DocumentActions);
  private readonly editMode = inject(EditModeService);

  protected readonly key = computed(() => documentKey(this.doc()));
  protected readonly idText = computed(() => {
    const id = idOf(this.doc());
    return id === null ? '(no _id)' : `_id: ${printShellSyntax(id)}`;
  });
  protected readonly modified = computed(() => {
    const key = this.key();
    return key !== null && this.edits.isModified(key);
  });
  private readonly pending = computed(() => {
    const key = this.key();
    return key === null ? undefined : this.edits.pending().get(key);
  });
  protected readonly changes = computed(() => plural(this.pending()?.changes ?? 0, 'change'));
  protected readonly error = computed(() => {
    const p = this.pending();
    return p !== undefined && !p.ok ? p.error : null;
  });
  protected readonly conflict = computed(() => {
    const key = this.key();
    return key !== null && this.actions.conflicts().has(key);
  });
  protected readonly canUndoSave = computed(() => {
    const key = this.key();
    return key !== null && this.actions.canUndoSave(key);
  });
  protected readonly busy = computed(() => {
    const key = this.key();
    return key !== null && this.actions.isBusy(key);
  });

  protected save(): void {
    const key = this.key();
    if (key !== null) void this.actions.save(key);
  }

  protected revert(): void {
    const key = this.key();
    if (key !== null) this.actions.revert(key);
  }

  protected undoSave(): void {
    const key = this.key();
    if (key !== null) void this.actions.undoSave(key);
  }

  protected clone(): void {
    this.actions.cloneDocument(this.shown());
    if (!this.editMode.enabled()) this.editMode.toggle();
  }

  protected remove(): void {
    void this.actions.delete(this.doc());
  }
}
