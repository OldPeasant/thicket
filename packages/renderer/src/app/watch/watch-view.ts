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

import { parseEJsonDocument } from '@thicket/core/bson';
import { printShellSyntax } from '@thicket/core/shellsyntax';

import { ApiError, describeError } from '../api/api-error';
import { ApiService } from '../api/api.service';
import type { WorkspaceTab } from '../layout/workspace.service';
import {
  formatEventTime,
  toWatchEntry,
  watchCall,
  type FullDocumentMode,
  type WatchEntry,
  type WatchTabData,
} from './watch.model';

/** Events kept in the list; older ones are dropped (the count says so). */
export const MAX_EVENTS = 1000;

export type WatchState =
  | { readonly state: 'starting' }
  | { readonly state: 'watching' }
  | { readonly state: 'stopped' }
  /** The server ended the stream (e.g. `invalidate` after a drop). */
  | { readonly state: 'ended' }
  /** A standalone server: change streams need a replica set. */
  | { readonly state: 'needsReplicaSet'; readonly message: string }
  | { readonly state: 'error'; readonly message: string };

/** The document opened from an event, as it is on the server now. */
export type OpenedDocument =
  | { readonly state: 'loading'; readonly entry: WatchEntry }
  | { readonly state: 'loaded'; readonly entry: WatchEntry; readonly text: string }
  | { readonly state: 'missing'; readonly entry: WatchEntry }
  | { readonly state: 'error'; readonly entry: WatchEntry; readonly message: string };

/**
 * Change events of a deployment, database or collection (SPEC M6 "Could"), live: `admin.watch`
 * starts when the tab opens and runs until Stop or the tab closes. Newest events first; each
 * one expands to the whole event, and "Open document" loads the changed document as it is now
 * (`docs.get`). A standalone server gets a clear "needs a replica set" notice.
 */
@Component({
  selector: 'app-watch-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './watch-view.html',
  styleUrl: './watch-view.css',
})
export class WatchView {
  readonly tab = input.required<WorkspaceTab>();

  private readonly api = inject(ApiService);

  protected readonly target = computed<WatchTabData>(() => {
    const data = (this.tab().data ?? {}) as Partial<WatchTabData>;
    return {
      profileId: data.profileId ?? '',
      ...(data.db !== undefined ? { db: data.db } : {}),
      ...(data.db !== undefined && data.coll !== undefined ? { coll: data.coll } : {}),
    };
  });

  readonly fullDocument = signal<FullDocumentMode>('updateLookup');
  readonly status = signal<WatchState>({ state: 'stopped' });
  /** Newest first. */
  readonly entries = signal<readonly WatchEntry[]>([]);
  /** Events received since the last Clear (more than the list keeps). */
  readonly received = signal(0);
  readonly expanded = signal<ReadonlySet<number>>(new Set());
  readonly opened = signal<OpenedDocument | null>(null);

  protected readonly call = computed(() => watchCall(this.target(), this.fullDocument()));
  protected readonly running = computed(() => {
    const s = this.status().state;
    return s === 'starting' || s === 'watching';
  });
  protected readonly showNamespace = computed(() => this.target().coll === undefined);
  protected readonly dropped = computed(() => Math.max(0, this.received() - this.entries().length));
  protected readonly formatTime = formatEventTime;
  protected readonly errorMessage = computed(() => {
    const s = this.status();
    return s.state === 'error' ? s.message : '';
  });
  protected readonly docText = computed(() => {
    const d = this.opened();
    return d?.state === 'loaded' ? d.text : '';
  });
  protected readonly docError = computed(() => {
    const d = this.opened();
    return d?.state === 'error' ? d.message : '';
  });

  private subscription: Subscription | null = null;
  private seq = 0;
  private docRequest: AbortController | null = null;

  constructor() {
    effect(() => {
      const { profileId } = this.target();
      untracked(() => {
        if (profileId) this.start();
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.stop();
      this.docRequest?.abort();
    });
  }

  /** (Re)starts the change stream; events from before the start are not reported. */
  start(): void {
    this.subscription?.unsubscribe();
    const { profileId, db, coll } = this.target();
    this.status.set({ state: 'starting' });
    const fullDocument = this.fullDocument();
    const params = {
      profileId,
      ...(db !== undefined ? { db } : {}),
      ...(coll !== undefined ? { coll } : {}),
      ...(fullDocument !== 'default' ? { fullDocument } : {}),
    };
    const subscription = this.api
      .stream('admin.watch', params, {
        onStart: () => {
          if (this.subscription === subscription) this.status.set({ state: 'watching' });
        },
      })
      .subscribe({
        next: ({ event }) => this.add(event),
        complete: () => {
          if (this.subscription !== subscription) return;
          this.subscription = null;
          this.status.set({ state: 'ended' });
        },
        error: (error: unknown) => {
          if (this.subscription !== subscription) return;
          this.subscription = null;
          this.status.set(this.failure(error));
        },
      });
    // A synchronous failure has already settled the subscription.
    this.subscription = subscription.closed ? null : subscription;
  }

  /** Stops the change stream (the backend kills the server cursor). */
  stop(): void {
    const subscription = this.subscription;
    this.subscription = null;
    subscription?.unsubscribe();
    if (subscription) this.status.set({ state: 'stopped' });
  }

  clear(): void {
    this.entries.set([]);
    this.received.set(0);
    this.expanded.set(new Set());
  }

  setFullDocument(lookup: boolean): void {
    const mode: FullDocumentMode = lookup ? 'updateLookup' : 'default';
    if (mode === this.fullDocument()) return;
    this.fullDocument.set(mode);
    if (this.running()) this.start();
  }

  toggle(entry: WatchEntry): void {
    this.expanded.update((set) => {
      const next = new Set(set);
      if (next.has(entry.seq)) next.delete(entry.seq);
      else next.add(entry.seq);
      return next;
    });
  }

  /** Loads the changed document as it is on the server now. */
  async open(entry: WatchEntry): Promise<void> {
    if (!entry.openable || entry.id === null) return;
    this.docRequest?.abort();
    const request = new AbortController();
    this.docRequest = request;
    this.opened.set({ state: 'loading', entry });
    try {
      const { doc } = await this.api.request(
        'docs.get',
        { profileId: this.target().profileId, db: entry.db, coll: entry.coll, id: entry.id },
        { signal: request.signal },
      );
      if (request.signal.aborted) return;
      this.opened.set(
        doc === null
          ? { state: 'missing', entry }
          : {
              state: 'loaded',
              entry,
              text: printShellSyntax(parseEJsonDocument(doc), { indent: 2 }),
            },
      );
    } catch (error) {
      if (request.signal.aborted || ApiError.from(error).code === 'CANCELLED') return;
      this.opened.set({ state: 'error', entry, message: describeError(error) });
    }
  }

  closeDocument(): void {
    this.docRequest?.abort();
    this.docRequest = null;
    this.opened.set(null);
  }

  private add(text: string): void {
    this.seq += 1;
    const entry = toWatchEntry(text, this.seq);
    this.received.update((n) => n + 1);
    this.entries.update((list) => [entry, ...list].slice(0, MAX_EVENTS));
  }

  private failure(error: unknown): WatchState {
    const api = ApiError.from(error);
    const detail = api.detail as { reason?: unknown } | undefined;
    if (api.code === 'UNSUPPORTED' && detail?.reason === 'needsReplicaSet') {
      return { state: 'needsReplicaSet', message: api.message };
    }
    return { state: 'error', message: describeError(error) };
  }
}
