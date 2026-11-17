import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import type { Subscription } from 'rxjs';

import type { GridfsBucket, GridfsFile } from '@thicket/contract';

import { ApiError, describeError } from '../api/api-error';
import { ApiService } from '../api/api.service';
import type { WorkspaceTab } from '../layout/workspace.service';
import { WriteControl } from '../safety/write-control.directive';
import { WriteGuard } from '../safety/write-guard.service';
import { bucketCall, formatBytes, formatDate, fraction, type GridfsTabData } from './gridfs.model';

/** The bucket used when a database has none yet (the driver's default). */
export const DEFAULT_BUCKET = 'fs';

/** A list as loaded from the backend. */
export type Loaded<T> =
  | { readonly state: 'loading' }
  | { readonly state: 'loaded'; readonly value: T }
  | { readonly state: 'error'; readonly message: string };

/** A running upload or download. */
export interface Transfer {
  readonly kind: 'upload' | 'download';
  readonly name: string;
  readonly bytes: number;
  readonly totalBytes: number;
}

interface Message {
  readonly error: boolean;
  readonly text: string;
}

/**
 * GridFS files of one database (SPEC M6 "Could"): pick a bucket, list its files (newest first,
 * filtered by name), upload a file chosen with the native open dialog and download one to a file
 * chosen with the save dialog, both with a byte progress bar and Cancel; delete with a confirm.
 * Upload and delete go through `WriteGuard` (refused on read-only profiles, confirmed on
 * production ones; delete always asks). One transfer runs at a time.
 */
@Component({
  selector: 'app-gridfs-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WriteControl],
  templateUrl: './gridfs-view.html',
  styleUrl: './gridfs-view.css',
})
export class GridfsView {
  readonly tab = input.required<WorkspaceTab>();

  private readonly api = inject(ApiService);
  private readonly guard = inject(WriteGuard);

  protected readonly target = computed<GridfsTabData>(
    () => {
      const data = this.tab().data as Partial<GridfsTabData> | undefined;
      return { profileId: data?.profileId ?? '', db: data?.db ?? '' };
    },
    { equal: (a, b) => a.profileId === b.profileId && a.db === b.db },
  );

  readonly buckets = signal<Loaded<readonly GridfsBucket[]>>({ state: 'loading' });
  readonly files = signal<Loaded<{ files: readonly GridfsFile[]; total: number }>>({
    state: 'loading',
  });
  readonly bucket = signal(DEFAULT_BUCKET);
  readonly nameFilter = signal('');
  readonly transfer = signal<Transfer | null>(null);
  readonly message = signal<Message | null>(null);
  /** Id of the file being deleted. */
  readonly deleting = signal<string | null>(null);

  /** Buckets to pick from: the loaded ones, or the default bucket when there are none. */
  protected readonly bucketNames = computed(() => {
    const loaded = this.buckets();
    const names = loaded.state === 'loaded' ? loaded.value.map((b) => b.name) : [];
    if (!names.includes(this.bucket())) names.unshift(this.bucket());
    return names;
  });
  protected readonly call = computed(() => bucketCall(this.bucket()));
  protected readonly fileList = computed(() => {
    const files = this.files();
    return files.state === 'loaded' ? files.value.files : null;
  });
  protected readonly total = computed(() => {
    const files = this.files();
    return files.state === 'loaded' ? files.value.total : 0;
  });
  protected readonly loadError = computed(() => {
    const files = this.files();
    const buckets = this.buckets();
    if (buckets.state === 'error') return buckets.message;
    return files.state === 'error' ? files.message : null;
  });
  protected readonly percent = computed(() => {
    const t = this.transfer();
    return t ? Math.round(fraction(t.bytes, t.totalBytes) * 100) : 0;
  });

  protected readonly formatBytes = formatBytes;
  protected readonly formatDate = formatDate;

  private bucketsRequest: AbortController | null = null;
  private filesRequest: AbortController | null = null;
  private running: Subscription | null = null;

