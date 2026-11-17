import { computed, inject, Injectable, signal } from '@angular/core';
import { type ConflictDetail, conflictDetail, type SlicedArray } from '@thicket/contract';
import {
  type BsonDocument,
  type BsonField,
  type BsonValue,
  parseEJson,
  parseEJsonDocument,
  stringifyEJson,
} from '@thicket/core/bson';
import { bsonEquals, type DocumentDiff } from '@thicket/core/diff';
import { printShellSyntax } from '@thicket/core/shellsyntax';

import { ApiError, ApiService, describeError } from '../api';
import { generateObjectId } from '../explorer/bson-input.util';
import { WriteGuard } from '../safety/write-guard.service';
import { DocumentEdits, documentKey, idOf, pendingSave } from './edit-session';
import { SaveHistory } from './history';
import { applyUpdate } from './history/apply-update';

/** The collection the documents belong to, and how the view shows them. */
export interface DocumentHost {
  readonly profileId: string;
  readonly db: string;
  readonly coll: string;
  /** The query's projection (canonical EJSON), used to read a saved document back. */
  projection(): string | undefined;
  /**
   * The shown document `key` is a large document whose long arrays came cut (`arrays`, cut to
   * `above` items each); `undefined` for a document loaded whole. A saved large document is read
   * back cut the same way.
   */
  slicedOf?(key: string): { above: number; arrays: readonly SlicedArray[] } | undefined;
  /**
   * A document changed on the server: `doc` is its new version as canonical EJSON (`null` when
   * deleted, or when it could not be read back). `sliced`: the arrays `doc` has only partly
   * (`undefined`: it is whole). The view updates the shown page.
   */
  documentChanged(key: string, doc: string | null, sliced?: readonly SlicedArray[]): void;
}

/** A new document that is not inserted yet (Insert document, Clone). */
export interface DraftDocument {
  readonly id: number;
  readonly doc: BsonDocument;
  /** "New document", "Copy of 42". */
  readonly title: string;
}

/** A short line about the last action (shown in the edit bar). */
export interface ActionMessage {
  readonly kind: 'info' | 'error';
  readonly text: string;
}

/** A save that failed because the document changed on the server. */
export interface SaveConflict {
  readonly key: string;
  /**
   * The server version at the time of the save: `null` when deleted, `undefined` when it is
   * unknown (the conflict did not carry a readable version and reading it again failed).
   */
  readonly current: BsonDocument | null | undefined;
  /**
   * The arrays the local version has only partly (a large document whose long arrays were cut when
   * it was loaded, see `DocumentHost.slicedOf`); `undefined` when it was loaded whole.
   */
  readonly cut?: readonly SlicedArray[];
}

/**
 * Why Overwrite and Merge manually can't resolve a conflict: the server version is unknown, the
 * document was loaded with a projection they can't respect, or it is a large document whose long
 * arrays were loaded only partly (see `DocumentActions.resolveBlocker`).
 */
export type ResolveBlocker = 'server-unknown' | 'projection' | 'partial';

/**
 * Why a document deleted on the server can't be inserted again: `'projection'` while a projection
 * is active, `'partial'` when it was loaded only partly otherwise (edited under a projection since
 * cleared, or a large document whose long arrays were cut).
 */
export type ReinsertBlocker = 'projection' | 'partial';

let nextDraftId = 0;

/**
 * Writes of one collection tab's documents, all through `WriteGuard` (read-only profiles refused,
 * production profiles confirmed with the exact operation): Save (`docs.update` with the minimal
 * diff and the conflict filter, `docs.replace` when the diff needs it), Delete (always asks),
 * Insert of drafts (empty or a copy of a document). Provided per collection view.
 */
@Injectable()
export class DocumentActions {
  private readonly api = inject(ApiService);
  private readonly guard = inject(WriteGuard);
  private readonly edits = inject(DocumentEdits);

