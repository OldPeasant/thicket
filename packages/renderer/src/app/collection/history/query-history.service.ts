import { Injectable, inject, signal } from '@angular/core';
import type { FavoriteQuery, HistoryEntry, SavedQuery } from '@thicket/contract';

import { ApiService, describeError } from '../../api';

/** The collection whose history is shown. */
export interface HistoryTarget {
  profileId: string;
  db: string;
  coll: string;
}

function sameTarget(a: HistoryTarget | null, b: HistoryTarget): boolean {
  return a !== null && a.profileId === b.profileId && a.db === b.db && a.coll === b.coll;
}

function copy(query: SavedQuery): SavedQuery {
  const { filter, projection, sort, collation, limit } = query;
  return { filter, projection, sort, collation, limit };
}

/**
 * Query history and favorites of one collection tab (kept by main: `history.*`). Provided per
 * collection view. Answers for a collection the tab no longer shows are dropped.
 */
@Injectable()
export class QueryHistory {
  private readonly api = inject(ApiService);
  private target: HistoryTarget | null = null;
  /** Number of the last request sent; answers are applied only if newer than what a list shows. */
  private sent = 0;
  private entriesSeq = 0;
  private favoritesSeq = 0;

  /** Recent queries, newest first. */
  readonly entries = signal<readonly HistoryEntry[]>([]);
  /** Favorites, by name. */
  readonly favorites = signal<readonly FavoriteQuery[]>([]);
  /** The last failed history request, for the user; cleared by the next success. */
  readonly error = signal<string | null>(null);

  /** Shows the history of `target` (reads it from main). */
  async load(target: HistoryTarget): Promise<void> {
    this.target = { ...target };
    this.entries.set([]);
    this.favorites.set([]);
    this.error.set(null);
    await this.call(target, async () => {
      const seq = ++this.sent;
      const { entries, favorites } = await this.api.request('history.list', { ...target });
      return () => {
        this.setEntries(seq, entries);
        this.setFavorites(seq, favorites);
      };
    });
  }

  /** Records a query that was run (an equal one moves to the top). */
  async record(query: SavedQuery): Promise<void> {
    const target = this.target;
    if (target === null) return;
    await this.call(target, async () => {
      const seq = ++this.sent;
      const { entries } = await this.api.request('history.add', { ...target, query: copy(query) });
      return () => this.setEntries(seq, entries);
    });
  }

  /** Saves `query` as the favorite `name` (replacing one of that name). Resolves `true` on success. */
  async saveFavorite(name: string, query: SavedQuery): Promise<boolean> {
    const target = this.target;
    if (target === null) return false;
    return this.call(target, async () => {
      const seq = ++this.sent;
      const { favorites } = await this.api.request('history.saveFavorite', {
        ...target,
        name,
        query: copy(query),
      });
      return () => this.setFavorites(seq, favorites);
    });
  }

  async deleteFavorite(id: string): Promise<void> {
    const target = this.target;
    if (target === null) return;
    await this.call(target, async () => {
      const seq = ++this.sent;
      const { favorites } = await this.api.request('history.deleteFavorite', { ...target, id });
      return () => this.setFavorites(seq, favorites);
    });
  }

  async clear(): Promise<void> {
    const target = this.target;
    if (target === null) return;
    await this.call(target, async () => {
      const seq = ++this.sent;
      const { entries } = await this.api.request('history.clear', { ...target });
      return () => this.setEntries(seq, entries);
    });
  }

  /**
   * Main answers in request order, but an answer older than the one a list shows (e.g. a slow
   * `history.list` after a `history.add` sent later) must not replace it.
   */
  private setEntries(seq: number, entries: readonly HistoryEntry[]): void {
    if (seq <= this.entriesSeq) return;
    this.entriesSeq = seq;
    this.entries.set(entries);
  }

  private setFavorites(seq: number, favorites: readonly FavoriteQuery[]): void {
    if (seq <= this.favoritesSeq) return;
    this.favoritesSeq = seq;
    this.favorites.set(favorites);
  }

  /** Runs a request; applies its answer only while `target` is still shown. */
  private async call(target: HistoryTarget, send: () => Promise<() => void>): Promise<boolean> {
    try {
      const apply = await send();
      if (!sameTarget(this.target, target)) return false;
      apply();
      this.error.set(null);
      return true;
    } catch (error) {
      if (sameTarget(this.target, target)) this.error.set(describeError(error));
      return false;
    }
  }
}
