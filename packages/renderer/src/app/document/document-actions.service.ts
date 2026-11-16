import { computed, inject, Injectable, signal } from '@angular/core';
import { type ConflictDetail, conflictDetail } from '@thicket/contract';
import {
  type BsonDocument,
  type BsonField,
  type BsonValue,
  parseEJson,
  parseEJsonDocument,
  stringifyEJson,
} from '@thicket/core/bson';
import type { DocumentDiff } from '@thicket/core/diff';
import { printShellSyntax } from '@thicket/core/shellsyntax';

import { ApiError, ApiService, describeError } from '../api';
import { generateObjectId } from '../explorer/bson-input.util';
import { WriteGuard } from '../safety/write-guard.service';
import { DocumentEdits, documentKey, idOf } from './edit-session';

/** The collection the documents belong to, and how the view shows them. */
export interface DocumentHost {
  readonly profileId: string;
  readonly db: string;
  readonly coll: string;
  /** The query's projection (canonical EJSON), used to read a saved document back. */
  projection(): string | undefined;
  /**
   * A document changed on the server: `doc` is its new version as canonical EJSON (`null` when
   * deleted, or when it could not be read back). The view updates the shown page.
   */
  documentChanged(key: string, doc: string | null): void;
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
  /** The server version at the time of the save (`null`: deleted). */
  readonly current: BsonDocument | null;
}

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
    const host = this.requireHost();
    const entry = this.edits.get(key);
    const pending = this.edits.pending().get(key);
    if (entry === undefined || pending === undefined || this.isBusy(key)) return false;
    if (!pending.ok) {
      this.messageState.set({ kind: 'error', text: `Not saved: ${pending.error}` });
      return false;
    }
    const id = idOf(entry.original);
    if (id === null) return false;
    const base = {
      profileId: host.profileId,
      db: host.db,
      coll: host.coll,
      id: stringifyEJson(id),
    };
    const diff = pending.diff;
    if (host.projection() !== undefined && overwritesHiddenData(diff, entry.original)) {
      this.messageState.set({ kind: 'error', text: PROJECTION_REFUSED });
      return false;
    }
    const sent = entry.current;
    return this.write('Not saved', key, async () => {
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
      this.messageState.set({ kind: 'info', text: `Saved ${label(id)}.` });
      await this.readBack(key, base.id, sent);
      // What was sent is the new baseline; edits made since then stay unsaved.
      this.edits.rebase(key, sent);
    });
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
   * a cancelled dialog says nothing.
   */
  private async write(failure: string, key: string, body: () => Promise<void>): Promise<boolean> {
    this.busyKeys.update((set) => new Set(set).add(key));
    try {
      await body();
      return true;
    } catch (error) {
      this.failed(failure, key, error);
      return false;
    } finally {
      this.busyKeys.update((set) => {
        const next = new Set(set);
        next.delete(key);
        return next;
      });
    }
  }

  private failed(failure: string, key: string, error: unknown): void {
    const apiError = ApiError.from(error);
    if (apiError.code === 'CANCELLED') {
      this.messageState.set(null);
      return;
    }
    if (apiError.code === 'CONFLICT') {
      const detail = conflictDetail.safeParse(apiError.detail);
      let current: BsonDocument | null = null;
      if (detail.success && detail.data.current !== null) current = parseServerDoc(detail.data);
      this.conflictMap.update((map) => new Map(map).set(key, { key, current }));
      this.messageState.set({
        kind: 'error',
        text:
          detail.success && detail.data.current === null
            ? 'Not saved: the document was deleted on the server since it was loaded.'
            : 'Not saved: the document was changed on the server since it was loaded. Your edits are kept.',
      });
      return;
    }
    this.messageState.set({ kind: 'error', text: `${failure}: ${describeError(apiError)}` });
  }

  /**
   * Reads a saved document back, so the page shows the server's version (MongoDB puts new fields
   * last, for example).
   */
  private async readBack(key: string, id: string, saved: BsonDocument): Promise<void> {
    const host = this.requireHost();
    const projection = host.projection();
    try {
      const { doc } = await this.api.request('docs.get', {
        profileId: host.profileId,
        db: host.db,
        coll: host.coll,
        id,
        ...(projection === undefined ? {} : { projection }),
      });
      host.documentChanged(key, doc);
    } catch {
      // Not readable now: show what was saved.
      host.documentChanged(key, stringifyEJson(saved));
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

const PROJECTION_REFUSED =
  'Not saved: with a projection active, this edit would replace data the projection hides. ' +
  'Clear the projection and edit again.';

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

function parseServerDoc(detail: ConflictDetail): BsonDocument | null {
  try {
    return detail.current === null ? null : parseEJsonDocument(detail.current);
  } catch {
    return null;
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
