import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { BsonDocument } from '@thicket/core/bson';

import { fromExplorerValue, toExplorerValue } from '../explorer/bson-value.util';
import { JsonFormComponent } from '../explorer/json-form/json-form.component';
import { NumberDefaultService } from '../explorer/services/number-default.service';
import { WriteControl } from '../safety/write-control.directive';
import { DocumentActions } from './document-actions.service';

/**
 * New documents that are not inserted yet (Insert document, Clone), each as a form with Insert
 * and Discard. Shown above the results in every view.
 */
@Component({
  selector: 'app-draft-documents',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [JsonFormComponent, WriteControl],
  template: `
    @if (items().length) {
      <ol class="drafts" aria-label="New documents" data-testid="drafts">
        @for (item of items(); track item.draft.id) {
          <li class="draft" data-testid="draft">
            <div class="draft-head">
              <span class="modified">{{ item.draft.title }}</span>
              <span class="hint">not inserted yet</span>
              <span class="group end">
                <button
                  type="button"
                  class="btn"
                  data-testid="draft-discard"
                  (click)="actions.discardDraft(item.draft.id)"
                >
                  Discard
                </button>
                <button
                  type="button"
                  class="btn primary"
                  data-testid="draft-insert"
                  [appWriteControl]="profileId()"
                  [disabledWhen]="actions.isBusy('draft:' + item.draft.id)"
                  (click)="insert(item.draft.id)"
                >
                  Insert
                </button>
              </span>
            </div>
            <app-json-form
              [value]="item.value"
              path=""
              [uid]="uid() + '-draft-' + item.draft.id"
              (valueChange)="edited(item.draft.id, $event)"
            />
          </li>
        }
      </ol>
    }
  `,
  styleUrl: './document-controls.css',
  styles: `
    .drafts {
      list-style: none;
      margin: 0;
      padding: 0.5rem 0.75rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      border-bottom: 1px solid var(--border);
    }
    .draft {
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--accent);
      border-radius: 4px;
      background: var(--bg-panel);
    }
    .draft-head {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 0.375rem;
    }
    .hint {
      color: var(--text-faint);
    }
    .end {
      margin-left: auto;
    }
  `,
})
export class DraftDocuments {
  readonly profileId = input.required<string>();
  /** Prefix of element ids inside the forms. */
  readonly uid = input('drafts');

  protected readonly actions = inject(DocumentActions);
  private readonly numbers = inject(NumberDefaultService);

  protected readonly items = computed(() =>
    this.actions.drafts().map((draft) => ({ draft, value: toExplorerValue(draft.doc) })),
  );

  protected edited(id: number, value: unknown): void {
    const doc = fromExplorerValue(value, this.numbers.integers());
    if (doc.type === 'object') this.actions.editDraft(id, doc as BsonDocument);
  }

  protected insert(id: number): void {
    void this.actions.insertDraft(id);
  }
}
