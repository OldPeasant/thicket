import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { type BsonValue } from '@thicket/core/bson';

import { ApiError } from '../../api';
import { NumberDefaultService } from '../../explorer/services/number-default.service';
import { formatCount } from '../../safety/write-guard.service';
import { MultiEdit, type SelectedDocument } from './multi-edit.service';
import { type FieldEdit, fieldPathError, parseFieldValue } from './multi-edit.util';

let nextUid = 0;

/** A plain number literal: it takes the integer default from the settings like any new number. */
const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/**
 * The bar above the table while rows are selected: one field to set (value in shell syntax) or
 * remove across the selected documents, saved together through `MultiEdit`. It stays while a batch
 * runs or its report is shown, also when no row is selected any more (deleted on the server).
 */
@Component({
  selector: 'app-multi-edit-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './multi-edit-panel.html',
  styleUrls: ['../../document/document-controls.css', './multi-edit-panel.css'],
})
export class MultiEditPanel {
  /** The selected documents, as loaded. */
  readonly selected = input.required<readonly SelectedDocument[]>();
  /** Clear the selection (and close the report). */
  readonly cleared = output();

  protected readonly multi = inject(MultiEdit);
  private readonly numbers = inject(NumberDefaultService);

  protected readonly uid = `multi-edit-${++nextUid}`;
  protected readonly action = signal<'set' | 'unset'>('set');
  protected readonly path = signal('');
  protected readonly valueText = signal('');
  protected readonly error = signal<string | null>(null);
  /** The last batch's report (kept by `MultiEdit`: it outlives rows that left the page). */
  protected readonly result = this.multi.result;

  protected readonly count = computed(() => this.selected().length);
  protected readonly countText = computed(() => {
    const n = this.count();
    if (n === 0) return 'No rows selected';
    return `${formatCount(n)} ${n === 1 ? 'row' : 'rows'} selected`;
  });
  protected readonly saveLabel = computed(() => {
    const n = this.count();
    return `Save ${formatCount(n)} ${n === 1 ? 'document' : 'documents'}`;
  });
  protected readonly summary = computed(() => {
    const r = this.result();
    if (r === null) return null;
    const parts: string[] = [];
    parts.push(`Saved ${formatCount(r.saved)} ${r.saved === 1 ? 'document' : 'documents'}.`);
    if (r.unchanged > 0) parts.push(`${formatCount(r.unchanged)} already had this value.`);
    const deleted = r.conflicts.filter((c) => c.deleted === true).length;
    const changed = r.conflicts.length - deleted;
    if (changed > 0) {
      parts.push(
        `${formatCount(changed)} not saved: changed on the server since they were loaded (reloaded, select and save again to apply).`,
      );
    }
    if (deleted > 0) {
      parts.push(
        `${formatCount(deleted)} not saved: deleted on the server since they were loaded (removed from the page).`,
      );
    }
    if (r.failed.length > 0) parts.push(`${formatCount(r.failed.length)} failed.`);
    return parts.join(' ');
  });

  protected setAction(event: Event): void {
    this.action.set((event.target as HTMLSelectElement).value === 'unset' ? 'unset' : 'set');
    this.error.set(null);
  }

  protected setPath(event: Event): void {
    this.path.set((event.target as HTMLInputElement).value);
    this.error.set(null);
  }

  protected setValue(event: Event): void {
    this.valueText.set((event.target as HTMLInputElement).value);
    this.error.set(null);
  }

  protected async save(): Promise<void> {
    if (this.multi.busy() || this.count() === 0) return;
    this.multi.clearResult();
    const path = this.path().trim();
    const pathError = fieldPathError(path);
    if (pathError !== null) {
      this.error.set(pathError);
      return;
    }
    let edit: FieldEdit;
    if (this.action() === 'unset') {
      edit = { action: 'unset', path };
    } else {
      let value: BsonValue;
      try {
        value = this.parseValue(this.valueText());
      } catch (e) {
        this.error.set(`Value: ${(e as Error).message}`);
        return;
      }
      edit = { action: 'set', path, value };
    }
    this.error.set(null);
    try {
      await this.multi.save(this.selected(), edit);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code !== 'CANCELLED') this.error.set(e.message);
      } else {
        this.error.set((e as Error).message);
      }
    }
  }

  private parseValue(text: string): BsonValue {
    const trimmed = text.trim();
    if (PLAIN_NUMBER.test(trimmed)) return this.numbers.newNumber(Number(trimmed));
    return parseFieldValue(text);
  }
}
