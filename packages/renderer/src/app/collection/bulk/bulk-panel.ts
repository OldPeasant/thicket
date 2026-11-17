import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import { ApiError, ApiService, describeError } from '../../api';
import { shell } from '../../safety/operation';
import { WriteGuard, formatCount } from '../../safety/write-guard.service';
import {
  type BulkMode,
  type BulkQuery,
  type BulkTarget,
  describeBulk,
  needsTypedName,
  parseUpdate,
} from './bulk.util';

/** Documents of the preview's sample. */
export const BULK_SAMPLE_SIZE = 5;

/** Where the panel is. */
export type BulkPhase = 'idle' | 'previewing' | 'running';

/** A preview: what it was taken for (`key`), the matched count and a sample in shell syntax. */
interface BulkPreview {
  key: string;
  mode: BulkMode;
  matched: number;
  sample: string[];
}

/** What the last bulk write reported. */
export type BulkOutcome =
  | { mode: 'update'; matched: number; modified: number }
  | { mode: 'delete'; deleted: number };

let nextUid = 0;

/**
 * Bulk update and delete of the documents matching the collection tab's applied filter (and
 * collation). Preview (`docs.previewMany`) shows the matched count and a sample; only then can the
 * write be sent, through `WriteGuard` (confirm dialog with the exact operation; over 1 000
 * documents the collection name must be typed) with the preview's count as `expectedCount`, so
 * the backend refuses when more documents match by then. Changing the mode, the update, or the
 * applied query makes the preview stale: it must be taken again.
 */
@Component({
  selector: 'app-bulk-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './bulk-panel.html',
  styleUrls: ['../../io/io-panel.css', './bulk-panel.css'],
})
export class BulkPanel {
  readonly target = input.required<BulkTarget>();
  /** The query applied in the tab (what the results show). */
  readonly query = input.required<BulkQuery>();
  readonly closed = output();
  /** Documents were updated or deleted: the tab reads its page again. */
  readonly changed = output<BulkOutcome>();

  private readonly api = inject(ApiService);
  private readonly guard = inject(WriteGuard);

  protected readonly uid = `bulk-${++nextUid}`;
  protected readonly mode = signal<BulkMode>('update');
  protected readonly updateText = signal('');
  protected readonly phase = signal<BulkPhase>('idle');
  protected readonly preview = signal<BulkPreview | null>(null);
  protected readonly outcome = signal<BulkOutcome | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly parsedUpdate = computed(() => parseUpdate(this.updateText()));
  /** The update's error, shown once something was typed (or Preview was pressed). */
  protected readonly updateError = computed(() => {
    const parsed = this.parsedUpdate();
    return this.mode() === 'update' && !parsed.ok && this.showUpdateError() ? parsed.error : null;
  });
  private readonly showUpdateError = signal(false);

  /** The canonical update to send (`null`: delete mode, or not valid). */
  private readonly update = computed(() => {
    const parsed = this.parsedUpdate();
    return this.mode() === 'update' && parsed.ok ? parsed.update : null;
  });
  /** What a preview is valid for: mode, namespace, filter, collation and update. */
  private readonly key = computed(() =>
    JSON.stringify([this.mode(), this.target(), this.query(), this.update()]),
  );
  protected readonly command = computed(() =>
    describeBulk(this.target().coll, this.mode(), this.query(), this.update()),
  );
  /** The preview, if it is still the one of the current settings. */
  protected readonly current = computed(() => {
    const preview = this.preview();
    return preview !== null && preview.key === this.key() ? preview : null;
  });
  protected readonly stale = computed(() => this.preview() !== null && this.current() === null);
  protected readonly busy = computed(() => this.phase() !== 'idle');
  protected readonly canPreview = computed(
    () => !this.busy() && (this.mode() === 'delete' || this.parsedUpdate().ok),
  );
  protected readonly canExecute = computed(() => {
    const current = this.current();
    return !this.busy() && current !== null && current.matched > 0;
  });
  protected readonly matchedText = computed(() => {
    const current = this.current() ?? this.preview();
    return current === null ? '' : formatCount(current.matched);
  });
  protected readonly typedName = computed(() => {
    const current = this.current();
    return current !== null && needsTypedName(current.matched);
  });
  protected readonly executeLabel = computed(() => {
    const current = this.current();
    const verb = this.mode() === 'update' ? 'Update' : 'Delete';
    if (current === null) return `${verb} documents…`;
    const n = current.matched;
    return `${verb} ${formatCount(n)} ${n === 1 ? 'document' : 'documents'}…`;
  });

