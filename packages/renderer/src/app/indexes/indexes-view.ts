import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import type { IndexInfo, IndexStats } from '@thicket/contract';
import { type BsonDocument, parseEJsonDocument } from '@thicket/core/bson';
import { printShellSyntax } from '@thicket/core/shellsyntax';

import { ApiError, describeError } from '../api/api-error';
import { ApiService } from '../api/api.service';
import type { WorkspaceTab } from '../layout/workspace.service';
import { WriteControl } from '../safety/write-control.directive';
import { WriteGuard } from '../safety/write-guard.service';
import type { CollectionTabData } from '../sidebar/sidebar-tree.service';
import { IndexCreateForm, type IndexTarget } from './index-create-form';

/** Stable id of the indexes tab of a collection. */
export function indexesTabId(profileId: string, db: string, coll: string): string {
  return `indexes:${profileId}:${db}.${coll}`;
}

/** One field of a key pattern as shown: `asc`/`desc` or the index type (`text`, `2dsphere`, …). */
export interface KeyPart {
  field: string;
  kind: string;
}

export interface IndexTag {
  label: string;
  /** Detail on hover (the partial filter, the collation). */
  title?: string;
}

export interface IndexRow {
  name: string;
  keys: readonly KeyPart[];
  tags: readonly IndexTag[];
  hidden: boolean;
  /** The partial filter in shell syntax. */
  partialFilter: string | null;
  /** The `_id_` index: it can't be dropped or hidden. */
  isId: boolean;
  sizeBytes: number | null;
  accesses: number | null;
  since: string | null;
  /** Accesses relative to the most used index (0..1), `null` without usage stats. */
  usage: number | null;
}

function shell(text: string | BsonDocument): string {
  try {
    const value = typeof text === 'string' ? parseEJsonDocument(text) : text;
    return printShellSyntax(value);
  } catch {
    return String(text);
  }
}

export function keyParts(key: string): KeyPart[] {
  let parsed: BsonDocument;
  try {
    parsed = parseEJsonDocument(key);
  } catch {
    return [{ field: key, kind: '?' }];
  }
  return parsed.fields.map(({ key: field, value }) => {
    if (value.type === 'string') return { field, kind: value.value };
    const n =
      value.type === 'int' || value.type === 'double' || value.type === 'long'
        ? Number(value.value)
        : value.type === 'decimal'
          ? Number(value.value)
          : 1;
    return { field, kind: n < 0 ? 'desc' : 'asc' };
  });
}

/** "48 KB" style sizes (1024-based, one decimal under 10). */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const text = unit === 0 || value >= 10 ? String(Math.round(value)) : value.toFixed(1);
  return `${text} ${units[unit]}`;
}

function tagsOf(index: IndexInfo): IndexTag[] {
  const tags: IndexTag[] = [];
  if (index.unique) tags.push({ label: 'unique' });
  if (index.sparse) tags.push({ label: 'sparse' });
  if (index.expireAfterSeconds !== undefined) {
    tags.push({ label: `TTL ${index.expireAfterSeconds} s`, title: 'expireAfterSeconds' });
  }
  if (index.partialFilterExpression !== undefined) {
    tags.push({ label: 'partial', title: 'partialFilterExpression' });
  }
  try {
    const raw = parseEJsonDocument(index.raw);
    const collation = raw.fields.find((f) => f.key === 'collation')?.value;
    if (collation?.type === 'object') {
      const locale = collation.fields.find((f) => f.key === 'locale')?.value;
      const label = locale?.type === 'string' ? `collation ${locale.value}` : 'collation';
      tags.push({ label, title: shell(collation) });
    }
  } catch {
    // The raw spec is only extra detail.
  }
  return tags;
}

/** Indexes with their stats, in the server's order. */
export function toRows(
  indexes: readonly IndexInfo[],
  stats: readonly IndexStats[] | null,
): IndexRow[] {
  const byName = new Map((stats ?? []).map((s) => [s.name, s]));
  const most = Math.max(0, ...(stats ?? []).map((s) => s.accesses ?? 0));
  return indexes.map((index) => {
    const s = byName.get(index.name);
    const accesses = s?.accesses ?? null;
    return {
      name: index.name,
      keys: keyParts(index.key),
      tags: tagsOf(index),
      hidden: index.hidden,
      partialFilter:
        index.partialFilterExpression === undefined ? null : shell(index.partialFilterExpression),
      isId: index.name === '_id_',
      sizeBytes: s?.sizeBytes ?? null,
      accesses,
      since: s?.since ?? null,
      usage: accesses === null ? null : most === 0 ? 0 : accesses / most,
    };
  });
}

const numberFormat = new Intl.NumberFormat();

