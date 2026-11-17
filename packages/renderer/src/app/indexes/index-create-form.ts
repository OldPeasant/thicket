import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import { ApiError, describeError } from '../api/api-error';
import { WriteControl } from '../safety/write-control.directive';
import { WriteGuard } from '../safety/write-guard.service';
import {
  buildIndex,
  type DraftErrorKey,
  type DraftErrors,
  emptyDraft,
  type IndexDraft,
  isWildcard,
  KEY_TYPES,
  type KeyType,
  printCreateIndex,
} from './index-form.model';

/** The collection an index is created on. */
export interface IndexTarget {
  profileId: string;
  db: string;
  coll: string;
}

type TextOption =
  | 'name'
  | 'ttl'
  | 'partialFilter'
  | 'collation'
  | 'weights'
  | 'defaultLanguage'
  | 'wildcardProjection';
type FlagOption = 'unique' | 'sparse' | 'hidden';

let nextUid = 0;

/**
 * The create-index form, set as the `createIndex(key, options)` call it sends: key fields with
 * their direction or index type, then the options. Errors show next to their field after
 * Create (and go away as that field is edited); nothing is sent while one is left. The write
 * goes through `WriteGuard` (read-only and production rules).
 */
@Component({
  selector: 'app-index-create-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WriteControl],
  templateUrl: './index-create-form.html',
  styleUrl: './index-create-form.css',
})
export class IndexCreateForm {
  readonly target = input.required<IndexTarget>();
  /** The index was created (its name, as the server answered). */
  readonly created = output<string>();
  readonly cancelled = output();

  private readonly guard = inject(WriteGuard);

  protected readonly keyTypes = KEY_TYPES;
  protected readonly uid = `idx-form-${++nextUid}`;
  readonly draft = signal<IndexDraft>(emptyDraft());
  /** Errors of the last Create; an entry goes away when its field is edited. */
  readonly errors = signal<DraftErrors>({});
  protected readonly saving = signal(false);
  protected readonly serverError = signal<string | null>(null);
  /** Advanced options shown (collation, text and wildcard options). */
  protected readonly more = signal(false);

  private readonly built = computed(() => buildIndex(this.draft()));
  protected readonly preview = computed(() => {
    const built = this.built();
    const keyDoc = built.ok ? built.spec.keyDoc : built.keyDoc;
    const optionsDoc = built.ok ? built.spec.optionsDoc : built.optionsDoc;
    return printCreateIndex(this.target().coll, keyDoc, optionsDoc);
  });
  protected readonly hasText = computed(() => this.draft().fields.some((f) => f.type === 'text'));
  /** A wildcard (non-text) index: `{ "$**": "text" }` is a text index and takes no projection. */
  protected readonly hasWildcard = computed(() =>
    this.draft().fields.some((f) => isWildcard(f.field.trim()) && f.type !== 'text'),
  );

  protected id(key: string): string {
    return `${this.uid}-${key.replace('.', '-')}`;
  }

  protected error(key: DraftErrorKey | string): string | undefined {
    return this.errors()[key as DraftErrorKey];
  }

  private clearError(...keys: DraftErrorKey[]): void {
    const current = this.errors();
    if (!keys.some((k) => current[k] !== undefined) && current.fields === undefined) return;
    // The key as a whole (`fields`) is checked again on the next Create.
    const drop = new Set<string>([...keys, 'fields']);
    this.errors.set(
      Object.fromEntries(Object.entries(current).filter(([k]) => !drop.has(k))) as DraftErrors,
    );
  }

  protected setField(i: number, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.draft.update((d) => ({
      ...d,
      fields: d.fields.map((f, j) => (j === i ? { ...f, field: value } : f)),
    }));
    this.clearError(`field.${i}`);
  }

  protected setType(i: number, event: Event): void {
    const type = (event.target as HTMLSelectElement).value as KeyType;
    this.draft.update((d) => ({
      ...d,
      fields: d.fields.map((f, j) => (j === i ? { ...f, type } : f)),
    }));
    this.clearError(
      `field.${i}`,
      'ttl',
      'unique',
      'weights',
      'defaultLanguage',
      'collation',
      'wildcardProjection',
    );
  }

  protected addField(): void {
    this.draft.update((d) => ({ ...d, fields: [...d.fields, { field: '', type: '1' }] }));
    this.clearError('ttl');
  }

  protected removeField(i: number): void {
    this.draft.update((d) => ({ ...d, fields: d.fields.filter((_, j) => j !== i) }));
    // Field errors are by position: check them all again on the next Create.
    this.errors.update((e) =>
      Object.fromEntries(
        Object.entries(e).filter(([k]) => !k.startsWith('field.') && k !== 'fields' && k !== 'ttl'),
      ),
    );
  }

  protected setText(key: TextOption, event: Event): void {
    const value = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
    this.draft.update((d) => ({ ...d, [key]: value }));
    this.clearError(key, ...(key === 'partialFilter' ? (['sparse'] as const) : []));
  }

  protected setFlag(key: FlagOption, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.draft.update((d) => ({ ...d, [key]: checked }));
    if (key !== 'hidden') this.clearError(key);
  }

  protected toggleMore(): void {
    this.more.update((m) => !m);
  }

  /** Checks the form; sends `idx.create` when it is valid. */
  async create(event?: Event): Promise<void> {
    event?.preventDefault();
    if (this.saving()) return;
    const built = this.built();
    if (!built.ok) {
      this.errors.set(built.errors);
      const advanced: DraftErrorKey[] = [
        'collation',
        'weights',
        'defaultLanguage',
        'wildcardProjection',
      ];
      if (advanced.some((k) => built.errors[k] !== undefined)) this.more.set(true);
      return;
    }
    this.errors.set({});
    this.serverError.set(null);
    this.saving.set(true);
    try {
      const { key, options } = built.spec;
      const params = { ...this.target(), key, ...(options === undefined ? {} : { options }) };
      const result = await this.guard.run('idx.create', params);
      this.draft.set(emptyDraft());
      this.created.emit(result.name);
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'CANCELLED'))
        this.serverError.set(describeError(e));
    } finally {
      this.saving.set(false);
    }
  }

  protected cancel(): void {
    this.cancelled.emit();
  }
}