  private host: DocumentHost | null = null;
  private readonly busyKeys = signal<ReadonlySet<string>>(new Set());
  private readonly draftList = signal<readonly DraftDocument[]>([]);
  private readonly conflictMap = signal<ReadonlyMap<string, SaveConflict>>(new Map());
  private readonly messageState = signal<ActionMessage | null>(null);
  /** The pre-save version of each document's last save ("Undo last save"). */
  private readonly saveHistory = new SaveHistory();

  readonly drafts = this.draftList.asReadonly();
  /** A write is running. */
  readonly busy = computed(() => this.busyKeys().size > 0);
  /** Saves refused because the document changed on the server, per key. */
  readonly conflicts = computed(() => this.conflictMap());
  readonly message = this.messageState.asReadonly();

  /** Sets the collection; call before anything else. */
  setHost(host: DocumentHost): void {
    this.host = host;
  }

  isBusy(key: string): boolean {
    return this.busyKeys().has(key);
  }

  clearMessage(): void {
    this.messageState.set(null);
  }

  /**
   * Saves one edited document. Resolves with true when it was saved; false when the user
   * cancelled, it was refused or it failed (the edits stay and `message` says why).
   */
  async save(key: string): Promise<boolean> {
    this.requireHost();
    const entry = this.edits.get(key);
    if (entry === undefined || this.isBusy(key)) return false;
    const sent = entry.current;
    const partial = this.isPartial(key);
    // What was sent is the new baseline; edits made since then stay unsaved.
    return this.send(
      key,
      entry.original,
      sent,
      partial,
      () => {
        this.edits.rebase(key, sent);
        this.recordSave(key, entry.original, sent, partial, entry.hidesSubFields);
      },
      entry.hidesSubFields ? entry.original : undefined,
    );
  }

  /**
   * Whether the last save of the document under `key` can be undone (reactive): it was saved in
   * this tab and not undone or deleted since.
   */
  canUndoSave(key: string): boolean {
    return this.saveHistory.has(key);
  }

  /**
   * "Undo last save": writes the version from before the document's last save back, as the
   * minimal diff from the saved version with the saved version's values as the conflict check (as
   * Save does). When the document changed on the server since, nothing is overwritten: the
   * message says so and the undo is no longer offered. Refused while the document has unsaved
   * edits (Save or Revert them first). Resolves with true when the old version was written.
   */
  async undoSave(key: string): Promise<boolean> {
    this.requireHost();
    const last = this.saveHistory.get(key);
    if (last === undefined || this.isBusy(key)) return false;
    if (this.edits.isModified(key)) {
      this.messageState.set({ kind: 'error', text: UNDO_WITH_EDITS_REFUSED });
      return false;
    }
    return this.send(
      key,
      last.after,
      last.before,
      last.partial,
      () => this.saveHistory.drop(key),
      last.hidesSubFields ? last.after : undefined,
      {
        failure: 'Not undone',
        done: (id) => `Undid the last save of ${label(id)}.`,
        refused: 'Not undone',
        keepOrder: true,
        onConflict: () => {
          this.saveHistory.drop(key);
          this.messageState.set({ kind: 'error', text: UNDO_CONFLICT });
        },
      },
    );
  }

  private recordSave(
    key: string,
    before: BsonDocument,
    after: BsonDocument,
    partial: boolean,
    hidesSubFields: boolean,
  ): void {
    this.saveHistory.record({ key, before, after, partial, hidesSubFields });
  }

  /** Saves every edited document, one after the other; stops at the first that isn't saved. */
  async saveAll(): Promise<number> {
    let saved = 0;
    for (const entry of this.edits.documents()) {
      if (!(await this.save(entry.key))) break;
      saved++;
    }
    if (saved > 1) this.messageState.set({ kind: 'info', text: `Saved ${saved} documents.` });
    return saved;
  }