/**
 * The indexes of a collection (SPEC M3 "Index management"), set as `db.<coll>.getIndexes()`:
 * one row per index with its key pattern, options, size and usage since the server counted
 * (`$indexStats`); a meter shows each index's use relative to the busiest one, so unused indexes
 * stand out. Create opens the form; drop asks first; hide/unhide toggles the planner's view.
 * Every write goes through `WriteGuard`.
 */
@Component({
  selector: 'app-indexes-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WriteControl, IndexCreateForm],
  templateUrl: './indexes-view.html',
  styleUrl: './indexes-view.css',
})
export class IndexesView {
  readonly tab = input.required<WorkspaceTab>();

  private readonly api = inject(ApiService);
  private readonly guard = inject(WriteGuard);

  protected readonly target = computed<IndexTarget>(
    () => {
      const data = this.tab().data as Partial<CollectionTabData> | undefined;
      return {
        profileId: data?.profileId ?? '',
        db: data?.db ?? '',
        coll: data?.coll ?? this.tab().title,
      };
    },
    {
      equal: (a, b) => a.profileId === b.profileId && a.db === b.db && a.coll === b.coll,
    },
  );

  readonly rows = signal<readonly IndexRow[] | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  /** Stats could not be read (e.g. no `indexStats` privilege): sizes/usage stay empty. */
  readonly statsError = signal<string | null>(null);
  /** Outcome of the last create, drop or hide. */
  readonly message = signal<{ error: boolean; text: string } | null>(null);
  readonly creating = signal(false);
  /** Name of the index a drop or hide is running for. */
  readonly busy = signal<string | null>(null);
  protected readonly hasUsage = computed(() => (this.rows() ?? []).some((r) => r.usage !== null));

  private generation = 0;

  constructor() {
    effect(() => {
      this.target();
      untracked(() => void this.reload());
    });
  }

  /** Reads the list and the stats again; an older answer never replaces a newer one. */
  async reload(): Promise<void> {
    const gen = ++this.generation;
    const target = this.target();
    this.loading.set(true);
    try {
      const [list, stats] = await Promise.all([
        this.api.request('idx.list', target),
        this.api.request('idx.stats', target).then(
          (r) => ({ ok: true as const, indexes: r.indexes }),
          (e: unknown) => ({ ok: false as const, error: describeError(e) }),
        ),
      ]);
      if (gen !== this.generation) return;
      this.rows.set(toRows(list.indexes, stats.ok ? stats.indexes : null));
      this.statsError.set(stats.ok ? null : stats.error);
      this.loadError.set(null);
    } catch (e) {
      if (gen !== this.generation) return;
      this.loadError.set(describeError(e));
    } finally {
      if (gen === this.generation) this.loading.set(false);
    }
  }

  protected openCreate(): void {
    this.message.set(null);
    this.creating.set(true);
  }

  protected created(name: string): void {
    this.creating.set(false);
    this.message.set({ error: false, text: `Created index ${name}.` });
    void this.reload();
  }

  async drop(row: IndexRow): Promise<void> {
    await this.write(row, 'Dropped', () =>
      this.guard.run(
        'idx.drop',
        { ...this.target(), name: row.name },
        { alwaysConfirm: true, confirmLabel: 'Drop index', detail: `Drops ${row.name}.` },
      ),
    );
  }

  async toggleHidden(row: IndexRow): Promise<void> {
    const hidden = !row.hidden;
    await this.write(row, hidden ? 'Hid' : 'Unhid', () =>
      this.guard.run('idx.hide', { ...this.target(), name: row.name, hidden }),
    );
  }

  private async write(row: IndexRow, done: string, send: () => Promise<unknown>): Promise<void> {
    if (this.busy() !== null) return;
    this.busy.set(row.name);
    this.message.set(null);
    try {
      await send();
      this.message.set({ error: false, text: `${done} index ${row.name}.` });
      await this.reload();
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'CANCELLED')) {
        this.message.set({ error: true, text: describeError(e) });
      }
    } finally {
      this.busy.set(null);
    }
  }

  protected size(row: IndexRow): string {
    return row.sizeBytes === null ? '—' : formatBytes(row.sizeBytes);
  }

  protected uses(row: IndexRow): string {
    return row.accesses === null ? '—' : numberFormat.format(row.accesses);
  }

  protected sinceText(row: IndexRow): string {
    if (row.since === null) return '';
    const date = new Date(row.since);
    return Number.isNaN(date.getTime()) ? row.since : `since ${date.toLocaleString()}`;
  }

  protected arrow(kind: string): string {
    if (kind === 'asc') return '↑';
    if (kind === 'desc') return '↓';
    return kind;
  }
}
