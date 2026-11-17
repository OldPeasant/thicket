import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';

import { ApiError, describeError } from '../../../api/api-error';
import { WriteControl } from '../../../safety/write-control.directive';
import { WriteGuard } from '../../../safety/write-guard.service';
import { roleKey, type RoleEntry, type RoleRef, type UserEntry } from '../users-roles.model';
import { RoleInput } from './role-input';
import {
  parseCustomData,
  parsePrivileges,
  roleText,
  sameRoles,
  withoutRole,
  withRole,
} from './users-edit.model';

/** What the editor creates or changes. */
export type EditorSubject =
  | { readonly kind: 'user'; readonly entry: UserEntry | null }
  | { readonly kind: 'role'; readonly entry: RoleEntry | null };

const PRIVILEGES_HINT = `[
  { resource: { db: "shop", collection: "orders" }, actions: ["find", "insert"] }
]`;

/**
 * Form to create a user or role of a database, or change one (SPEC M6 "Could"). A user has a
 * name, a password (required when created, a new one optional when changed), roles and custom
 * data; a role has a name, privileges (shell syntax) and the roles it inherits from. Saving goes
 * through the write guard: `admin.createUser` / `admin.updateUser` / `admin.createRole` /
 * `admin.updateRole`. A change sends only what changed (roles and privileges replace the old
 * ones). Emits `saved` with the name, or `closed` when cancelled.
 */
@Component({
  selector: 'app-principal-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RoleInput, WriteControl],
  templateUrl: './principal-editor.html',
  styleUrl: './principal-editor.css',
})
export class PrincipalEditor {
  readonly profileId = input.required<string>();
  readonly db = input.required<string>();
  readonly subject = input.required<EditorSubject>();
  /** Custom role names of the database, suggested in the role field. */
  readonly known = input<readonly string[]>([]);

  readonly saved = output<string>();
  readonly closed = output();

  private readonly guard = inject(WriteGuard);

  protected readonly creating = computed(() => this.subject().entry === null);
  protected readonly isUser = computed(() => this.subject().kind === 'user');

  protected readonly name = signal('');
  protected readonly password = signal('');
  protected readonly repeat = signal('');
  protected readonly roles = signal<readonly RoleRef[]>([]);
  protected readonly privileges = signal('');
  protected readonly customData = signal('');
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly privilegesHint = PRIVILEGES_HINT;
  protected readonly roleKey = roleKey;

  protected readonly title = computed(() => {
    const subject = this.subject();
    const noun = subject.kind === 'user' ? 'user' : 'role';
    return subject.entry ? `Change ${noun} ${subject.entry.name}` : `New ${noun} in ${this.db()}`;
  });

  protected readonly saveLabel = computed(() => {
    const noun = this.isUser() ? 'user' : 'role';
    return this.creating() ? `Create ${noun}` : 'Save changes';
  });

  /** Why the form can't be saved yet (shown under it), or null. */
  protected readonly problem = computed<string | null>(() => {
    if (this.creating() && this.name().trim() === '') {
      return `Name the ${this.isUser() ? 'user' : 'role'}.`;
    }
    if (this.isUser()) {
      if (this.creating() && this.password() === '' && this.db() !== '$external') {
        return 'Type a password.';
      }
      if (this.password() !== this.repeat()) return 'The passwords differ.';
      const data = parseCustomData(this.customData());
      if (!data.ok) return `Custom data: ${data.error}`;
    } else {
      const privileges = parsePrivileges(this.privileges());
      if (!privileges.ok) return `Privileges: ${privileges.error}`;
    }
    return null;
  });

  constructor() {
    effect(() => {
      const subject = this.subject();
      untracked(() => this.reset(subject));
    });
  }

  protected roleLabel(ref: RoleRef): string {
    return roleText(ref, this.db());
  }

  protected addRole(ref: RoleRef): void {
    this.roles.update((list) => withRole(list, ref));
  }

  protected removeRole(ref: RoleRef): void {
    this.roles.update((list) => withoutRole(list, ref));
  }

  protected cancel(): void {
    this.closed.emit();
  }

  async save(): Promise<void> {
    if (this.saving() || this.problem() !== null) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      const name = await this.send();
      if (name === null) {
        this.closed.emit();
      } else {
        this.saved.emit(name);
      }
    } catch (error) {
      if (ApiError.from(error).code !== 'CANCELLED') this.error.set(describeError(error));
    } finally {
      this.saving.set(false);
    }
  }

  /** Sends the create or change; resolves with the name, or null when nothing changed. */
  private async send(): Promise<string | null> {
    const subject = this.subject();
    const base = { profileId: this.profileId(), db: this.db() };
    const roles = [...this.roles()];
    if (subject.kind === 'user') {
      const data = parseCustomData(this.customData());
      const customData = data.ok ? data.value : null;
      const password = this.password() === '' ? {} : { password: this.password() };
      if (subject.entry === null) {
        const user = this.name().trim();
        await this.guard.run('admin.createUser', {
          ...base,
          user,
          ...password,
          roles,
          ...(customData === null ? {} : { customData }),
        });
        return user;
      }
      const entry = subject.entry;
      const changes: { roles?: RoleRef[]; customData?: string; password?: string } = {
        ...password,
      };
      if (!sameRoles(roles, entry.roles)) changes.roles = roles;
      if (this.customData().trim() !== (entry.customData ?? '').trim()) {
        changes.customData = customData ?? '{}';
      }
      if (Object.keys(changes).length === 0) return null;
      await this.guard.run('admin.updateUser', { ...base, user: entry.name, ...changes });
      return entry.name;
    }
    const parsed = parsePrivileges(this.privileges());
    const privileges = parsed.ok ? parsed.value : '[]';
    if (subject.entry === null) {
      const role = this.name().trim();
      await this.guard.run('admin.createRole', { ...base, role, privileges, roles });
      return role;
    }
    const entry = subject.entry;
    const changes: { roles?: RoleRef[]; privileges?: string } = {};
    if (!sameRoles(roles, entry.roles)) changes.roles = roles;
    const before = parsePrivileges(entry.privilegesSource);
    if (!before.ok || before.value !== privileges) changes.privileges = privileges;
    if (Object.keys(changes).length === 0) return null;
    await this.guard.run('admin.updateRole', { ...base, role: entry.name, ...changes });
    return entry.name;
  }

  private reset(subject: EditorSubject): void {
    this.name.set(subject.entry?.name ?? '');
    this.password.set('');
    this.repeat.set('');
    this.roles.set(subject.entry?.roles ?? []);
    this.error.set(null);
    if (subject.kind === 'user') {
      this.customData.set(subject.entry?.customData ?? '');
      this.privileges.set('');
    } else {
      this.privileges.set(subject.entry?.privilegesSource ?? '[]');
      this.customData.set('');
    }
  }
}
