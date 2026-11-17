import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import type { IoProgress } from '@thicket/contract';
import type { Subscription } from 'rxjs';

import { ApiService, describeError } from '../api';
import type { ParsedQuery } from '../collection/query.util';
import {
  EJSON_MODES,
  type EjsonMode,
  type IoTarget,
  NO_PROGRESS,
  FILE_FORMATS,
  type FileFormat,
  csvFieldsOf,
  describeExport,
  exportParams,
  formatNumber,
} from './io.util';

/** Where an export is. */
export type ExportPhase = 'idle' | 'running' | 'done' | 'cancelled' | 'error';

let nextUid = 0;

/** A CSV column of the export: a field path, written when checked. */
export interface CsvFieldChoice {
  path: string;
  checked: boolean;
}

/**
 * Exports the query applied in a collection tab (filter, projection, sort, collation, limit) as
 * JSON or JSON Lines in relaxed or canonical EJSON, as CSV (the fields of the documents shown,
 * nested documents flattened to `a.b` columns, each can be left out and more added) or as a
 * `mongodump`-compatible BSON dump. "Choose file and export" sends `io.export`:
 * the backend shows the save dialog, then streams progress; Cancel stops it (the backend removes
 * the partial file). A cancelled save dialog just returns to the form.
 */
@Component({
  selector: 'app-export-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './export-panel.html',
  styleUrl: './io-panel.css',
})
export class ExportPanel {
  readonly target = input.required<IoTarget>();
  /** The query applied in the tab (what the results show). */
  readonly query = input.required<ParsedQuery>();
  /** The documents shown in the tab (canonical EJSON): the CSV columns are taken from them. */
  readonly sampleDocs = input<readonly string[]>([]);
  readonly closed = output();

  private readonly api = inject(ApiService);

  protected readonly formats = FILE_FORMATS;
  protected readonly modes = EJSON_MODES;
  protected readonly uid = `export-${++nextUid}`;

  protected readonly format = signal<FileFormat>('json');
  protected readonly mode = signal<EjsonMode>('relaxed');
  protected readonly phase = signal<ExportPhase>('idle');
  protected readonly path = signal<string | null>(null);
  protected readonly progress = signal<IoProgress>(NO_PROGRESS);
  protected readonly error = signal<string | null>(null);
  /** CSV columns, in file order (filled from `sampleDocs` the first time CSV is chosen). */
  protected readonly csvFields = signal<readonly CsvFieldChoice[]>([]);
  protected readonly newField = signal('');
  protected readonly checkedFields = computed(() =>
    this.csvFields()
      .filter((f) => f.checked)
      .map((f) => f.path),
  );
  /** CSV with fields offered but none checked: nothing to export. */
  protected readonly noFields = computed(
    () =>
      this.format() === 'csv' && this.csvFields().length > 0 && this.checkedFields().length === 0,
  );

  /** The command sent by the last Choose file and export (what a running or finished one wrote). */
  private readonly sentCommand = signal<string | null>(null);
  /** The live query before an export; the sent one while it runs and after it ended. */
  protected readonly command = computed(() => {
    const phase = this.phase();
    const sent = this.sentCommand();
    return sent !== null && phase !== 'idle' && phase !== 'error'
      ? sent
      : describeExport(this.target().coll, this.query());
  });
  protected readonly processedText = computed(() => formatNumber(this.progress().processed));
  protected readonly running = computed(() => this.phase() === 'running');

  private subscription: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.subscription?.unsubscribe());
  }

  protected setFormat(event: Event): void {
    const format = (event.target as HTMLInputElement).value as FileFormat;
    this.format.set(format);
    if (format === 'csv' && this.csvFields().length === 0) {
      this.csvFields.set(csvFieldsOf(this.sampleDocs()).map((path) => ({ path, checked: true })));
    }
  }

  protected toggleField(path: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.csvFields.update((list) => list.map((f) => (f.path === path ? { ...f, checked } : f)));
  }

  protected setNewField(event: Event): void {
    this.newField.set((event.target as HTMLInputElement).value);
  }

  /** Adds the typed field path as a checked column (checks it again when already listed). */
  protected addField(event?: Event): void {
    event?.preventDefault();
    const path = this.newField().trim();
    if (path === '' || path.split('.').some((s) => s === '')) return;
    this.csvFields.update((list) =>
      list.some((f) => f.path === path)
        ? list.map((f) => (f.path === path ? { ...f, checked: true } : f))
        : [...list, { path, checked: true }],
    );
    this.newField.set('');
  }

  protected setMode(event: Event): void {
    this.mode.set((event.target as HTMLInputElement).value as EjsonMode);
  }

  /** Sends `io.export`: the save dialog, then the progress stream. */
  protected start(): void {
    if (this.running() || this.noFields()) return;
    const params = exportParams(
      this.target(),
      this.query(),
      this.format(),
      this.mode(),
      this.checkedFields(),
    );
    this.sentCommand.set(describeExport(this.target().coll, this.query()));
    this.phase.set('running');
    this.path.set(null);
    this.progress.set(NO_PROGRESS);
    this.error.set(null);
    let started = false;
    this.subscription = this.api
      .stream('io.export', params, {
        onStart: (result) => {
          started = result.streamId !== null;
          this.path.set(result.path);
        },
      })
      .subscribe({
        next: (progress) => this.progress.set(progress),
        error: (error: unknown) => {
          this.subscription = null;
          this.error.set(describeError(error));
          this.phase.set('error');
        },
        complete: () => {
          this.subscription = null;
          // No stream: the save dialog was cancelled, back to the form.
          this.phase.set(started ? 'done' : 'idle');
        },
      });
  }

  /** Stops a running export (the backend kills the cursor and removes the partial file). */
  protected cancel(): void {
    if (!this.subscription) return;
    this.subscription.unsubscribe();
    this.subscription = null;
    this.phase.set('cancelled');
  }

  protected close(): void {
    this.cancel();
    this.closed.emit();
  }
}
