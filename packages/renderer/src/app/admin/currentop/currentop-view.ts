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

import { ApiError, describeError } from '../../api/api-error';
import { ApiService } from '../../api/api.service';
import type { WorkspaceTab } from '../../layout/workspace.service';
import { WriteControl, WriteGuard } from '../../safety';
import {
  currentOpCall,
  durationLevel,
  durationShare,
  EMPTY_FILTER,
  formatDuration,
  OP_TYPES,
  type OpEntry,
  type OpFilter,
  toOpEntry,
} from './currentop.model';

/** What the current operations tab of a connection needs (the tab's `data`). */
export interface CurrentOpTabData {
  readonly profileId: string;
}

/** Stable id of the current operations tab of a connection. */
export function currentOpTabId(profileId: string): string {
  return `currentop:${profileId}`;
}

/** Auto-refresh intervals in seconds (0: off). */
export const REFRESH_INTERVALS = [0, 2, 5, 10] as const;

/** Default auto-refresh interval in seconds. */
export const DEFAULT_REFRESH_SECS = 5;

export type OpsState =
  | { readonly state: 'loading' }
  | { readonly state: 'loaded'; readonly items: readonly OpEntry[]; readonly at: Date }
  | { readonly state: 'error'; readonly message: string };

/**
 * Running operations of a connection (SPEC M6 "Should"): `currentOp` filtered by namespace
 * prefix, minimum running time and operation type (idle and system operations on request),
 * refreshed automatically; each operation can be killed (`killOp`) after the confirm dialog
 * (`WriteGuard` with `alwaysConfirm`; read-only profiles can't).
 */
@Component({
  selector: 'app-currentop-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WriteControl],
  templateUrl: './currentop-view.html',
  styleUrl: './currentop-view.css',
})
export class CurrentOpView {
  readonly tab = input.required<WorkspaceTab>();

  private readonly api = inject(ApiService);
  private readonly guard = inject(WriteGuard);

  protected readonly profileId = computed(
    () => (this.tab().data as Partial<CurrentOpTabData> | undefined)?.profileId ?? '',
  );

  readonly filter = signal<OpFilter>(EMPTY_FILTER);
  readonly refreshSecs = signal<number>(DEFAULT_REFRESH_SECS);
  readonly ops = signal<OpsState>({ state: 'loading' });
  /** Result of the last kill (or its error), shown above the list. */
  readonly notice = signal<{ text: string; error: boolean } | null>(null);
  /** `opId` of the kill waiting for confirmation or the server. */
  readonly killing = signal<string | null>(null);

  protected readonly opTypes = OP_TYPES;
  protected readonly intervals = REFRESH_INTERVALS;
  protected readonly call = computed(() => currentOpCall(this.filter()));
  protected readonly items = computed(() => {
    const ops = this.ops();
    return ops.state === 'loaded' ? ops.items : null;
  });
  protected readonly error = computed(() => {
    const ops = this.ops();
    return ops.state === 'error' ? ops.message : null;
  });
  protected readonly longest = computed(() =>
    Math.max(0, ...(this.items() ?? []).map((op) => op.secs ?? 0)),
  );
  protected readonly updatedAt = computed(() => {
    const ops = this.ops();
    return ops.state === 'loaded' ? ops.at.toLocaleTimeString() : null;
  });

  protected readonly formatDuration = formatDuration;
  protected readonly durationLevel = durationLevel;
  protected durationShare(op: OpEntry): number {
    return durationShare(op.secs, this.longest());
  }

  private request: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Reload when the connection or the filters change.
    effect(() => {
      const profileId = this.profileId();
      this.filter();
      untracked(() => {
        if (profileId) void this.refresh();
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.request?.abort();
      this.clearTimer();
    });
  }

  setFilter(change: Partial<OpFilter>): void {
    const next = { ...this.filter(), ...change };
    const current = this.filter();
    if (
      next.ns === current.ns &&
      next.minSecs === current.minSecs &&
      next.opType === current.opType &&
      next.all === current.all
    ) {
      return;
    }
    this.filter.set(next);
  }

  setNamespace(text: string): void {
    this.setFilter({ ns: text.trim() });
  }

  setMinSecs(text: string): void {
    const n = Number(text);
    this.setFilter({ minSecs: Number.isFinite(n) && n > 0 ? n : 0 });
  }

  setRefresh(text: string): void {
    const secs = Number(text);
    this.refreshSecs.set(Number.isFinite(secs) && secs > 0 ? secs : 0);
    this.schedule();
  }

  /** Reads the operations again (and schedules the next automatic read). */
  async refresh(): Promise<void> {
    this.request?.abort();
    this.clearTimer();
    const request = new AbortController();
    this.request = request;
    const { ns, minSecs, opType, all } = this.filter();
    const params = {
      profileId: this.profileId(),
      ...(ns ? { ns } : {}),
      ...(minSecs > 0 ? { minSecsRunning: minSecs } : {}),
      ...(opType ? { opType } : {}),
      ...(all ? { all } : {}),
    };
    if (this.ops().state !== 'loaded') this.ops.set({ state: 'loading' });
    try {
      const { ops } = await this.api.request('admin.currentOp', params, {
        signal: request.signal,
      });
      if (request.signal.aborted) return;
      this.ops.set({ state: 'loaded', items: ops.map(toOpEntry), at: new Date() });
    } catch (error) {
      if (request.signal.aborted || ApiError.from(error).code === 'CANCELLED') return;
      this.ops.set({ state: 'error', message: describeError(error) });
    }
    if (this.request === request) {
      this.request = null;
      this.schedule();
    }
  }

  /** Kills `op` after the confirm dialog, then reads the list again. */
  async kill(op: OpEntry): Promise<void> {
    if (op.opId === null || this.killing() !== null) return;
    this.killing.set(op.opId);
    this.notice.set(null);
    const where = op.ns ? ` on ${op.ns}` : '';
    try {
      await this.guard.run(
        'admin.killOp',
        { profileId: this.profileId(), opId: op.opId },
        {
          alwaysConfirm: true,
          title: `Kill operation ${op.opIdLabel}`,
          confirmLabel: 'Kill operation',
          detail: `${op.op || 'Operation'}${where}, running ${formatDuration(op.secs)}.`,
        },
      );
      this.notice.set({
        text: `Asked the server to kill operation ${op.opIdLabel}.`,
        error: false,
      });
      await this.refresh();
    } catch (error) {
      if (ApiError.from(error).code !== 'CANCELLED') {
        this.notice.set({ text: describeError(error), error: true });
      }
    } finally {
      this.killing.set(null);
    }
  }

  private schedule(): void {
    this.clearTimer();
    const secs = this.refreshSecs();
    if (secs <= 0 || this.request !== null) return;
    this.timer = setTimeout(() => void this.refresh(), secs * 1000);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
