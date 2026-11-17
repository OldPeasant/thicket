import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import type { CsvType, IoProgress, ResultOf } from '@thicket/contract';
import type { Subscription } from 'rxjs';

import { ApiError, ApiService, describeError } from '../api';
import { ProfileSafetyService } from '../safety/profile-safety.service';
import { WriteGuard } from '../safety/write-guard.service';
import { SidebarTreeService, collNameProblem } from '../sidebar/sidebar-tree.service';
import {
  type IoTarget,
  NO_PROGRESS,
  CSV_TYPE_OPTIONS,
  type CsvColumnRow,
  FILE_FORMATS,
  type FileFormat,
  collRef,
  csvMapping,
  csvMappingProblem,
  defaultCsvRows,
  formatBytes,
  formatNumber,
  printSample,
} from './io.util';

/** Where an import is. */
export type ImportPhase =
  'idle' | 'choosing' | 'previewed' | 'importing' | 'done' | 'cancelled' | 'error';

/** The chosen file (`io.previewImport` answer). */
export type ImportPreview = NonNullable<ResultOf<'io.previewImport'>>;

/** Documents `io.previewImport` reads for the preview. */
export const PREVIEW_SAMPLE_SIZE = 20;
/** Sample documents shown in the preview. */
export const PREVIEW_SHOWN = 5;

let nextUid = 0;

/**
 * Imports a JSON, JSON Lines, CSV or BSON dump file into a collection of the tab's database:
 * choose the file (`io.previewImport`, the backend's open dialog) and see its first documents
 * (CSV: map each column to a field path and a BSON type, or leave it out), pick the target
 * collection (a new name creates it), ordered or unordered, stop or continue on errors, then
 * Import (`io.import` through `WriteGuard`: production asks first) with progress and the first
 * failures. Never offered for read-only profiles: the collection view hides it, and the panel
 * itself refuses (and closes) when the profile is or becomes read-only.
 */
@Component({
  selector: 'app-import-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './import-panel.html',
  styleUrl: './io-panel.css',
})
export class ImportPanel {
  readonly target = input.required<IoTarget>();
  readonly closed = output();
  /**
   * An import into `coll` (of the target's database) ended: done, failed or cancelled. Documents
   * inserted before a failure or Cancel stay, so `inserted` may be above 0 in every case.
   */
  readonly imported = output<{ coll: string; inserted: number }>();

  private readonly api = inject(ApiService);
  private readonly guard = inject(WriteGuard);
  private readonly safety = inject(ProfileSafetyService);
  private readonly sidebar = inject(SidebarTreeService);

  protected readonly formats = FILE_FORMATS;
  protected readonly csvTypes = CSV_TYPE_OPTIONS;
  protected readonly uid = `import-${++nextUid}`;

  protected readonly format = signal<FileFormat>('json');
  protected readonly collName = signal('');
  protected readonly ordered = signal(true);
  protected readonly stopOnError = signal(true);
  protected readonly phase = signal<ImportPhase>('idle');
  protected readonly preview = signal<ImportPreview | null>(null);
  protected readonly progress = signal<IoProgress>(NO_PROGRESS);
  protected readonly error = signal<string | null>(null);
  /** CSV: the mapping of every column of the chosen file. */
  protected readonly csvRows = signal<readonly CsvColumnRow[]>([]);
  protected readonly mappingProblem = computed(() =>
    this.preview()?.csvColumns !== undefined ? csvMappingProblem(this.csvRows()) : null,
  );
  /** Whether the target name was edited since the last Import attempt (hides its error). */
  protected readonly nameTouched = signal(false);

  protected readonly readOnly = computed(() => this.safety.readOnly(this.target().profileId)());
  protected readonly busy = computed(() => {
    const phase = this.phase();
    return phase === 'choosing' || phase === 'importing';
  });
  protected readonly nameProblem = computed(() => collNameProblem(this.collName().trim()));
  /** The target collection in the header's shell call (`db.…` while the name is empty). */
  protected readonly collText = computed(() => {
    const name = this.collName().trim();
    return name === '' ? 'db.…' : collRef(name);
  });
  protected readonly sample = computed(() =>
    (this.preview()?.sample ?? []).slice(0, PREVIEW_SHOWN).map(printSample),
  );
  protected readonly sizeText = computed(() => formatBytes(this.preview()?.sizeBytes ?? 0));
  protected readonly processedText = computed(() => formatNumber(this.progress().processed));
  protected readonly failedText = computed(() => formatNumber(this.progress().failed));
  protected readonly insertedText = computed(() =>
    formatNumber(Math.max(0, this.progress().processed - this.progress().failed)),
  );
  protected readonly canImport = computed(
    () =>
      this.preview() !== null && !this.busy() && !this.readOnly() && this.mappingProblem() === null,
  );