  /** Discards one document's edits (and a conflict reported for it). */
  revert(key: string): void {
    this.edits.discard(key);
    this.dropConflict(key);
    this.messageState.set(null);
  }

  revertAll(): void {
    this.edits.discardAll();
    this.conflictMap.set(new Map());
    this.messageState.set(null);
  }

  /**
   * Conflict "Overwrite": writes the local version over the server's current version. It is
   * saved as the diff from the server version with that version's values as the conflict check,
   * so a newer server change conflicts again. A document deleted on the server is inserted again.
   */
  async overwrite(key: string): Promise<boolean> {
    const entry = this.edits.get(key);
    if (entry === undefined) return false;
    const sent = entry.current;
    // As after a save: what was sent is the baseline, edits made since then stay unsaved.
    return this.resolveWith(key, sent, () => this.edits.rebase(key, sent));
  }

  /**
   * Conflict "Merge manually": saves `merged` (edited from both versions) over the server's
   * current version, with the same conflict check as `overwrite`. It must keep the `_id`.
   */
  async saveMerged(key: string, merged: BsonDocument): Promise<boolean> {
    const conflict = this.conflictMap().get(key);
    if (conflict === undefined || conflict.current === null) return false;
    if (this.refuseResolve(key)) return false;
    const id = conflict.current === undefined ? null : idOf(conflict.current);
    const mergedId = idOf(merged);
    if (id === null || mergedId === null || !bsonEquals(id, mergedId)) {
      this.messageState.set({
        kind: 'error',
        text: 'Not saved: the merged document must keep the _id of the document.',
      });
      return false;
    }
    // The merged document replaces the local edits.
    return this.resolveWith(key, merged, () => this.edits.discard(key));
  }

  /**
   * Conflict "Keep server version": discards the local edits and shows the server's current
   * version (read again, with the query's projection).
   */
  async keepServer(key: string): Promise<void> {
    const conflict = this.conflictMap().get(key);
    if (conflict === undefined) return;
    this.edits.discard(key);
    this.dropConflict(key);
    this.messageState.set({
      kind: 'info',
      text: 'Kept the server version; your edits are discarded.',
    });
    // The conflict's version is the whole server document (not cut), so a failed read-back shows
    // it whole.
    if (conflict.current === null) this.requireHost().documentChanged(key, null);
    else await this.readBack(key, key, conflict.current, true);
  }

  /** The document under `key` may be partial: it was edited or is shown with a projection. */
  isPartial(key: string): boolean {
    return (this.edits.get(key)?.partial ?? false) || this.requireHost().projection() !== undefined;
  }

  /**
   * Why Overwrite and Merge manually can't resolve the conflict under `key` (`null`: they can, or
   * there is no such conflict; a document deleted on the server is never blocked here).
   * `'server-unknown'`: the server's current version could not be read. `'projection'`: the
   * document may be partial and the query's projection is not one of whole top-level fields (a
   * dotted path or an operator such as `$slice`), it was edited under such a projection (even if
   * a top-level one is active now), or it was edited under a projection that is no longer active;
   * comparing top-level fields could then change data the user never loaded. `'partial'`: a large
   * document whose long arrays were cut when it was loaded (always blocked, with or without a
   * projection: the loaded items are not the whole array).
   */
  resolveBlocker(key: string): ResolveBlocker | null {
    const conflict = this.conflictMap().get(key);
    if (conflict === undefined || conflict.current === null) return null;
    if (conflict.current === undefined) return 'server-unknown';
    if (conflict.cut !== undefined) return 'partial';
    if (!this.isPartial(key)) return null;
    if (this.edits.get(key)?.hidesSubFields) return 'projection';
    const projection = this.requireHost().projection();
    return projection !== undefined && isTopLevelProjection(projection) ? null : 'projection';
  }

