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
  TEXT_FORMATS,
  type TextFormat,
  describeExport,
  exportParams,
  formatNumber,
} from './io.util';

/** Where an export is. */
export type ExportPhase = 'idle' | 'running' | 'done' | 'cancelled' | 'error';

let nextUid = 0;

/**
 * Exports the query applied in a collection tab (filter, projection, sort, collation, limit) as
 * JSON or JSON Lines in relaxed or canonical EJSON. "Choose file and export" sends `io.export`:
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
  readonly closed = output();

  private readonly api = inject(ApiService);

  protected readonly formats = TEXT_FORMATS;
  protected readonly modes = EJSON_MODES;
  protected readonly uid = `export-${++nextUid}`;

  protected readonly format = signal<TextFormat>('json');
  protected readonly mode = signal<EjsonMode>('relaxed');
  protected readonly phase = signal<ExportPhase>('idle');
  protected readonly path = signal<string | null>(null);
  protected readonly progress = signal<IoProgress>(NO_PROGRESS);
  protected readonly error = signal<string | null>(null);

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
    this.format.set((event.target as HTMLInputElement).value as TextFormat);
  }

  protected setMode(event: Event): void {
    this.mode.set((event.target as HTMLInputElement).value as EjsonMode);
  }

  /** Sends `io.export`: the save dialog, then the progress stream. */
  protected start(): void {
    if (this.running()) return;
    const params = exportParams(this.target(), this.query(), this.format(), this.mode());
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