  private controller: AbortController | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.controller?.abort());
  }

  protected setMode(mode: BulkMode): void {
    if (this.busy()) return;
    this.mode.set(mode);
    this.error.set(null);
  }

  protected editUpdate(event: Event): void {
    this.updateText.set((event.target as HTMLTextAreaElement).value);
    this.showUpdateError.set(true);
  }

  /** Counts the matching documents and reads a sample (`docs.previewMany`). */
  async runPreview(): Promise<void> {
    this.showUpdateError.set(true);
    if (!this.canPreview()) return;
    const key = this.key();
    const mode = this.mode();
    const { filter, collation } = this.query();
    const controller = this.begin('previewing');
    try {
      const result = await this.api.request(
        'docs.previewMany',
        {
          ...this.target(),
          filter,
          ...(collation !== undefined ? { collation } : {}),
          sampleSize: BULK_SAMPLE_SIZE,
        },
        { signal: controller.signal },
      );
      this.preview.set({
        key,
        mode,
        matched: result.matched,
        sample: result.sample.map((doc) => shell(doc, 0)),
      });
    } catch (error) {
      if (!controller.signal.aborted) this.fail(error);
    } finally {
      this.end(controller);
    }
  }

  /**
   * Sends the write of the current preview through `WriteGuard`. Over 1 000 documents the confirm
   * dialog asks for the collection name, for updates as for deletes.
   */
  async execute(): Promise<void> {
    const preview = this.current();
    if (!this.canExecute() || preview === null) return;
    const target = this.target();
    const { filter, collation } = this.query();
    const expected = preview.matched;
    const options = {
      count: expected,
      confirmLabel: this.executeLabel().replace(/…$/, ''),
      ...(needsTypedName(expected) ? { typeToConfirm: target.coll } : {}),
    };
    const base = { ...target, filter, ...(collation !== undefined ? { collation } : {}) };
    const controller = this.begin('running');
    try {
      let outcome: BulkOutcome;
      if (preview.mode === 'update') {
        const update = this.update();
        if (update === null) return;
        const result = await this.guard.run(
          'docs.updateMany',
          { ...base, update, expectedCount: expected },
          { ...options, signal: controller.signal },
        );
        outcome = { mode: 'update', matched: result.matched, modified: result.modified };
      } else {
        const result = await this.guard.run(
          'docs.deleteMany',
          { ...base, expectedCount: expected },
          { ...options, signal: controller.signal },
        );
        outcome = { mode: 'delete', deleted: result.deleted };
      }
      this.preview.set(null);
      this.outcome.set(outcome);
      this.changed.emit(outcome);
    } catch (error) {
      const apiError = ApiError.from(error);
      if (apiError.code === 'CANCELLED') return;
      if (apiError.code === 'CONFLICT') {
        this.preview.set(null);
        this.error.set(
          `More documents match now than the ${formatCount(expected)} the preview showed. ` +
            'Nothing was changed: preview again.',
        );
        return;
      }
      this.fail(error);
    } finally {
      this.end(controller);
    }
  }

  /** Stops a running preview (a write in the confirm dialog is cancelled there). */
  protected cancel(): void {
    this.controller?.abort();
  }

  protected close(): void {
    this.controller?.abort();
    this.closed.emit();
  }

  protected outcomeText(outcome: BulkOutcome): string {
    if (outcome.mode === 'delete') {
      return `Deleted ${formatCount(outcome.deleted)} ${plural(outcome.deleted)}.`;
    }
    return (
      `Updated ${formatCount(outcome.modified)} ${plural(outcome.modified)} ` +
      `(${formatCount(outcome.matched)} matched).`
    );
  }

  private begin(phase: BulkPhase): AbortController {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.phase.set(phase);
    this.error.set(null);
    this.outcome.set(null);
    return controller;
  }

  private end(controller: AbortController): void {
    if (this.controller !== controller) return;
    this.controller = null;
    this.phase.set('idle');
  }

  private fail(error: unknown): void {
    this.error.set(describeError(error));
  }
}

function plural(n: number): string {
  return n === 1 ? 'document' : 'documents';
}
