import { inject, Injectable, signal } from '@angular/core';
import { conflictDetail } from '@thicket/contract';
import { type BsonDocument, type BsonValue, stringifyEJson } from '@thicket/core/bson';
import { printShellSyntax } from '@thicket/core/shellsyntax';

import { ApiError, ApiService, describeError } from '../../api';
import { type DocumentHost, DocumentEdits, documentKey, idOf } from '../../document';
import { formatCount, WriteGuard } from '../../safety/write-guard.service';
import { type FieldEdit, planFieldEdit } from './multi-edit.util';

/** A selected document as loaded (not with unsaved edits). */
export interface SelectedDocument {
  readonly doc: BsonDocument;
  /** Loaded with a projection or with cut arrays (see `CollectionView.isPartial`). */
  readonly partial: boolean;
}

/** A document the batch did not save, and why. */
export interface MultiEditProblem {
  /** `_id` in shell syntax. */
  readonly label: string;
  readonly reason: string;
  /** A conflict: the document was deleted on the server (and left the page). */
  readonly deleted?: true;
}

/** What a batch save did. */
export interface MultiEditResult {
  /** Documents updated. */
  readonly saved: number;
  /** Documents that already had the value (nothing sent). */
  readonly unchanged: number;
  /** Documents changed (or deleted) on the server since they were loaded: not saved. */
  readonly conflicts: readonly MultiEditProblem[];
  /** Documents whose update failed for another reason. */
  readonly failed: readonly MultiEditProblem[];
}

interface Planned {
  readonly key: string;
  readonly label: string;
  readonly params: {
    profileId: string;
    db: string;
    coll: string;
    id: string;
    update: string;
    expected: string;
  };
}

/**
 * Edit one field across selected rows (SPEC.md M1 "Should": "Edit several documents in the table
 * view (same field across selected rows) and save them together; the confirm dialog lists the
 * number of documents"). Each document gets its own `docs.update` with the minimal diff and the
 * same conflict filter as a single Save (`_id` plus the original value of the changed top-level
 * field), all approved by one `WriteGuard` confirm dialog that shows the document count. A
 * conflict on one document doesn't stop the others; conflicting documents are reloaded so the
 * table shows the server version. Provided per collection view.
 */
@Injectable()
export class MultiEdit {
  private readonly api = inject(ApiService);
  private readonly guard = inject(WriteGuard);
  private readonly edits = inject(DocumentEdits);

  private host: DocumentHost | null = null;
  private readonly busyState = signal(false);
  /** A batch is being confirmed or sent. */
  readonly busy = this.busyState.asReadonly();
  private readonly resultState = signal<MultiEditResult | null>(null);
  /**
   * What the last batch did, until `clearResult`. Kept here, not in the panel, so the report
   * outlives the rows it was about (a document deleted on the server leaves the page).
   */
  readonly result = this.resultState.asReadonly();

  setHost(host: DocumentHost): void {
    this.host = host;
  }

  clearResult(): void {
    this.resultState.set(null);
  }

  /**
   * Applies `edit` to every selected document and saves them together. Rejects with an `Error`
   * whose message is for the user when nothing can be sent (unsaved edits, a nested path or a
   * field that isn't loaded whole in a partly loaded document, no document to change), with
   * `CANCELLED` when the dialog was cancelled and `READ_ONLY` on read-only profiles. The result
   * is also kept in `result`.
   */
  async save(selected: readonly SelectedDocument[], edit: FieldEdit): Promise<MultiEditResult> {
    const host = this.requireHost();
    if (this.busyState()) throw new Error('A save of the selected documents is already running.');
    this.resultState.set(null);
    const result = await this.run(host, selected, edit);
    this.resultState.set(result);
    return result;
  }