  constructor() {
    effect(() => {
      const target = this.target();
      untracked(() => {
        if (target.profileId && target.db) void this.reload();
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.bucketsRequest?.abort();
      this.filesRequest?.abort();
      this.running?.unsubscribe();
    });
  }

  /** Reads the buckets, keeps the chosen one when it still exists, then its files. */
  async reload(): Promise<void> {
    this.bucketsRequest?.abort();
    const request = new AbortController();
    this.bucketsRequest = request;
    this.buckets.set({ state: 'loading' });
    try {
      const { buckets } = await this.api.request('gridfs.buckets', this.target(), {
        signal: request.signal,
      });
      if (request.signal.aborted) return;
      this.buckets.set({ state: 'loaded', value: buckets });
      const names = buckets.map((b) => b.name);
      if (!names.includes(this.bucket())) this.bucket.set(names[0] ?? DEFAULT_BUCKET);
    } catch (error) {
      if (request.signal.aborted || ApiError.from(error).code === 'CANCELLED') return;
      this.buckets.set({ state: 'error', message: describeError(error) });
      return;
    }
    await this.loadFiles();
  }

  selectBucket(name: string): void {
    if (name === this.bucket()) return;
    this.bucket.set(name);
    this.message.set(null);
    void this.loadFiles();
  }

  setFilter(text: string): void {
    this.nameFilter.set(text);
    void this.loadFiles();
  }

  async loadFiles(): Promise<void> {
    this.filesRequest?.abort();
    const request = new AbortController();
    this.filesRequest = request;
    this.files.set({ state: 'loading' });
    const filter = this.nameFilter().trim();
    try {
      const result = await this.api.request(
        'gridfs.files',
        {
          ...this.target(),
          bucket: this.bucket(),
          ...(filter !== '' ? { nameContains: filter } : {}),
        },
        { signal: request.signal },
      );
      if (request.signal.aborted) return;
      this.files.set({ state: 'loaded', value: result });
    } catch (error) {
      if (request.signal.aborted || ApiError.from(error).code === 'CANCELLED') return;
      this.files.set({ state: 'error', message: describeError(error) });
    }
  }

  /** Asks for a file (native dialog) and uploads it into the chosen bucket. */
  async upload(): Promise<void> {
    if (this.transfer() !== null || this.running) return;
    this.message.set(null);
    const bucket = this.bucket();
    let params;
    try {
      params = await this.guard.approve('gridfs.upload', { ...this.target(), bucket });
    } catch (error) {
      if (ApiError.from(error).code !== 'CANCELLED') {
        this.message.set({ error: true, text: describeError(error) });
      }
      return;
    }
    let name = '';
    this.running = this.api
      .stream('gridfs.upload', params, {
        onStart: (result) => {
          if (result.streamId === null) return;
          name = result.fileName ?? '';
          this.transfer.set({ kind: 'upload', name, bytes: 0, totalBytes: result.sizeBytes ?? 0 });
        },
      })
      .subscribe({
        next: (p) => this.transfer.set({ kind: 'upload', name, ...p }),
        error: (error: unknown) => this.finish({ error: true, text: describeError(error) }),
        complete: () => {
          const started = this.transfer() !== null;
          this.finish(started ? { error: false, text: `Uploaded ${name} to ${bucket}.` } : null);
          if (started) void this.reload();
        },
      });
  }

  /** Asks for a target path (native dialog) and downloads `file` into it. */
  download(file: GridfsFile): void {
    if (this.transfer() !== null || this.running) return;
    this.message.set(null);
    let path = '';
    this.running = this.api
      .stream(
        'gridfs.download',
        { ...this.target(), bucket: this.bucket(), id: file.id },
        {
          onStart: (result) => {
            if (result.streamId === null) return;
            path = result.path ?? '';
            this.transfer.set({
              kind: 'download',
              name: file.filename,
              bytes: 0,
              totalBytes: file.length,
            });
          },
        },
      )
      .subscribe({
        next: (p) => this.transfer.set({ kind: 'download', name: file.filename, ...p }),
        error: (error: unknown) => this.finish({ error: true, text: describeError(error) }),
        complete: () =>
          this.finish(
            this.transfer() !== null
              ? { error: false, text: `Downloaded ${file.filename} to ${path}.` }
              : null,
          ),
      });
  }

  /** Stops the running transfer; the backend removes what it wrote. */
  cancelTransfer(): void {
    const t = this.transfer();
    this.running?.unsubscribe();
    this.finish(
      t ? { error: false, text: `Cancelled the ${t.kind} of ${t.name}; nothing was kept.` } : null,
    );
  }

  async remove(file: GridfsFile): Promise<void> {
    if (this.deleting() !== null) return;
    this.deleting.set(file.id);
    this.message.set(null);
    try {
      const { deleted } = await this.guard.run(
        'gridfs.delete',
        { ...this.target(), bucket: this.bucket(), id: file.id },
        {
          alwaysConfirm: true,
          confirmLabel: 'Delete file',
          detail: `Deletes ${file.filename} (${formatBytes(file.length)}) and its chunks from ${this.bucket()}.`,
        },
      );
      this.message.set({
        error: false,
        text: deleted ? `Deleted ${file.filename}.` : `${file.filename} was already gone.`,
      });
      await this.reload();
    } catch (error) {
      if (ApiError.from(error).code !== 'CANCELLED') {
        this.message.set({ error: true, text: describeError(error) });
      }
    } finally {
      this.deleting.set(null);
    }
  }

  private finish(message: Message | null): void {
    this.running = null;
    this.transfer.set(null);
    if (message) this.message.set(message);
  }
}
