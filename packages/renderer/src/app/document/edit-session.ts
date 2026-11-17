import { computed, Injectable, signal } from '@angular/core';
import { type BsonDocument, type BsonValue, stringifyEJson } from '@thicket/core/bson';
import { bsonEquals, diffDocuments, type DocumentDiff } from '@thicket/core/diff';

/** A document with unsaved edits: the version it was loaded as and the edited one. */
export interface EditedDocument {
  /** Canonical EJSON of the `_id`, the session's key. */
  readonly key: string;
  readonly original: BsonDocument;
  readonly current: BsonDocument;
  /**
   * Loaded with a query projection, so `original` may be partial: Save must not replace what it
   * hides (see `DocumentActions.save`).
   */
  readonly partial: boolean;
  /**
   * Loaded with a projection that may hide parts of fields (a dotted path or an operator such as
   * `$slice`, see `isTopLevelProjection`): a loaded field may lack sub-fields, so Overwrite and
   * Merge manually stay refused even when a top-level projection is active later.
   */
  readonly hidesSubFields: boolean;
}

/** What Save would send for one document, or why it can't be saved. */
export type PendingSave =
  | {
      readonly ok: true;
      readonly diff: Exclude<DocumentDiff, { kind: 'none' }>;
      readonly changes: number;
    }
  | { readonly ok: false; readonly error: string; readonly changes: number };

/** One edit, for undo and redo. */
interface Step {
  readonly key: string;
  readonly original: BsonDocument;
  readonly before: BsonDocument;
  readonly after: BsonDocument;
  readonly partial: boolean;
  readonly hidesSubFields: boolean;
}

/** Most edits kept for undo (per collection tab). */
export const UNDO_LIMIT = 500;

/** Canonical EJSON of a document's first `_id`, or `null` without one. */
export function documentKey(doc: BsonDocument): string | null {
  const id = idOf(doc);
  return id === null ? null : stringifyEJson(id);
}

/** A document's first `_id` value, or `null` without one. */
export function idOf(doc: BsonDocument): BsonValue | null {
  return doc.fields.find((f) => f.key === '_id')?.value ?? null;
}

/**
 * The unsaved edits of one collection tab (SPEC.md M1 "Editing and saving"): edits stay local
 * until Save; each edited document has a change count (the operations Save would send); undo and
 * redo walk the edits made since the last save or revert, across the tab's documents; Revert
 * discards a document's edits. Documents are keyed by their `_id`, so edits survive paging away
 * and back. Provided per collection view.
 */
@Injectable()
export class DocumentEdits {
  private readonly entries = signal<ReadonlyMap<string, EditedDocument>>(new Map());
  private readonly undoStack = signal<readonly Step[]>([]);
  private readonly redoStack = signal<readonly Step[]>([]);

  /** Edited documents, in the order they were first edited. */
  readonly documents = computed(() => [...this.entries().values()]);
  /** Per key, what Save would send (or why it can't). */
  readonly pending = computed(() => {
    const out = new Map<string, PendingSave>();
    for (const entry of this.entries().values()) out.set(entry.key, pendingSave(entry));
    return out;
  });
  /** Changes over all edited documents. */
  readonly changeCount = computed(() => {
    let n = 0;
    for (const p of this.pending().values()) n += p.changes;
    return n;
  });
  readonly modified = computed(() => this.entries().size > 0);
  readonly canUndo = computed(() => this.undoStack().length > 0);
  readonly canRedo = computed(() => this.redoStack().length > 0);

  /** The document as shown: with its unsaved edits, else `doc` itself. */
  current(doc: BsonDocument): BsonDocument {
    const key = documentKey(doc);
    return (key !== null && this.entries().get(key)?.current) || doc;
  }

  /** The edited document under `key`, if it has unsaved edits. */
  get(key: string): EditedDocument | undefined {
    return this.entries().get(key);
  }

  isModified(key: string): boolean {
    return this.entries().has(key);
  }

