import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import type { RoleRef } from '../users-roles.model';
import { parseRoleRef, roleSuggestions } from './users-edit.model';

let nextId = 0;

/**
 * One line to name a role: `name` for a role of `db`, `name@other` for another database's, with
 * the known roles and the built-in ones as suggestions. Enter or the button emits the role.
 */
@Component({
  selector: 'app-role-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="role-input">
      <input
        #field
        type="text"
        class="field"
        data-testid="role-input"
        autocomplete="off"
        spellcheck="false"
        [attr.list]="listId"
        [attr.aria-label]="label()"
        [attr.aria-invalid]="error() ? 'true' : null"
        [disabled]="disabled()"
        [value]="text()"
        [placeholder]="'role or role@db'"
        (input)="text.set(field.value); error.set(null)"
        (keydown.enter)="$event.preventDefault(); add()"
      />
      <datalist [id]="listId">
        @for (name of suggestions(); track name) {
          <option [value]="name"></option>
        }
      </datalist>
      <button
        type="button"
        class="btn"
        data-testid="role-add"
        [disabled]="disabled() || text().trim() === ''"
        (click)="add()"
      >
        {{ action() }}
      </button>
      @if (error(); as message) {
        <span class="error" role="alert">{{ message }}</span>
      }
    </span>
  `,
  styles: `
    .role-input {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.375rem;
    }
    .field {
      width: 14rem;
      padding: 0.25rem 0.5rem;
      font-family: var(--font-mono);
      font-size: inherit;
      color: var(--text);
      background: var(--bg-input);
      border: 1px solid var(--border);
      border-radius: 3px;
    }
    .field[aria-invalid='true'] {
      border-color: var(--danger);
    }
    .btn {
      padding: 0.25rem 0.75rem;
      font: inherit;
      color: var(--text);
      background: var(--bg-input);
      border: 1px solid var(--border);
      border-radius: 3px;
      cursor: pointer;
    }
    .btn:hover:not(:disabled) {
      background: var(--bg-hover);
    }
    .btn:disabled {
      cursor: default;
      opacity: 0.55;
    }
    .error {
      flex-basis: 100%;
      color: var(--danger);
    }
  `,
})
export class RoleInput {
  /** Database the plain names belong to. */
  readonly db = input.required<string>();
  /** Role names of `db` to suggest (custom roles). */
  readonly known = input<readonly string[]>([]);
  readonly action = input('Add');
  readonly label = input('Role');
  readonly disabled = input(false);
  /** The roles go to a custom role (outside `admin` only its own database's roles work). */
  readonly forRole = input(false);
  /**
   * Whether picking a role empties the field. Off where the parent sends the role to the server
   * first: it calls `clear()` once that worked, so a refused role can be corrected.
   */
  readonly clearOnPick = input(true);
  readonly picked = output<RoleRef>();

  protected readonly listId = `role-suggestions-${nextId++}`;
  protected readonly text = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly suggestions = computed(() =>
    roleSuggestions(this.known(), this.db(), this.forRole()),
  );

  protected add(): void {
    if (this.disabled()) return;
    const parsed = parseRoleRef(this.text(), this.db());
    if (!parsed.ok) {
      this.error.set(parsed.error);
      return;
    }
    if (this.clearOnPick()) this.text.set('');
    this.error.set(null);
    this.picked.emit(parsed.value);
  }

  /** Empties the field. */
  clear(): void {
    this.text.set('');
    this.error.set(null);
  }
}
