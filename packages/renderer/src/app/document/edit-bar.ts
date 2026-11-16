import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';

import { EditModeService } from '../explorer/services/edit-mode.service';
import { WriteControl } from '../safety/write-control.directive';
import { DocumentActions } from './document-actions.service';
import { DocumentEdits } from './edit-session';

/** "1 change", "3 changes". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${new Intl.NumberFormat().format(n)} ${n === 1 ? one : many}`;
}

/**
 * The diff bar of a collection tab: edit mode, Insert document, and while documents have unsaved
 * edits the modified marker with the change count, Undo / Redo, Revert and Save (every edited
 * document). Write controls are disabled on read-only profiles.
 */
@Component({
  selector: 'app-edit-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WriteControl],
  template: `
    <div class="edit-bar" role="toolbar" aria-label="Edit documents" data-testid="edit-bar">
      <div class="group">
        <button
          type="button"
          class="btn"
          data-testid="edit-mode"
          [appWriteControl]="profileId()"
          [attr.aria-pressed]="editMode.enabled()"
          title="Show the editing controls in the documents"
          (click)="toggleEdit()"
        >
          Edit
        </button>
        <button
          type="button"
          class="btn"
          data-testid="doc-insert"
          [appWriteControl]="profileId()"
          title="Add a new document (inserted when you press Insert)"
          (click)="insert()"
        >
          Insert document
        </button>
      </div>
      <div class="group status" aria-live="polite">
        @if (edits.modified()) {
          <span class="modified" data-testid="edit-count">{{ summary() }}</span>
        }
        @if (actions.message(); as message) {
          <p
            class="message"
            [class.error]="message.kind === 'error'"
            [attr.role]="message.kind === 'error' ? 'alert' : null"
            data-testid="edit-message"
          >
            {{ message.text }}
          </p>
        }
      </div>
      <div class="group end">
        <button
          type="button"
          class="btn quiet"
          data-testid="edit-undo"
          title="Undo (Ctrl+Z)"
          [disabled]="!edits.canUndo() || actions.busy()"
          (click)="edits.undo()"
        >
          Undo
        </button>
        <button
          type="button"
          class="btn quiet"
          data-testid="edit-redo"
          title="Redo (Ctrl+Shift+Z)"
          [disabled]="!edits.canRedo() || actions.busy()"
          (click)="edits.redo()"
        >
          Redo
        </button>
        <button
          type="button"
          class="btn"
          data-testid="edit-revert"
          title="Discard every unsaved edit"
          [disabled]="!edits.modified() || actions.busy()"
          (click)="actions.revertAll()"
        >
          Revert
        </button>
        <button
          type="button"
          class="btn primary"
          data-testid="edit-save"
          title="Save every edited document (Ctrl+S)"
          [appWriteControl]="profileId()"
          [disabledWhen]="!edits.modified() || actions.busy()"
          (click)="save()"
        >
          {{ actions.busy() ? 'Saving…' : 'Save' }}
        </button>
      </div>
    </div>
  `,
  styleUrl: './document-controls.css',
  styles: `
    .edit-bar {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.375rem 1rem;
      padding: 0.375rem 0.75rem;
      border-bottom: 1px solid var(--border);
      color: var(--text-muted);
    }
    .status {
      flex: 1 1 12rem;
      min-width: 0;
    }
    .status .message {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
})
export class EditBar {
  /** Profile the documents are written to (write controls follow its read-only flag). */
  readonly profileId = input.required<string>();
  /** Insert document was pressed (a draft was added). */
  readonly inserted = output<void>();

  protected readonly edits = inject(DocumentEdits);
  protected readonly actions = inject(DocumentActions);
  protected readonly editMode = inject(EditModeService);

  /** "2 changes" or "5 changes in 3 documents". */
  protected readonly summary = computed(() => {
    const changes = plural(this.edits.changeCount(), 'change');
    const docs = this.edits.documents().length;
    return docs > 1 ? `${changes} in ${plural(docs, 'document')}` : changes;
  });

  protected toggleEdit(): void {
    this.editMode.toggle();
  }

  protected insert(): void {
    this.actions.newDocument();
    if (!this.editMode.enabled()) this.editMode.toggle();
    this.inserted.emit();
  }

  protected save(): void {
    void this.actions.saveAll();
  }
}

/**
 * Undo / redo / save keys of a collection tab: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl+Y, Ctrl/Cmd+S.
 * Text fields keep their own undo, so keys typed into them are left alone. Returns true when the
 * key was handled (and its default prevented).
 */
export function handleEditKeys(
  event: KeyboardEvent,
  edits: DocumentEdits,
  actions: DocumentActions,
  canWrite: boolean,
): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return false;
  const target = event.target as HTMLElement | null;
  const key = event.key.toLowerCase();
  if (key === 's') {
    event.preventDefault();
    if (canWrite && edits.modified() && !actions.busy()) void actions.saveAll();
    return true;
  }
  if (target !== null && isTextField(target)) return false;
  if (actions.busy()) return false;
  if (key === 'z' && !event.shiftKey) {
    event.preventDefault();
    edits.undo();
    return true;
  }
  if ((key === 'z' && event.shiftKey) || (key === 'y' && !event.shiftKey)) {
    event.preventDefault();
    edits.redo();
    return true;
  }
  return false;
}

function isTextField(el: HTMLElement): boolean {
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}