  /**
   * Records an edit of the loaded document `original` (as shown, i.e. maybe already edited) to
   * `edited`. Returns false when nothing changed or the document has no `_id`. Editing a
   * document back to its loaded version clears its modified state (the edit can still be undone).
   * `partial`: the document was loaded with a projection (sticks to the document until saved).
   * `hidesSubFields`: that projection may hide parts of fields (sticks the same way).
   */
  edit(
    original: BsonDocument,
    edited: BsonDocument,
    partial = false,
    hidesSubFields = false,
  ): boolean {
    const key = documentKey(original);
    if (key === null) return false;
    const entry = this.entries().get(key);
    const base = entry?.original ?? original;
    const before = entry?.current ?? original;
    if (bsonEquals(before, edited)) return false;
    const flags = {
      partial: (entry?.partial ?? false) || partial || hidesSubFields,
      hidesSubFields: (entry?.hidesSubFields ?? false) || hidesSubFields,
    };
    this.apply(key, base, edited, flags);
    this.undoStack.update((s) =>
      [...s, { key, original: base, before, after: edited, ...flags }].slice(-UNDO_LIMIT),
    );
    this.redoStack.set([]);
    return true;
  }

  /** Undoes the last edit. */
  undo(): void {
    const stack = this.undoStack();
    const step = stack.at(-1);
    if (step === undefined) return;
    this.undoStack.set(stack.slice(0, -1));
    this.apply(step.key, step.original, step.before, step);
    this.redoStack.update((s) => [...s, step]);
  }

  /** Redoes the last undone edit. */
  redo(): void {
    const stack = this.redoStack();
    const step = stack.at(-1);
    if (step === undefined) return;
    this.redoStack.set(stack.slice(0, -1));
    this.apply(step.key, step.original, step.after, step);
    this.undoStack.update((s) => [...s, step]);
  }

  /**
   * Discards the edits of one document (Revert, or after it was saved or deleted): it shows its
   * loaded version again, and its edits leave the undo and redo history.
   */
  discard(key: string): void {
    this.entries.update((map) => {
      if (!map.has(key)) return map;
      const next = new Map(map);
      next.delete(key);
      return next;
    });
    this.undoStack.update((s) => s.filter((step) => step.key !== key));
    this.redoStack.update((s) => s.filter((step) => step.key !== key));
  }

  /**
   * One document was saved as `saved`: that becomes its baseline. Edits made after the save was
   * sent stay unsaved (on top of `saved`); without such edits the document is no longer modified.
   * Its steps leave the undo and redo history, as after a discard.
   */
  rebase(key: string, saved: BsonDocument): void {
    const entry = this.entries().get(key);
    if (entry === undefined) return;
    this.apply(key, saved, entry.current, entry);
    this.undoStack.update((s) => s.filter((step) => step.key !== key));
    this.redoStack.update((s) => s.filter((step) => step.key !== key));
  }

  /** Discards every unsaved edit (Revert all). */
  discardAll(): void {
    this.entries.set(new Map());
    this.undoStack.set([]);
    this.redoStack.set([]);
  }

  private apply(
    key: string,
    original: BsonDocument,
    current: BsonDocument,
    { partial, hidesSubFields }: Pick<EditedDocument, 'partial' | 'hidesSubFields'>,
  ): void {
    this.entries.update((map) => {
      const next = new Map(map);
      if (bsonEquals(original, current)) next.delete(key);
      else next.set(key, { key, original, current, partial, hidesSubFields });
      return next;
    });
  }
}

/** The update Save sends for `entry`, with its number of changes. */
export function pendingSave(entry: Pick<EditedDocument, 'original' | 'current'>): PendingSave {
  let diff: DocumentDiff;
  try {
    diff = diffDocuments(entry.original, entry.current);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      changes: 1,
    };
  }
  if (diff.kind === 'none') return { ok: false, error: 'Nothing changed.', changes: 0 };
  const changes = diff.kind === 'update' ? diff.ops.length : Math.max(1, diff.changedFields.length);
  return { ok: true, diff, changes };
}
