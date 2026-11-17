import { signal } from '@angular/core';
import type { BsonDocument } from '@thicket/core/bson';

/** The last save of one document: what the server had before it, and what it wrote. */
export interface SavedVersion {
  readonly key: string;
  /** The document before the save (as loaded; only the shown fields when it was partial). */
  readonly before: BsonDocument;
  /** The document as the server stored it after the save (see `DocumentActions.recordSave`). */
  readonly after: BsonDocument;
  /** It was loaded with a projection or cut (see `DocumentActions.isPartial`). */
  readonly partial: boolean;
  /** That projection may hide parts of fields (see `DocumentEdits.edit`). */
  readonly hidesSubFields: boolean;
}

/**
 * "Undo last save": the pre-save version of the last save per document (keyed like
 * `DocumentEdits`, by `_id`), for one collection tab. A newer save of the same document replaces
 * its entry; an undo, a delete or a conflicting undo removes it.
 */
export class SaveHistory {
  private readonly saves = signal<ReadonlyMap<string, SavedVersion>>(new Map());

  /** Reactive (reads a signal). */
  get(key: string): SavedVersion | undefined {
    return this.saves().get(key);
  }

  has(key: string): boolean {
    return this.saves().has(key);
  }

  record(version: SavedVersion): void {
    this.saves.update((map) => new Map(map).set(version.key, version));
  }

  drop(key: string): void {
    this.saves.update((map) => {
      if (!map.has(key)) return map;
      const next = new Map(map);
      next.delete(key);
      return next;
    });
  }
}
