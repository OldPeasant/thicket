import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import {
  BROADCAST_STREAMS,
  type CollectionInfo,
  type ConnStatus,
  type DatabaseInfo,
  type Profile,
  type ResultOf,
} from '@thicket/contract';

import { currentOpTabId, type CurrentOpTabData } from '../admin/currentop/currentop-view';
import { watchTabId, watchTitle, type WatchTabData } from '../watch/watch.model';
import { usersTabId, type UsersTabData } from '../admin/users/users-roles-view';
import { gridfsTabId, type GridfsTabData } from '../gridfs/gridfs.model';
import { ApiError, describeError } from '../api/api-error';
import { ApiService } from '../api/api.service';
import { type ShellTabData, shellTabId } from '../console/shell-console';
import { WorkspaceService } from '../layout/workspace.service';
import { ProfileSafetyService } from '../safety/profile-safety.service';
import { WriteGuard } from '../safety/write-guard.service';

/** A lazily loaded value: still loading, loaded, or failed with a readable message. */
export type Load<T> =
  { status: 'loading' } | { status: 'loaded'; value: T } | { status: 'error'; message: string };

export type ConnState = ConnStatus['state'];

/** Connection state of a profile as the sidebar shows it. */
export interface ConnView {
  state: ConnState;
  /** Readable error when `state` is `error`. */
  message?: string;
}

export type DbStats = Omit<ResultOf<'db.stats'>, 'raw'>;
export type CollStats = Omit<ResultOf<'coll.stats'>, 'raw'>;

/** Data of a collection tab opened from the sidebar (`WorkspaceTab.data`). */
export interface CollectionTabData {
  profileId: string;
  db: string;
  coll: string;
  type: CollectionInfo['type'];
}

/** Stable id of the workspace tab of a collection. */
export function collectionTabId(profileId: string, db: string, coll: string): string {
  return `collection:${profileId}:${db}.${coll}`;
}

/** Key of a database in the per-database maps. */
export function dbKey(profileId: string, db: string): string {
  return `${profileId}\u0000${db}`;
}

/** Key of a collection in the per-collection maps. */
export function collKey(profileId: string, db: string, coll: string): string {
  return `${profileId}\u0000${db}\u0000${coll}`;
}