  /**
   * Why "Insert your version again" can't resolve the conflict under `key` (`null`: it can, or
   * the document was not deleted on the server). A partial document (see `isPartial`) or a cut
   * one is never inserted again: that would lose the data that was not loaded. The one rule for
   * the conflict view and `overwrite`.
   */
  reinsertBlocker(key: string): ReinsertBlocker | null {
    const conflict = this.conflictMap().get(key);
    if (conflict === undefined || conflict.current !== null) return null;
    if (conflict.cut === undefined && this.requireHost().projection() !== undefined) {
      return 'projection';
    }
    return conflict.cut !== undefined || this.isPartial(key) ? 'partial' : null;
  }

  /** Refuses (with a message) when `resolveBlocker` says Overwrite and Merge can't run. */
  private refuseResolve(key: string): boolean {
    const blocker = this.resolveBlocker(key);
    if (blocker === null) return false;
    this.messageState.set({
      kind: 'error',
      text:
        blocker === 'projection'
          ? PROJECTION_RESOLVE_REFUSED
          : blocker === 'partial'
            ? PARTIAL_RESOLVE_REFUSED
            : SERVER_UNKNOWN_REFUSED,
    });
    return true;
  }

  /**
   * Writes `local` over the server's current version of a conflicting document. The edit session
   * is changed only once the write succeeded (`saved`); a cancel, refusal or failure leaves it
   * as it was.
   */
  private async resolveWith(key: string, local: BsonDocument, saved: () => void): Promise<boolean> {
    const conflict = this.conflictMap().get(key);
    const entry = this.edits.get(key);
    if (conflict === undefined || this.isBusy(key)) return false;
    const host = this.requireHost();
    const partial = this.isPartial(key);
    if (conflict.current === null) {
      const blocker = this.reinsertBlocker(key);
      if (blocker !== null) {
        this.messageState.set({
          kind: 'error',
          text: blocker === 'projection' ? PROJECTION_REINSERT_REFUSED : PARTIAL_REINSERT_REFUSED,
        });
        return false;
      }
      const params = { profileId: host.profileId, db: host.db, coll: host.coll };
      return this.write('Not inserted', key, async () => {
        await this.guard.run('docs.insert', { ...params, docs: [stringifyEJson(local)] });
        this.edits.discard(key);
        this.dropConflict(key);
        this.messageState.set({ kind: 'info', text: 'Inserted your version again.' });
        await this.readBack(key, key, local);
      });
    }
    const server = conflict.current;
    // refuseResolve also refuses an unknown server version (`undefined`).
    if (this.refuseResolve(key) || server === undefined) return false;
    // A projection of whole top-level fields (see resolveBlocker): only the fields the user saw are
    // compared, so hidden ones stay as they are.
    const base = partial
      ? visibleFields(server, entry === undefined ? [local] : [entry.original, local])
      : server;
    if (bsonEquals(base, local)) {
      // Nothing left to write: the server already has this version.
      await this.keepServer(key);
      return true;
    }
    const hidesSubFields = entry?.hidesSubFields ?? false;
    return this.send(
      key,
      base,
      local,
      partial,
      () => {
        saved();
        this.recordSave(key, base, local, partial, hidesSubFields);
      },
      hidesSubFields ? entry?.original : undefined,
    );
  }

