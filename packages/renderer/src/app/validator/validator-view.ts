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
import { VALIDATION_ACTIONS, VALIDATION_LEVELS } from '@thicket/contract';

import { ApiError, describeError } from '../api/api-error';
import { ApiService } from '../api/api.service';
import type { WorkspaceTab } from '../layout/workspace.service';
import { WriteControl } from '../safety/write-control.directive';
import { WriteGuard } from '../safety/write-guard.service';
import type { CollectionTabData } from '../sidebar/sidebar-tree.service';
import {
  ACTION_HINTS,
  LEVEL_HINTS,
  parseValidatorText,
  SCHEMA_TEMPLATE,
  type ValidationAction,
  type ValidationLevel,
  validatorText,
} from './validator.model';
import { ValidatorChanges, type ValidatorTarget } from './validator-marks.service';

/** Stable id of the validator tab of a collection. */
export function validatorTabId(profileId: string, db: string, coll: string): string {
  return `validator:${profileId}:${db}.${coll}`;
}

interface Saved {
  text: string;
  level: ValidationLevel;
  action: ValidationAction;
}

/**
 * The validator of a collection (SPEC M3 "Collection validator"), set as the mongosh call
 * `db.runCommand({ collMod, validator, validationLevel, validationAction })`: the validator in
 * shell syntax, level and action as selects. Save goes through `WriteGuard`; afterwards the
 * collection's open tabs check their documents again (`ValidatorChanges`). Empty text removes
 * the validator.
 */
@Component({
  selector: 'app-validator-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WriteControl],
  templateUrl: './validator-view.html',
  styleUrl: './validator-view.css',
})
export class ValidatorView {
  readonly tab = input.required<WorkspaceTab>();

  private readonly api = inject(ApiService);
  private readonly guard = inject(WriteGuard);
  private readonly changes = inject(ValidatorChanges);

  protected readonly levels = VALIDATION_LEVELS;
  protected readonly actions = VALIDATION_ACTIONS;
  protected readonly levelHints = LEVEL_HINTS;
  protected readonly actionHints = ACTION_HINTS;

  protected readonly target = computed<ValidatorTarget>(
    () => {
      const data = this.tab().data as Partial<CollectionTabData> | undefined;
      return {
        profileId: data?.profileId ?? '',
        db: data?.db ?? '',
        coll: data?.coll ?? this.tab().title,
      };
    },
    { equal: (a, b) => a.profileId === b.profileId && a.db === b.db && a.coll === b.coll },
  );

  /** What the server has (`null` before the first read). */
  readonly saved = signal<Saved | null>(null);
  readonly text = signal('');
  readonly level = signal<ValidationLevel>('strict');
  readonly action = signal<ValidationAction>('error');
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly loadError = signal<string | null>(null);
  /** The editor text can't be parsed (shown after a Save attempt and while typing after it). */
  readonly parseError = signal<string | null>(null);
  readonly message = signal<{ error: boolean; text: string } | null>(null);

  readonly dirty = computed(() => {
    const saved = this.saved();
    return (
      saved !== null &&
      (saved.text !== this.text() || saved.level !== this.level() || saved.action !== this.action())
    );
  });

  private generation = 0;

  constructor() {
    effect(() => {
      this.target();
      untracked(() => void this.reload());
    });
  }

  /** Reads the validator again; the editor takes the server's version. */
  async reload(): Promise<void> {
    const gen = ++this.generation;
    this.loading.set(true);
    try {
      const v = await this.api.request('coll.validator.get', this.target());
      if (gen !== this.generation) return;
      const saved: Saved = {
        text: validatorText(v.validator),
        level: v.validationLevel,
        action: v.validationAction,
      };
      this.saved.set(saved);
      this.text.set(saved.text);
      this.level.set(saved.level);
      this.action.set(saved.action);
      this.parseError.set(null);
      this.loadError.set(null);
    } catch (e) {
      if (gen !== this.generation) return;
      this.loadError.set(describeError(e));
    } finally {
      if (gen === this.generation) this.loading.set(false);
    }
  }

  protected editText(event: Event): void {
    this.text.set((event.target as HTMLTextAreaElement).value);
    if (this.parseError() !== null) {
      const parsed = parseValidatorText(this.text());
      this.parseError.set(parsed.ok ? null : parsed.error);
    }
  }

  protected editLevel(event: Event): void {
    this.level.set((event.target as HTMLSelectElement).value as ValidationLevel);
  }

  protected editAction(event: Event): void {
    this.action.set((event.target as HTMLSelectElement).value as ValidationAction);
  }

  protected useTemplate(): void {
    this.text.set(SCHEMA_TEMPLATE);
    this.parseError.set(null);
  }

  protected revert(): void {
    const saved = this.saved();
    if (saved === null) return;
    this.text.set(saved.text);
    this.level.set(saved.level);
    this.action.set(saved.action);
    this.parseError.set(null);
    this.message.set(null);
  }

  async save(): Promise<void> {
    if (this.saving()) return;
    const parsed = parseValidatorText(this.text());
    if (!parsed.ok) {
      this.parseError.set(parsed.error);
      return;
    }
    this.parseError.set(null);
    this.message.set(null);
    this.saving.set(true);
    const target = this.target();
    try {
      await this.guard.run('coll.validator.set', {
        ...target,
        validator: parsed.validator,
        validationLevel: this.level(),
        validationAction: this.action(),
      });
      this.changes.changed(target);
      this.message.set({
        error: false,
        text: parsed.validator === null ? 'Removed the validator.' : 'Saved the validator.',
      });
      await this.reload();
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'CANCELLED')) {
        this.message.set({ error: true, text: describeError(e) });
      }
    } finally {
      this.saving.set(false);
    }
  }
}