  private async run(
    host: DocumentHost,
    selected: readonly SelectedDocument[],
    edit: FieldEdit,
  ): Promise<MultiEditResult> {
    const top = edit.path.split('.')[0] as string;
    const planned: Planned[] = [];
    let unchanged = 0;
    const invalid: MultiEditProblem[] = [];
    for (const { doc, partial } of selected) {
      const key = documentKey(doc);
      const id = idOf(doc);
      if (key === null || id === null) {
        invalid.push({ label: '(no _id)', reason: 'a document without _id can’t be updated' });
        continue;
      }
      const label = labelOf(id);
      if (this.edits.get(key) !== undefined) {
        throw new Error(
          `${label} has unsaved edits: save or revert them before editing the selected rows.`,
        );
      }
      if (partial && edit.path.includes('.')) {
        throw new Error(
          `${label} was loaded only partly (projection or a large document): ` +
            'only top-level fields can be changed across rows.',
        );
      }
      if (partial) {
        const refused = partialRefusal(host, key, doc, top);
        if (refused !== null) throw new Error(`${label} was loaded only partly: ${refused}`);
      }
      const plan = planFieldEdit(doc, edit);
      if (plan.kind === 'unchanged') unchanged++;
      else if (plan.kind === 'invalid') invalid.push({ label, reason: plan.reason });
      else {
        planned.push({
          key,
          label,
          params: {
            profileId: host.profileId,
            db: host.db,
            coll: host.coll,
            id: key,
            update: stringifyEJson(plan.update),
            expected: stringifyEJson(plan.expected),
          },
        });
      }
    }
    if (invalid.length > 0) {
      const first = invalid[0] as MultiEditProblem;
      const more = invalid.length > 1 ? ` (and ${invalid.length - 1} more)` : '';
      throw new Error(`Not saved: ${first.label}: ${first.reason}${more}.`);
    }
    if (planned.length === 0) return { saved: 0, unchanged, conflicts: [], failed: [] };

    this.busyState.set(true);
    try {
      const n = planned.length;
      const docs = `${formatCount(n)} ${n === 1 ? 'document' : 'documents'}`;
      const approved = await this.guard.approveAll(
        'docs.update',
        planned.map((p) => p.params),
        {
          alwaysConfirm: true,
          title: `Update ${docs}`,
          confirmLabel: `Save ${docs}`,
          detail:
            `Updates ${docs}, one updateOne each` +
            (unchanged > 0 ? ` (${formatCount(unchanged)} already have this value).` : '.'),
        },
      );
      let saved = 0;
      const conflicts: MultiEditProblem[] = [];
      const failed: MultiEditProblem[] = [];
      // Sent one after the other, without a cancel signal: once confirmed, every document is tried.
      for (const [i, p] of planned.entries()) {
        try {
          await this.api.request('docs.update', approved[i] as (typeof approved)[number]);
          saved++;
          await this.readBack(p.key);
        } catch (error) {
          const e = ApiError.from(error);
          if (e.code === 'CONFLICT') {
            const detail = conflictDetail.safeParse(e.detail);
            const deleted = detail.success && detail.data.current === null;
            conflicts.push(
              deleted
                ? { label: p.label, reason: 'deleted on the server since it was loaded', deleted }
                : { label: p.label, reason: 'changed on the server since it was loaded' },
            );
            if (deleted) host.documentChanged(p.key, null);
            else await this.readBack(p.key);
          } else {
            failed.push({ label: p.label, reason: describeError(e) });
          }
        }
      }
      return { saved, unchanged, conflicts, failed };
    } finally {
      this.busyState.set(false);
    }
  }

  /** Shows the server version of a document in the page (as `DocumentActions` reads it back). */
  private async readBack(key: string): Promise<void> {
    const host = this.requireHost();
    const projection = host.projection();
    const cut = host.slicedOf?.(key);
    try {
      const { doc, sliced } = await this.api.request('docs.get', {
        profileId: host.profileId,
        db: host.db,
        coll: host.coll,
        id: key,
        ...(projection === undefined ? {} : { projection }),
        ...(cut === undefined ? {} : { sliceAbove: cut.above }),
      });
      host.documentChanged(key, doc, sliced.length > 0 ? sliced : undefined);
    } catch {
      // Not readable now: the page keeps the loaded version until the query runs again.
    }
  }

  private requireHost(): DocumentHost {
    if (this.host === null) throw new Error('MultiEdit: setHost() was not called');
    return this.host;
  }
}

function labelOf(id: BsonValue): string {
  return printShellSyntax(id);
}

/**
 * Why top-level field `top` of the partly loaded document `doc` can't be changed across rows, or
 * `null`. Under a projection a field missing from the loaded document may only be hidden (remove
 * would claim success without sending anything, set would always conflict); a cut array would
 * always conflict too. Without a projection only arrays are cut, so a missing field is missing.
 */
function partialRefusal(
  host: DocumentHost,
  key: string,
  doc: BsonDocument,
  top: string,
): string | null {
  if (host.projection() !== undefined && !doc.fields.some((f) => f.key === top)) {
    return `${top} isn’t loaded, clear the projection to change it across rows.`;
  }
  const cut = host.slicedOf?.(key)?.arrays ?? [];
  if (cut.some((a) => a.path === top || a.path.startsWith(`${top}.`))) {
    return `${top} was loaded cut (a long array), open the document to change it.`;
  }
  return null;
}