  /**
   * Saves `current` as the minimal diff from `original`, with `original`'s values as the conflict
   * check (`docs.update`, or `docs.replace` when the diff needs it), then reads it back and calls
   * `saved`. Nothing in the edit session changes before the write succeeded. `loaded`: the
   * document as the user loaded it under a projection that may hide parts of fields (nothing it
   * lacks is unset); under a top-level-only projection whole fields were loaded, so sub-fields
   * only the server has within them are unset like any other difference.
   */
  private async send(
    key: string,
    original: BsonDocument,
    current: BsonDocument,
    partial: boolean,
    saved: () => void,
    loaded?: BsonDocument,
    options: SendOptions = SAVE_OPTIONS,
  ): Promise<boolean> {
    const host = this.requireHost();
    const pending = pendingSave({ original, current });
    if (!pending.ok) {
      this.messageState.set({ kind: 'error', text: `${options.refused}: ${pending.error}` });
      return false;
    }
    const id = idOf(original);
    if (id === null) return false;
    const base = {
      profileId: host.profileId,
      db: host.db,
      coll: host.coll,
      id: stringifyEJson(id),
    };
    const diff = options.keepOrder && !partial ? keepingOrder(pending.diff, original, current) : pending.diff;
    if (
      partial &&
      (overwritesHiddenData(diff, original) ||
        (loaded !== undefined && unsetsUnloaded(diff, loaded)))
    ) {
      const text = host.projection() !== undefined ? PROJECTION_REFUSED : PARTIAL_REFUSED;
      this.messageState.set({
        kind: 'error',
        text: `${options.refused}: ${text}`,
      });
      return false;
    }
    const write = async () => {
      if (diff.kind === 'update') {
        await this.guard.run('docs.update', {
          ...base,
          update: stringifyEJson(diff.update),
          expected: stringifyEJson(diff.expected),
        });
      } else {
        await this.guard.run('docs.replace', {
          ...base,
          doc: stringifyEJson(diff.replacement),
          expected: stringifyEJson(diff.expected),
        });
      }
      this.dropConflict(key);
      this.messageState.set({ kind: 'info', text: options.done(id) });
      await this.readBack(key, base.id, current);
      saved();
    };
    return this.write(options.failure, key, write, options.onConflict);
  }

  /** Deletes the loaded document `doc` after the confirm dialog; its unsaved edits go too. */
  async delete(doc: BsonDocument): Promise<boolean> {
    const host = this.requireHost();
    const key = documentKey(doc);
    const id = idOf(doc);
    if (key === null || id === null || this.isBusy(key)) return false;
    const params = { profileId: host.profileId, db: host.db, coll: host.coll, id: key };
    return this.write('Not deleted', key, async () => {
      const { deleted } = await this.guard.run('docs.delete', params, {
        alwaysConfirm: true,
        confirmLabel: 'Delete',
        detail: 'The document is deleted on the server. This cannot be undone.',
      });
      this.edits.discard(key);
      this.dropConflict(key);
      this.saveHistory.drop(key);
      this.messageState.set({
        kind: 'info',
        text: deleted ? `Deleted ${label(id)}.` : `${label(id)} was already deleted.`,
      });
      host.documentChanged(key, null);
    });
  }

  /** Adds an empty draft (a new ObjectId `_id`) and returns it. */
  newDocument(): DraftDocument {
    return this.addDraft({ type: 'object', fields: [newIdField()] }, 'New document');
  }

  /** Adds a draft copied from `doc` (as shown, with its edits) with a new ObjectId `_id`. */
  cloneDocument(doc: BsonDocument): DraftDocument {
    const id = idOf(doc);
    const fields: BsonField[] = [newIdField(), ...doc.fields.filter((f) => f.key !== '_id')];
    return this.addDraft({ type: 'object', fields }, id === null ? 'Copy' : `Copy of ${label(id)}`);
  }

  /** Replaces a draft's document (edited in the form). */
  editDraft(id: number, doc: BsonDocument): void {
    this.draftList.update((list) => list.map((d) => (d.id === id ? { ...d, doc } : d)));
  }

  discardDraft(id: number): void {
    this.draftList.update((list) => list.filter((d) => d.id !== id));
  }

  /** Inserts a draft (`docs.insert`); it leaves the drafts once inserted. */
  async insertDraft(id: number): Promise<boolean> {
    const host = this.requireHost();
    const draft = this.draftList().find((d) => d.id === id);
    if (draft === undefined) return false;
    const busyKey = `draft:${id}`;
    if (this.isBusy(busyKey)) return false;
    return this.write('Not inserted', busyKey, async () => {
      const { insertedIds } = await this.guard.run('docs.insert', {
        profileId: host.profileId,
        db: host.db,
        coll: host.coll,
        docs: [stringifyEJson(draft.doc)],
      });
      this.discardDraft(id);
      const inserted = insertedIds[0];
      this.messageState.set({
        kind: 'info',
        text: `Inserted ${inserted === undefined ? 'the document' : labelText(inserted)}. Run the query again to see it in the results.`,
      });
    });
  }

