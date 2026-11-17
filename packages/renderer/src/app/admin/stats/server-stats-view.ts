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

import type { ResultOf } from '@thicket/contract';

import { ApiError, describeError } from '../../api/api-error';
import { ApiService } from '../../api/api.service';
import type { WorkspaceTab } from '../../layout/workspace.service';
import {
  addSample,
  EMPTY_HISTORY,
  formatBytes,
  formatCount,
  formatLag,
  formatMebibytes,
  formatUptime,
  HISTORY_SIZE,
  memberLevel,
  OP_KINDS,
  parseReplSet,
  parseStatus,
  type ReplMember,
  type ReplSetView,
  type StatsHistory,
  totalOps,
} from './server-stats.model';
import { type ChartSeries, StatsChart } from './stats-chart';

/** What the server stats tab of a connection needs (the tab's `data`). */
export interface ServerStatsTabData {
  readonly profileId: string;
}

/** Stable id of the server stats tab of a connection. */
export function serverStatsTabId(profileId: string): string {
  return `serverstats:${profileId}`;
}

/** Auto-refresh intervals in seconds (0: off). */
export const STATS_INTERVALS = [0, 1, 2, 5, 10] as const;

/** Default auto-refresh interval in seconds. */
export const DEFAULT_STATS_SECS = 2;

export type ReplState =
  | { readonly state: 'loading' }
  | { readonly state: 'none' }
  | { readonly state: 'loaded'; readonly view: ReplSetView }
  | { readonly state: 'error'; readonly message: string };

export interface DbRow {
  readonly name: string;
  readonly stats: Omit<ResultOf<'db.stats'>, 'raw'> | null;
  readonly error: string | null;
}

export type DbState =
  | { readonly state: 'loading' }
  | { readonly state: 'loaded'; readonly rows: readonly DbRow[] }
  | { readonly state: 'error'; readonly message: string };

/** How many `db.stats` requests run at the same time. */
const DB_STATS_PARALLEL = 4;

const OP_LABELS: Record<(typeof OP_KINDS)[number], string> = {
  insert: 'insert',
  query: 'query',
  update: 'update',
  delete: 'delete',
  getmore: 'getmore',
  command: 'command',
};

/**
 * Server stats dashboard of a connection (SPEC M6 "Could"): `serverStatus` sampled every few
 * seconds into live charts (operations per second by type, connections, memory), the replica set
 * members (`replSetGetStatus`) with state, health and lag, and `dbStats` of every database
 * (read on open and on request, not live). The next sample is read after the previous answer.
 */
@Component({
  selector: 'app-server-stats-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StatsChart],
  templateUrl: './server-stats-view.html',
  styleUrl: './server-stats-view.css',
})
export class ServerStatsView {
  readonly tab = input.required<WorkspaceTab>();

  private readonly api = inject(ApiService);

  protected readonly profileId = computed(
    () => (this.tab().data as Partial<ServerStatsTabData> | undefined)?.profileId ?? '',
  );

  readonly refreshSecs = signal<number>(DEFAULT_STATS_SECS);
  readonly history = signal<StatsHistory>(EMPTY_HISTORY);
  /** Error of the last `serverStatus` read (the charts keep their history). */
  readonly statusError = signal<string | null>(null);
  readonly repl = signal<ReplState>({ state: 'loading' });
  readonly dbs = signal<DbState>({ state: 'loading' });
  readonly updatedAt = signal<Date | null>(null);

  protected readonly intervals = STATS_INTERVALS;
  protected readonly slots = HISTORY_SIZE;
  protected readonly sample = computed(() => this.history().last);
  protected readonly points = computed(() => this.history().points);
  protected readonly latest = computed(() => this.points().at(-1) ?? null);
  protected readonly times = computed(() => this.points().map((p) => p.at));

  protected readonly opsSeries = computed<ChartSeries[]>(() =>
    OP_KINDS.map((kind, i) => ({
      key: kind,
      label: OP_LABELS[kind],
      slot: i + 1,
      values: this.points().map((p) => p.ops[kind]),
    })),
  );
  protected readonly connectionSeries = computed<ChartSeries[]>(() => [
    {
      key: 'current',
      label: 'current',
      slot: 1,
      values: this.points().map((p) => p.connections),
    },
  ]);
  /** Resident memory only: virtual is many times larger and would flatten it (it is a tile). */
  protected readonly memorySeries = computed<ChartSeries[]>(() => [
    { key: 'resident', label: 'resident', slot: 1, values: this.points().map((p) => p.resident) },
  ]);
  protected readonly networkSeries = computed<ChartSeries[]>(() => [
    { key: 'in', label: 'in', slot: 1, values: this.points().map((p) => p.bytesIn) },
    { key: 'out', label: 'out', slot: 2, values: this.points().map((p) => p.bytesOut) },
  ]);

  protected readonly replView = computed(() => {
    const repl = this.repl();
    return repl.state === 'loaded' ? repl.view : null;
  });
  protected readonly replError = computed(() => {
    const repl = this.repl();
    return repl.state === 'error' ? repl.message : '';
  });
  protected readonly dbRows = computed(() => {
    const dbs = this.dbs();
    return dbs.state === 'loaded' ? dbs.rows : [];
  });
  protected readonly dbError = computed(() => {
    const dbs = this.dbs();
    return dbs.state === 'error' ? dbs.message : '';
  });