  private subscription: Subscription | null = null;
  private previewAbort: AbortController | null = null;
  /** Withdraws a pending `WriteGuard` confirmation (Cancel, close, destroy, read-only). */
  private approveAbort: AbortController | null = null;
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.subscription?.unsubscribe();
      this.previewAbort?.abort();
      this.approveAbort?.abort();
    });
    // The target collection starts as the tab's collection.
    effect(() => {
      const coll = this.target().coll;
      untracked(() => {
        if (this.collName() === '') this.collName.set(coll);
      });
    });
    // A profile that is (or turns) read-only never gets an import: stop and close.
    effect(() => {
      if (this.readOnly()) untracked(() => this.close());
    });
  }

  protected setFormat(event: Event): void {
    this.format.set((event.target as HTMLInputElement).value as FileFormat);
    // A file chosen for the other format would be parsed differently: choose it again.
    if (this.preview() !== null && !this.busy()) {
      this.preview.set(null);
      this.phase.set('idle');
    }
  }

  protected setName(event: Event): void {
    this.collName.set((event.target as HTMLInputElement).value);
    this.nameTouched.set(true);
  }

  /** Changes one column of the CSV mapping. */
  protected setColumn(
    index: number,
    change: Partial<Pick<CsvColumnRow, 'include' | 'path' | 'type'>>,
  ): void {
    this.csvRows.update((rows) => rows.map((r, i) => (i === index ? { ...r, ...change } : r)));
  }

  protected setInclude(index: number, event: Event): void {
    this.setColumn(index, { include: (event.target as HTMLInputElement).checked });
  }

  protected setPath(index: number, event: Event): void {
    this.setColumn(index, { path: (event.target as HTMLInputElement).value });
  }

  protected setType(index: number, event: Event): void {
    this.setColumn(index, { type: (event.target as HTMLSelectElement).value as CsvType });
  }

  /** The theme color of a CSV type (the tick beside its select). */
  protected typeColor(type: CsvType): string {
    const token = CSV_TYPE_OPTIONS.find((t) => t.value === type)?.token ?? '--text-faint';
    return `var(${token})`;
  }

  protected setOrdered(event: Event): void {
    this.ordered.set((event.target as HTMLInputElement).checked);
  }

  protected setStopOnError(event: Event): void {
    this.stopOnError.set((event.target as HTMLInputElement).checked);
  }

  /** Opens the backend's file dialog and shows the file's first documents. */
  async choose(): Promise<void> {
    if (this.busy() || this.readOnly()) return;
    this.phase.set('choosing');
    this.error.set(null);
    const abort = new AbortController();
    this.previewAbort = abort;
    try {
      const preview = await this.api.request(
        'io.previewImport',
        { format: this.format(), sampleSize: PREVIEW_SAMPLE_SIZE },
        { signal: abort.signal },
      );
      if (abort.signal.aborted) return;
      if (preview === null) {
        // Dialog cancelled: keep the file chosen before, if any.
        this.phase.set(this.preview() !== null ? 'previewed' : 'idle');
        return;
      }
      this.preview.set(preview);
      this.csvRows.set(defaultCsvRows(preview.csvColumns ?? [], preview.csvRows ?? []));
      this.progress.set(NO_PROGRESS);
      this.phase.set('previewed');
    } catch (error) {
      if (abort.signal.aborted) return;
      this.preview.set(null);
      this.error.set(describeError(error));
      this.phase.set('error');
    } finally {
      if (this.previewAbort === abort) this.previewAbort = null;
    }
  }

  /** Imports the chosen file (after the confirm dialog where the profile needs one). */
  async start(): Promise<void> {
    const preview = this.preview();
    if (preview === null || this.busy() || this.readOnly() || this.approveAbort) return;
    if (this.mappingProblem() !== null) return;
    this.nameTouched.set(false);
    if (this.nameProblem() !== null) return;
    const { profileId, db } = this.target();
    const coll = this.collName().trim();
    this.error.set(null);
    const abort = new AbortController();
    this.approveAbort = abort;
    let params;
    try {
      params = await this.guard.approve(
        'io.import',
        {
          profileId,
          db,
          coll,
          fileToken: preview.fileToken,
          ordered: this.ordered(),
          stopOnError: this.stopOnError(),
          ...(preview.csvColumns !== undefined ? { csvMapping: csvMapping(this.csvRows()) } : {}),
        },
        {
          detail: `From ${preview.fileName} (${this.sizeText()}).`,
          confirmLabel: 'Import',
          signal: abort.signal,
        },
      );
    } catch (error) {
      if (ApiError.from(error).code === 'CANCELLED' || abort.signal.aborted) return;
      this.error.set(describeError(error));
      this.phase.set('error');
      return;
    } finally {
      if (this.approveAbort === abort) this.approveAbort = null;
    }
    // Closed, destroyed or turned read-only while the confirm dialog was open: send nothing.
    if (abort.signal.aborted || this.destroyed || this.readOnly()) return;
    this.phase.set('importing');
    this.progress.set(NO_PROGRESS);
    this.subscription = this.api.stream('io.import', params).subscribe({
      next: (progress) => this.progress.set(progress),
      error: (error: unknown) => {
        this.subscription = null;
        this.error.set(describeError(error));
        this.phase.set('error');
        this.ended(profileId, db, coll);
      },
      complete: () => {
        this.subscription = null;
        this.phase.set('done');
        // The file token was used: importing it again needs a new choice (no accidental repeat).
        this.preview.set(null);
        this.ended(profileId, db, coll);
      },
    });
  }

  /** Stops a running import; documents inserted so far stay. */
  cancel(): void {
    if (this.approveAbort) {
      this.approveAbort.abort();
      this.approveAbort = null;
    }
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
      this.phase.set('cancelled');
      const { profileId, db } = this.target();
      this.ended(profileId, db, this.collName().trim());
    }
    if (this.previewAbort) {
      this.previewAbort.abort();
      this.previewAbort = null;
      this.phase.set(this.preview() !== null ? 'previewed' : 'idle');
    }
  }

  close(): void {
    this.cancel();
    this.closed.emit();
  }

  /** An import stopped (any way): the tab and the sidebar show what was inserted. */
  private ended(profileId: string, db: string, coll: string): void {
    const { processed, failed } = this.progress();
    this.imported.emit({ coll, inserted: Math.max(0, processed - failed) });
    void this.refreshSidebar(profileId, db);
  }

  /** A new collection appears in the sidebar; counts are read again. */
  private async refreshSidebar(profileId: string, db: string): Promise<void> {
    try {
      await this.sidebar.loadCollections(profileId, db);
    } catch {
      // The sidebar shows its own error.
    }
  }
}