  /**
   * Runs a write for `key`; failures become the message, starting with `failure` ("Not saved"), and
   * a cancelled dialog says nothing. `onConflict` replaces the conflict handling (a conflict entry
   * for the conflict view) when the server refused the write because the document changed.
   */
  private async write(
    failure: string,
    key: string,
    body: () => Promise<void>,
    onConflict?: () => void,
  ): Promise<boolean> {
    this.busyKeys.update((set) => new Set(set).add(key));
    try {
      await body();
      return true;
    } catch (error) {
      if (onConflict !== undefined && ApiError.from(error).code === 'CONFLICT') onConflict();
      else await this.failed(failure, key, error);
      return false;
    } finally {
      this.busyKeys.update((set) => {
        const next = new Set(set);
        next.delete(key);
        return next;
      });
    }
  }

  private async failed(failure: string, key: string, error: unknown): Promise<void> {
    const apiError = ApiError.from(error);
    if (apiError.code === 'CANCELLED') {
      this.messageState.set(null);
      return;
    }
    if (apiError.code === 'CONFLICT') {
      const detail = conflictDetail.safeParse(apiError.detail);
      const cut = this.requireHost().slicedOf?.(key)?.arrays;
      let current: BsonDocument | null | undefined;
      if (detail.success) current = parseServerDoc(detail.data);
      // No readable server version in the conflict: read it again (a missing one is no deletion).
      if (current === undefined) current = await this.serverVersion(key);
      this.conflictMap.update((map) =>
        new Map(map).set(key, cut === undefined ? { key, current } : { key, current, cut }),
      );
      this.messageState.set({
        kind: 'error',
        text:
          current === null
            ? 'Not saved: the document was deleted on the server since it was loaded.'
            : 'Not saved: the document was changed on the server since it was loaded. Your edits are kept.',
      });
      return;
    }
    this.messageState.set({ kind: 'error', text: `${failure}: ${describeError(apiError)}` });
  }

  /**
   * The server's current version of the document under `key`, read without the projection:
   * `null` when it is deleted, `undefined` when it could not be read.
   */
  private async serverVersion(key: string): Promise<BsonDocument | null | undefined> {
    const host = this.requireHost();
    try {
      const { doc } = await this.api.request('docs.get', {
        profileId: host.profileId,
        db: host.db,
        coll: host.coll,
        id: key,
      });
      return doc === null ? null : parseEJsonDocument(doc);
    } catch (error) {
      return ApiError.from(error).code === 'NOT_FOUND' ? null : undefined;
    }
  }

  /**
   * Reads a saved document back, so the page shows the server's version (MongoDB puts new fields
   * last, for example). When it can't be read, the page shows `saved` (or stays as it is without):
   * with the cut flags of the loaded document, unless `savedWhole` says `saved` is complete.
   */
  private async readBack(
    key: string,
    id: string,
    saved: BsonDocument | undefined,
    savedWhole = false,
  ): Promise<void> {
    const host = this.requireHost();
    const projection = host.projection();
    // A large document is read back with its long arrays cut again, not sent whole.
    const cut = host.slicedOf?.(key);
    try {
      const { doc, sliced } = await this.api.request('docs.get', {
        profileId: host.profileId,
        db: host.db,
        coll: host.coll,
        id,
        ...(projection === undefined ? {} : { projection }),
        ...(cut === undefined ? {} : { sliceAbove: cut.above }),
      });
      host.documentChanged(key, doc, sliced.length > 0 ? sliced : undefined);
    } catch {
      // Not readable now: show what was saved (its cut arrays are still only partly there).
      if (saved !== undefined) {
        host.documentChanged(key, stringifyEJson(saved), savedWhole ? undefined : cut?.arrays);
      }
    }
  }