  protected readonly totalOps = computed(() => {
    const point = this.latest();
    return point === null ? null : totalOps(point);
  });
  protected readonly role = computed(() => {
    const sample = this.sample();
    if (sample === null) return '';
    if (sample.process === 'mongos') return 'mongos';
    if (sample.setName === null) return 'standalone';
    return `${sample.primary === true ? 'primary' : 'secondary'} of ${sample.setName}`;
  });

  protected readonly formatCount = formatCount;
  protected readonly formatBytes = formatBytes;
  protected readonly formatMebibytes = formatMebibytes;
  protected readonly formatUptime = formatUptime;
  protected readonly formatLag = formatLag;
  protected readonly memberLevel = memberLevel;
  protected readonly formatWhole = (v: number) => formatCount(Math.round(v));
  protected readonly formatBytesRate = (v: number) => `${formatBytes(v)}/s`;
  protected readonly formatMib = (v: number) => formatMebibytes(v);

  private request: AbortController | null = null;
  private dbRequest: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor() {
    effect(() => {
      const profileId = this.profileId();
      untracked(() => {
        if (!profileId) return;
        this.history.set(EMPTY_HISTORY);
        void this.refresh();
        void this.loadDatabases();
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.request?.abort();
      this.dbRequest?.abort();
      this.clearTimer();
    });
  }

  setRefresh(text: string): void {
    const secs = Number(text);
    this.refreshSecs.set(Number.isFinite(secs) && secs > 0 ? secs : 0);
    this.schedule();
  }

  /** Reads `serverStatus` and the replica set status again (and schedules the next read). */
  async refresh(): Promise<void> {
    if (this.destroyed) return;
    this.request?.abort();
    this.clearTimer();
    const request = new AbortController();
    this.request = request;
    const profileId = this.profileId();
    const options = { signal: request.signal };
    const [status, repl] = await Promise.allSettled([
      this.api.request('admin.serverStatus', { profileId }, options),
      this.api.request('admin.replSetStatus', { profileId }, options),
    ]);
    if (request.signal.aborted) return;
    if (status.status === 'fulfilled') {
      const sample = parseStatus(status.value.status);
      if (sample === null) {
        this.statusError.set('The server answered serverStatus with something unexpected.');
      } else {
        this.history.update((h) => addSample(h, sample));
        this.statusError.set(null);
        this.updatedAt.set(new Date());
      }
    } else if (!this.cancelled(status.reason)) {
      this.statusError.set(describeError(status.reason));
    }
    if (repl.status === 'fulfilled') {
      const text = repl.value.status;
      const view = text === null ? null : parseReplSet(text);
      this.repl.set(view === null ? { state: 'none' } : { state: 'loaded', view });
    } else if (!this.cancelled(repl.reason)) {
      this.repl.set({ state: 'error', message: describeError(repl.reason) });
    }
    if (this.request === request) {
      this.request = null;
      this.schedule();
    }
  }

  /** Reads the databases and their `dbStats` (a few at a time). */
  async loadDatabases(): Promise<void> {
    if (this.destroyed) return;
    this.dbRequest?.abort();
    const request = new AbortController();
    this.dbRequest = request;
    const profileId = this.profileId();
    const options = { signal: request.signal };
    this.dbs.set({ state: 'loading' });
    let names: string[];
    try {
      const { databases } = await this.api.request('db.listDatabases', { profileId }, options);
      names = databases.map((d) => d.name);
    } catch (error) {
      if (request.signal.aborted || this.cancelled(error)) return;
      this.dbs.set({ state: 'error', message: describeError(error) });
      return;
    }
    const rows: DbRow[] = names.map((name) => ({ name, stats: null, error: null }));
    let next = 0;
    const worker = async () => {
      while (next < names.length && !request.signal.aborted) {
        const index = next++;
        const name = names[index] as string;
        try {
          const s = await this.api.request('db.stats', { profileId, db: name }, options);
          const stats = {
            collections: s.collections,
            views: s.views,
            objects: s.objects,
            dataSize: s.dataSize,
            storageSize: s.storageSize,
            indexSize: s.indexSize,
          };
          rows[index] = { name, stats, error: null };
        } catch (error) {
          rows[index] = { name, stats: null, error: describeError(error) };
        }
      }
    };
    await Promise.all(Array.from({ length: DB_STATS_PARALLEL }, worker));
    if (request.signal.aborted) return;
    this.dbs.set({ state: 'loaded', rows });
    if (this.dbRequest === request) this.dbRequest = null;
  }

  protected formatTime(ms: number | null): string {
    return ms === null ? '–' : new Date(ms).toLocaleString();
  }

  protected memberTitle(member: ReplMember): string {
    return member.message || `${member.state}${member.healthy ? '' : ' (unreachable)'}`;
  }

  private cancelled(error: unknown): boolean {
    return ApiError.from(error).code === 'CANCELLED';
  }

  private schedule(): void {
    this.clearTimer();
    const secs = this.refreshSecs();
    if (this.destroyed || secs <= 0 || this.request !== null) return;
    this.timer = setTimeout(() => void this.refresh(), secs * 1000);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