/** Characters MongoDB refuses in database names (all platforms). */
const DB_NAME_FORBIDDEN = /[/\\. "$*<>:|?]/;

/** Why `name` is not a valid database name, or `null`. */
export function dbNameProblem(name: string): string | null {
  if (name === '') return 'Enter a name.';
  if (DB_NAME_FORBIDDEN.test(name))
    return 'A database name cannot contain / \\ . " $ * < > : | ? or spaces.';
  if (new TextEncoder().encode(name).length > 63) return 'A database name has at most 63 bytes.';
  return null;
}

/** Why `name` is not a valid collection name, or `null`. */
export function collNameProblem(name: string): string | null {
  if (name === '') return 'Enter a name.';
  if (name.includes('$')) return 'A collection name cannot contain $.';
  if (name.includes('\u0000')) return 'A collection name cannot contain the null character.';
  if (name.startsWith('system.')) return 'Names starting with "system." are reserved.';
  if (name.startsWith('.') || name.endsWith('.'))
    return 'A collection name cannot start or end with a dot.';
  return null;
}

/**
 * State of the sidebar tree: the profiles, their connection states, and the databases,
 * collections and statistics loaded on demand. Writes (create, drop, rename) go through
 * `WriteGuard` (read-only refused, production confirmed, drops ask for the name to be typed) and
 * reload the affected list afterwards. Connection states follow the `conn.status` broadcast.
 */
@Injectable({ providedIn: 'root' })
export class SidebarTreeService {
  private readonly api = inject(ApiService);
  private readonly guard = inject(WriteGuard);
  private readonly safety = inject(ProfileSafetyService);
  private readonly workspace = inject(WorkspaceService);

  private readonly profilesState = signal<Load<readonly Profile[]>>({ status: 'loading' });
  private readonly connState = signal<ReadonlyMap<string, ConnView>>(new Map());
  private readonly dbState = signal<ReadonlyMap<string, Load<readonly DatabaseInfo[]>>>(new Map());
  private readonly collState = signal<ReadonlyMap<string, Load<readonly CollectionInfo[]>>>(
    new Map(),
  );
  private readonly dbStatsState = signal<ReadonlyMap<string, Load<DbStats>>>(new Map());
  private readonly collStatsState = signal<ReadonlyMap<string, Load<CollStats>>>(new Map());

  /** The profiles (`profiles.list`). */
  readonly profiles = this.profilesState.asReadonly();
  readonly profileList = computed(() => {
    const load = this.profilesState();
    return load.status === 'loaded' ? load.value : [];
  });

  private readonly promptOpenState = signal(false);
  /**
   * The sidebar's name/password prompt is open. It is modal: the shell ignores its tab shortcuts
   * and makes the work area inert meanwhile.
   */
  readonly promptOpen = this.promptOpenState.asReadonly();

  /**
   * Requests of the latest load per list (and of the latest `conn.open` per profile), so a slow
   * older answer never overwrites a newer one.
   */
  private readonly generation = new Map<string, number>();
  private started = false;

  constructor() {
    const subs = [
      this.api.broadcasts(BROADCAST_STREAMS.connStatus).subscribe((status) => {
        this.applyStatus(status);
      }),
      this.api.events(BROADCAST_STREAMS.backendRestarted).subscribe(() => {
        // The new backend has no open connections; answers of the old one are dropped.
        this.invalidate((key) => key !== 'profiles');
        this.connState.set(new Map());
        this.dbState.set(new Map());
        this.collState.set(new Map());
        this.dbStatsState.set(new Map());
        this.collStatsState.set(new Map());
      }),
    ];
    inject(DestroyRef).onDestroy(() => subs.forEach((sub) => sub.unsubscribe()));
  }

  /** Loads the profiles once (the sidebar calls this when it appears). */
  start(): void {
    if (this.started) return;
    this.started = true;
    void this.reloadProfiles();
  }

  /**
   * Reloads the profiles and their connection states. The connection editor calls this after
   * saving or deleting a profile.
   */
  async reloadProfiles(): Promise<void> {
    const gen = this.next('profiles');
    if (this.profilesState().status !== 'loaded') this.profilesState.set({ status: 'loading' });
    try {
      const { profiles } = await this.api.request('profiles.list', {});
      if (!this.current('profiles', gen)) return;
      for (const p of profiles) {
        this.safety.set({ id: p.id, name: p.name, readOnly: p.readOnly, production: p.production });
      }
      this.profilesState.set({ status: 'loaded', value: profiles });
    } catch (error) {
      if (this.current('profiles', gen))
        this.profilesState.set({ status: 'error', message: describeError(error) });
      return;
    }
    try {
      const { connections } = await this.api.request('conn.status', {});
      for (const status of connections) this.applyStatus(status);
    } catch {
      // States stay as they are; opening a connection reports its own errors.
    }
  }

  /** Called by the sidebar when its prompt opens or closes. */
  setPromptOpen(open: boolean): void {
    this.promptOpenState.set(open);
  }

  profile(id: string): Profile | undefined {
    return this.profileList().find((p) => p.id === id);
  }

  /** Connection state of a profile (`disconnected` when unknown). */
  conn(profileId: string): ConnView {
    return this.connState().get(profileId) ?? { state: 'disconnected' };
  }

  databases(profileId: string): Load<readonly DatabaseInfo[]> | undefined {
    return this.dbState().get(profileId);
  }

  collections(profileId: string, db: string): Load<readonly CollectionInfo[]> | undefined {
    return this.collState().get(dbKey(profileId, db));
  }

  dbStats(profileId: string, db: string): Load<DbStats> | undefined {
    return this.dbStatsState().get(dbKey(profileId, db));
  }

  collStats(profileId: string, db: string, coll: string): Load<CollStats> | undefined {
    return this.collStatsState().get(collKey(profileId, db, coll));
  }

  /** Whether the profile asks for its password on every connect. */
  asksPassword(profileId: string): boolean {
    return this.profile(profileId)?.auth?.secretMode === 'ask';
  }

  /**
   * Opens the connection (`conn.open`) and loads its databases. Resolves with the new state;
   * failures are shown on the node (and returned), not thrown. The answer of an attempt that a
   * disconnect or a newer connect made stale is ignored (it resolves with the current state).
   */
  async connect(profileId: string, password?: string): Promise<ConnView> {
    const key = `conn:${profileId}`;
    const gen = this.next(key);
    this.setConn(profileId, { state: 'connecting' });
    try {
      const status = await this.api.request(
        'conn.open',
        password === undefined ? { profileId } : { profileId, password },
      );
      if (!this.current(key, gen)) return this.conn(profileId);
      this.applyStatus(status);
    } catch (error) {
      if (!this.current(key, gen)) return this.conn(profileId);
      this.setConn(profileId, { state: 'error', message: describeError(error) });
    }
    const view = this.conn(profileId);
    if (view.state === 'connected') await this.loadDatabases(profileId);
    return view;
  }

  /** Closes the connection (`conn.close`) and forgets what was loaded for it. */
  async disconnect(profileId: string): Promise<void> {
    try {
      await this.api.request('conn.close', { profileId });
    } finally {
      this.setConn(profileId, { state: 'disconnected' });
      this.forgetProfile(profileId);
    }
  }

  /** Loads (or reloads) the databases of a connection. `withSizes` adds `sizeOnDisk`. */
  async loadDatabases(profileId: string, withSizes = false): Promise<void> {
    const key = `db:${profileId}`;
    const gen = this.next(key);
    if (this.dbState().get(profileId)?.status !== 'loaded') {
      this.dbState.update((m) => new Map(m).set(profileId, { status: 'loading' }));
    }
    let next: Load<readonly DatabaseInfo[]>;
    try {
      const { databases } = await this.api.request(
        'db.listDatabases',
        withSizes ? { profileId, withSizes } : { profileId },
      );
      next = { status: 'loaded', value: [...databases].sort((a, b) => byName(a.name, b.name)) };
    } catch (error) {
      next = { status: 'error', message: describeError(error) };
      if (this.current(key, gen)) this.noteDisconnect(profileId, error);
    }
    if (this.current(key, gen)) this.dbState.update((m) => new Map(m).set(profileId, next));
  }

  /** Loads (or reloads) the collections, views and time series of a database. */
  async loadCollections(profileId: string, db: string): Promise<void> {
    const k = dbKey(profileId, db);
    const gen = this.next(`coll:${k}`);
    if (this.collState().get(k)?.status !== 'loaded') {
      this.collState.update((m) => new Map(m).set(k, { status: 'loading' }));
    }
    let next: Load<readonly CollectionInfo[]>;
    try {
      const { collections } = await this.api.request('coll.list', { profileId, db });
      next = { status: 'loaded', value: [...collections].sort((a, b) => byName(a.name, b.name)) };
    } catch (error) {
      next = { status: 'error', message: describeError(error) };
      if (this.current(`coll:${k}`, gen)) this.noteDisconnect(profileId, error);
    }
    if (this.current(`coll:${k}`, gen)) this.collState.update((m) => new Map(m).set(k, next));
  }

  /** Loads `db.stats` of a database (counts and sizes on demand). */
  async loadDbStats(profileId: string, db: string): Promise<void> {
    const k = dbKey(profileId, db);
    const gen = this.next(`dbstats:${k}`);
    this.dbStatsState.update((m) => new Map(m).set(k, { status: 'loading' }));
    let next: Load<DbStats>;
    try {
      const result = await this.api.request('db.stats', { profileId, db });
      next = { status: 'loaded', value: withoutRaw(result) };
    } catch (error) {
      next = { status: 'error', message: describeError(error) };
    }
    if (this.current(`dbstats:${k}`, gen)) this.dbStatsState.update((m) => new Map(m).set(k, next));
  }

  /** Loads `coll.stats` of a collection (document count and sizes on demand). */
  async loadCollStats(profileId: string, db: string, coll: string): Promise<void> {
    const k = collKey(profileId, db, coll);
    const gen = this.next(`collstats:${k}`);
    this.collStatsState.update((m) => new Map(m).set(k, { status: 'loading' }));
    let next: Load<CollStats>;
    try {
      const result = await this.api.request('coll.stats', {
        profileId,
        db,
        coll,
      });
      next = { status: 'loaded', value: withoutRaw(result) };
    } catch (error) {
      next = { status: 'error', message: describeError(error) };
    }
    if (this.current(`collstats:${k}`, gen))
      this.collStatsState.update((m) => new Map(m).set(k, next));
  }

  /** Creates a database with its first collection, then reloads the database list. */
  async createDatabase(profileId: string, db: string, firstCollection: string): Promise<void> {
    await this.guard.run(
      'db.create',
      { profileId, db, firstCollection },
      { confirmLabel: 'Create database' },
    );
    await this.loadDatabases(profileId);
    await this.loadCollections(profileId, db);
  }

  /** Drops a database after the user typed its name. Rejects with `CANCELLED` when cancelled. */
  async dropDatabase(profileId: string, db: string): Promise<void> {
    await this.guard.run(
      'db.drop',
      { profileId, db },
      {
        alwaysConfirm: true,
        typeToConfirm: db,
        confirmLabel: 'Drop database',
        detail: 'Deletes the database with all its collections and documents.',
      },
    );
    this.closeTabs(profileId, db);
    this.collState.update((m) => without(m, dbKey(profileId, db)));
    this.dbStatsState.update((m) => without(m, dbKey(profileId, db)));
    await this.loadDatabases(profileId);
  }

  /** Creates a collection, then reloads the collection list. */
  async createCollection(profileId: string, db: string, coll: string): Promise<void> {
    await this.guard.run(
      'coll.create',
      { profileId, db, coll },
      { confirmLabel: 'Create collection' },
    );
    await this.loadCollections(profileId, db);
  }

  /** Drops a collection or view after the user typed its name. */
  async dropCollection(profileId: string, db: string, coll: string): Promise<void> {
    await this.guard.run(
      'coll.drop',
      { profileId, db, coll },
      {
        alwaysConfirm: true,
        typeToConfirm: coll,
        confirmLabel: 'Drop collection',
        detail: 'Deletes the collection with all its documents and indexes.',
      },
    );
    this.closeTabs(profileId, db, coll);
    this.collStatsState.update((m) => without(m, collKey(profileId, db, coll)));
    await this.loadCollections(profileId, db);
  }

  /** Renames a collection within its database. */
  async renameCollection(
    profileId: string,
    db: string,
    coll: string,
    newName: string,
  ): Promise<void> {
    await this.guard.run(
      'coll.rename',
      { profileId, db, coll, newName },
      { confirmLabel: 'Rename collection' },
    );
    this.closeTabs(profileId, db, coll);
    this.collStatsState.update((m) => without(m, collKey(profileId, db, coll)));
    await this.loadCollections(profileId, db);
  }

  /** Opens (or selects) the collection's tab. */
  openCollection(profileId: string, db: string, info: Pick<CollectionInfo, 'name' | 'type'>): void {
    const profile = this.profile(profileId);
    const data: CollectionTabData = { profileId, db, coll: info.name, type: info.type };
    this.workspace.open({
      id: collectionTabId(profileId, db, info.name),
      kind: 'collection',
      title: info.name,
      detail: `${profile?.name ?? profileId} / ${db}`,
      production: profile?.production === true,
      data: { ...data },
    });
  }

  /** Opens (or selects) the read-only users and roles tab of a database. */
  openUsers(profileId: string, db: string): void {
    const profile = this.profile(profileId);
    const data: UsersTabData = { profileId, db };
    this.workspace.open({
      id: usersTabId(profileId, db),
      kind: 'users',
      title: `${db} users`,
      detail: `${profile?.name ?? profileId} / ${db}`,
      production: profile?.production === true,
      data: { ...data },
    });
  }

  /** Opens (or selects) the GridFS tab of a database. */
  openGridfs(profileId: string, db: string): void {
    const profile = this.profile(profileId);
    const data: GridfsTabData = { profileId, db };
    this.workspace.open({
      id: gridfsTabId(profileId, db),
      kind: 'gridfs',
      title: `${db} files`,
      detail: `${profile?.name ?? profileId} / ${db}`,
      production: profile?.production === true,
      data: { ...data },
    });
  }

  /** Opens (or selects) the current operations tab of a connection. */
  openCurrentOps(profileId: string): void {
    const profile = this.profile(profileId);
    const data: CurrentOpTabData = { profileId };
    this.workspace.open({
      id: currentOpTabId(profileId),
      kind: 'currentop',
      title: 'Current operations',
      detail: profile?.name ?? profileId,
      production: profile?.production === true,
      data: { ...data },
    });
  }

  /** Opens (or selects) the change-stream tab of a deployment, database or collection. */
  openWatch(profileId: string, db?: string, coll?: string): void {
    const profile = this.profile(profileId);
    const data: WatchTabData = {
      profileId,
      ...(db !== undefined ? { db } : {}),
      ...(db !== undefined && coll !== undefined ? { coll } : {}),
    };
    const name = profile?.name ?? profileId;
    this.workspace.open({
      id: watchTabId(profileId, data.db, data.coll),
      kind: 'watch',
      title: watchTitle(data),
      detail: data.db === undefined ? name : `${name} / ${data.db}`,
      production: profile?.production === true,
      data: { ...data },
    });
  }

  /** Opens (or selects) the connection's mongosh console, starting in `db` when it is new. */
  openShell(profileId: string, db?: string): void {
    const profile = this.profile(profileId);
    const tabId = shellTabId(profileId);
    if (this.workspace.tabs().some((t) => t.id === tabId)) {
      this.workspace.activate(tabId);
      return;
    }
    const data: ShellTabData = { profileId, ...(db ? { db } : {}) };
    this.workspace.open({
      id: tabId,
      kind: 'shell',
      title: 'Shell',
      detail: profile?.name ?? profileId,
      production: profile?.production === true,
      data: { ...data },
    });
  }

  private applyStatus(status: ConnStatus): void {
    const view: ConnView = { state: status.state };
    if (status.error) view.message = describeError(new ApiError(status.error));
    this.setConn(status.profileId, view);
    if (status.state === 'disconnected' || status.state === 'error') {
      this.forgetProfile(status.profileId);
    }
  }

  /** A list request that failed with `NOT_CONNECTED` means the connection is gone. */
  private noteDisconnect(profileId: string, error: unknown): void {
    if (ApiError.from(error).code === 'NOT_CONNECTED') {
      this.setConn(profileId, { state: 'disconnected' });
    }
  }

  private setConn(profileId: string, view: ConnView): void {
    this.connState.update((m) => new Map(m).set(profileId, view));
  }

  private forgetProfile(profileId: string): void {
    const prefix = `${profileId}\u0000`;
    // Requests still running for the old connection must not write their answers back.
    this.invalidate((key) => {
      const sep = key.indexOf(':');
      const rest = key.slice(sep + 1);
      return sep > 0 && (rest === profileId || rest.startsWith(prefix));
    });
    const drop = <T>(m: ReadonlyMap<string, T>): ReadonlyMap<string, T> => {
      if (![...m.keys()].some((k) => k === profileId || k.startsWith(prefix))) return m;
      return new Map([...m].filter(([k]) => k !== profileId && !k.startsWith(prefix)));
    };
    this.dbState.update(drop);
    this.collState.update(drop);
    this.dbStatsState.update(drop);
    this.collStatsState.update(drop);
  }

  /** Closes the tabs of a dropped or renamed collection, or of every collection of a database. */
  private closeTabs(profileId: string, db: string, coll?: string): void {
    for (const tab of this.workspace.tabs()) {
      const data = tab.data as Partial<CollectionTabData> | undefined;
      if (
        (tab.kind === 'collection' ||
          tab.kind === 'aggregation' ||
          tab.kind === 'indexes' ||
          tab.kind === 'validator') &&
        data?.profileId === profileId &&
        data.db === db &&
        (coll === undefined || data.coll === coll)
      ) {
        this.workspace.close(tab.id);
      }
    }
  }

  private next(key: string): number {
    const gen = (this.generation.get(key) ?? 0) + 1;
    this.generation.set(key, gen);
    return gen;
  }

  private current(key: string, gen: number): boolean {
    return this.generation.get(key) === gen;
  }

  /** Makes the running requests of the matching lists stale, so their answers are dropped. */
  private invalidate(matches: (key: string) => boolean): void {
    for (const [key, gen] of this.generation) {
      if (matches(key)) this.generation.set(key, gen + 1);
    }
  }
}

function byName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}

function without<T>(map: ReadonlyMap<string, T>, key: string): ReadonlyMap<string, T> {
  if (!map.has(key)) return map;
  const next = new Map(map);
  next.delete(key);
  return next;
}

function withoutRaw<T extends { raw: unknown }>(value: T): Omit<T, 'raw'> {
  const copy: Partial<T> = { ...value };
  delete copy.raw;
  return copy as Omit<T, 'raw'>;
}