  private dropConflict(key: string): void {
    this.conflictMap.update((map) => {
      if (!map.has(key)) return map;
      const next = new Map(map);
      next.delete(key);
      return next;
    });
  }

  private addDraft(doc: BsonDocument, title: string): DraftDocument {
    const draft: DraftDocument = { id: ++nextDraftId, doc, title };
    this.draftList.update((list) => [draft, ...list]);
    this.messageState.set(null);
    return draft;
  }

  private requireHost(): DocumentHost {
    if (this.host === null) throw new Error('DocumentActions: setHost() was not called');
    return this.host;
  }
}

/** How `send` writes and words its messages: a save, or an undo of the last save. */
interface SendOptions {
  /** Starts the message of a failed write ("Not saved"). */
  readonly failure: string;
  /** Starts the message of a write refused before sending. */
  readonly refused: string;
  /** The message once written. */
  readonly done: (id: BsonValue) => string;
  /** Handles a conflict instead of the conflict view (see `write`). */
  readonly onConflict?: () => void;
  /**
   * The server must end up with `current` in its field order (an undo restores a version): when
   * the update would leave fields in another order (MongoDB appends a field it adds), the whole
   * document is replaced instead, with the same conflict check. Never for a partial document.
   */
  readonly keepOrder?: boolean;
}

/**
 * `diff` as a replace of the whole document `current` when applying its update to `original`
 * would not give `current` with its field order; otherwise `diff` as it is.
 */
function keepingOrder(
  diff: Exclude<DocumentDiff, { readonly kind: 'none' }>,
  original: BsonDocument,
  current: BsonDocument,
): Exclude<DocumentDiff, { readonly kind: 'none' }> {
  if (diff.kind !== 'update' || bsonEquals(applyUpdate(original, diff.ops), current)) return diff;
  const { expected, filter, changedFields } = diff;
  return { kind: 'replace', replacement: current, expected, filter, changedFields };
}

const SAVE_OPTIONS: SendOptions = {
  failure: 'Not saved',
  refused: 'Not saved',
  done: (id) => `Saved ${label(id)}.`,
};

const UNDO_WITH_EDITS_REFUSED =
  'Not undone: this document has unsaved edits. Save or revert them first.';

const UNDO_CONFLICT =
  'Not undone: the document was changed on the server since the save. Nothing was overwritten; ' +
  'run the query again to see the current version.';

const PROJECTION_REFUSED =
  'with a projection active, this edit would replace data the projection hides. ' +
  'Clear the projection and edit again.';

/** The same refusal for a document loaded only partly without a projection active now. */
const PARTIAL_REFUSED =
  'this document was loaded only partly (with a projection, or a large document whose ' +
  'long arrays are read page by page), and this edit would replace data that was not loaded. ' +
  'Edit single values instead, or run the query without a projection and edit again.';

const PROJECTION_RESOLVE_REFUSED =
  'Not saved: the document was loaded with a projection that hides parts of fields or is no ' +
  'longer active, so this could change data you did not load. Clear the projection, run the ' +
  'query again and edit again.';

const SERVER_UNKNOWN_REFUSED =
  "Not saved: the server's current version of the document could not be read. Keep the server " +
  'version, then edit again.';

/** The same refusal for a document loaded only partly without a projection active now. */
const PARTIAL_RESOLVE_REFUSED =
  'Not saved: this document was loaded only partly (with a projection, or a large document whose ' +
  'long arrays are read page by page), so this could change data that was not loaded. Keep the ' +
  'server version, then edit single values again.';

const PROJECTION_REINSERT_REFUSED =
  'Not inserted: with a projection active only part of the document is loaded. ' +
  'Clear the projection and edit again.';

/** The same refusal for a document loaded only partly without a projection active now. */
const PARTIAL_REINSERT_REFUSED =
  'Not inserted: this document was loaded only partly (with a projection, or a large document ' +
  'whose long arrays are read page by page), so inserting it would lose the data that was not ' +
  'loaded. Keep it deleted.';

/** `doc` with only the top-level fields that one of `shown` has (keeps `doc`'s field order). */
export function visibleFields(doc: BsonDocument, shown: readonly BsonDocument[]): BsonDocument {
  const keys = new Set(shown.flatMap((d) => d.fields.map((f) => f.key)));
  return { type: 'object', fields: doc.fields.filter((f) => keys.has(f.key)) };
}

/**
 * With a query projection the loaded document may be partial, so a save must not replace what
 * the projection hides: a whole-document replace, or a `$set` of a document or array at a path
 * the loaded document has (its loaded value may be partial). Scalar `$set`, `$unset`, `$push`
 * and new documents or arrays at new paths only touch what the user saw.
 */
function overwritesHiddenData(diff: DocumentDiff, original: BsonDocument): boolean {
  if (diff.kind === 'none') return false;
  if (diff.kind === 'replace') return true;
  return diff.ops.some(
    (op) =>
      op.op === 'set' &&
      (op.value.type === 'object' || op.value.type === 'array') &&
      hasPath(original, op.path),
  );
}

/**
 * Whether `diff` unsets a path that `loaded` (the document as the user loaded it) does not have:
 * the user never saw that (sub-)field, so a partial document must not remove it.
 */
function unsetsUnloaded(diff: DocumentDiff, loaded: BsonDocument): boolean {
  return (
    diff.kind === 'update' && diff.ops.some((op) => op.op === 'unset' && !hasPath(loaded, op.path))
  );
}

/** Whether the dotted `path` (document keys only, as the diff builds them) exists in `doc`. */
function hasPath(doc: BsonDocument, path: string): boolean {
  let value: BsonValue = doc;
  for (const key of path.split('.')) {
    if (value.type !== 'object') return false;
    const field: BsonField | undefined = value.fields.find((f) => f.key === key);
    if (field === undefined) return false;
    value = field.value;
  }
  return true;
}

function newIdField(): BsonField {
  return { key: '_id', value: generateObjectId() };
}

/** The conflict's server version: `null` when deleted, `undefined` when it is not readable. */
function parseServerDoc(detail: ConflictDetail): BsonDocument | null | undefined {
  try {
    return detail.current === null ? null : parseEJsonDocument(detail.current);
  } catch {
    return undefined;
  }
}

/**
 * Whether `projection` (canonical EJSON) only includes or excludes whole top-level fields: no
 * dotted path, no operator (`$slice`, `$elemMatch`, `$meta`, expressions), every value 0/1 or a
 * boolean. Such a projection loads each field it keeps in full.
 */
export function isTopLevelProjection(projection: string): boolean {
  let doc: BsonDocument;
  try {
    doc = parseEJsonDocument(projection);
  } catch {
    return false;
  }
  return doc.fields.every(
    ({ key, value }) => !key.includes('.') && !key.startsWith('$') && isProjectionFlag(value),
  );
}

function isProjectionFlag(value: BsonValue): boolean {
  switch (value.type) {
    case 'bool':
      return true;
    case 'int':
    case 'double':
      return value.value === 0 || value.value === 1;
    case 'long':
      return value.value === 0n || value.value === 1n;
    default:
      return false;
  }
}

/** `_id` in shell syntax, for messages ("Saved ObjectId("…")."). */
function label(id: BsonValue): string {
  return printShellSyntax(id);
}

function labelText(ejson: string): string {
  try {
    return printShellSyntax(parseEJson(ejson));
  } catch {
    return ejson;
  }
}
