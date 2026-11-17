import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';

import { ApiError, describeError } from '../../api/api-error';
import { ApiService } from '../../api/api.service';
import type { WorkspaceTab } from '../../layout/workspace.service';
import { ProfileSafetyService } from '../../safety/profile-safety.service';
import { WriteControl } from '../../safety/write-control.directive';
import { WriteGuard } from '../../safety/write-guard.service';
import { PrincipalEditor, type EditorSubject } from './edit/principal-editor';
import { RoleInput } from './edit/role-input';
import { roleText } from './edit/users-edit.model';
import {
  type RoleEntry,
  type RoleRef,
  roleKey,
  toRoleEntry,
  toUserEntry,
  type UserEntry,
} from './users-roles.model';

/** What the users and roles tab of a database needs (the tab's `data`). */
export interface UsersTabData {
  readonly profileId: string;
  readonly db: string;
}

/** Stable id of the users and roles tab of a database. */
export function usersTabId(profileId: string, db: string): string {
  return `users:${profileId}:${db}`;
}

export type UsersMode = 'users' | 'roles';

/** A list as loaded from the backend. */
export type Loaded<T> =
  | { readonly state: 'loading' }
  | { readonly state: 'loaded'; readonly items: readonly T[] }
  | { readonly state: 'error'; readonly message: string };

function itemsOf<T>(loaded: Loaded<T>): readonly T[] | null {
  return loaded.state === 'loaded' ? loaded.items : null;
}

function errorOf(loaded: Loaded<unknown>): string | null {
  return loaded.state === 'error' ? loaded.message : null;
}

/** A line under the head after a change: what happened, or why it failed. */
export interface UsersNotice {
  readonly text: string;
  readonly error: boolean;
}

/**
 * Users and roles of one database (SPEC M6): the users with their roles, the roles they hold
 * through them and every privilege; the roles with their own privileges, the roles they inherit
 * from and all inherited privileges. Built-in roles are listed on request. A role of this
 * database named anywhere opens that role.
 *
 * Changes (M6 "Could"), all through the write guard and turned off on read-only connections:
 * create and change users and custom roles (`PrincipalEditor`), drop them (always asks first),
 * grant a role (the field below the direct roles) and revoke one (× on the role).
 */
@Component({
  selector: 'app-users-roles-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, PrincipalEditor, RoleInput, WriteControl],
  templateUrl: './users-roles-view.html',
  styleUrl: './users-roles-view.css',
})
export class UsersRolesView {
  readonly tab = input.required<WorkspaceTab>();

  private readonly api = inject(ApiService);
  private readonly guard = inject(WriteGuard);
  private readonly safety = inject(ProfileSafetyService);

  /**
   * Equal by value: reopening the tab gives a new tab object with the same data, which must not
   * reload the lists or drop the selection.
   */
  protected readonly target = computed<UsersTabData>(
    () => {
      const data = this.tab().data as Partial<UsersTabData> | undefined;
      return { profileId: data?.profileId ?? '', db: data?.db ?? '' };
    },
    { equal: (a, b) => a.profileId === b.profileId && a.db === b.db },
  );

  readonly mode = signal<UsersMode>('users');
  readonly builtin = signal(false);
  readonly users = signal<Loaded<UserEntry>>({ state: 'loading' });
  readonly roles = signal<Loaded<RoleEntry>>({ state: 'loading' });
  private readonly selectedUser = signal<string | null>(null);
  private readonly selectedRole = signal<string | null>(null);

  protected readonly userItems = computed(() => itemsOf(this.users()));
  protected readonly roleItems = computed(() => itemsOf(this.roles()));
  protected readonly usersError = computed(() => errorOf(this.users()));
  protected readonly rolesError = computed(() => errorOf(this.roles()));

  /** The selected user (the first one when nothing valid is selected). */
  readonly user = computed<UserEntry | null>(() => {
    const users = this.users();
    if (users.state !== 'loaded') return null;
    const key = this.selectedUser();
    return users.items.find((u) => u.name === key) ?? users.items[0] ?? null;
  });

  /** The selected role (the first one when nothing valid is selected). */
  readonly role = computed<RoleEntry | null>(() => {
    const roles = this.roles();
    if (roles.state !== 'loaded') return null;
    const key = this.selectedRole();
    return roles.items.find((r) => r.name === key) ?? roles.items[0] ?? null;
  });

  /** The open create/change form, or null. */
  readonly editing = signal<EditorSubject | null>(null);
  /** A grant, revoke or drop is being sent. */
  readonly busy = signal(false);
  readonly notice = signal<UsersNotice | null>(null);

  /** Whether the connection is read-only (every change is turned off). */
  protected readonly readOnly = computed(() => this.safety.readOnly(this.target().profileId)());

  /** Names of this database's custom roles, suggested where a role is named. */
  protected readonly knownRoles = computed(() =>
    (this.roleItems() ?? []).filter((r) => !r.builtin).map((r) => r.name),
  );

  private usersRequest: AbortController | null = null;
  private rolesRequest: AbortController | null = null;

  constructor() {
    effect(() => {
      const target = this.target();
      untracked(() => {
        this.selectedUser.set(null);
        this.selectedRole.set(null);
        this.editing.set(null);
        this.notice.set(null);
        if (target.profileId && target.db) this.refresh();
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.usersRequest?.abort();
      this.rolesRequest?.abort();
    });
  }

  /** Reads users and roles again. */
  refresh(): void {
    void this.loadUsers();
    void this.loadRoles();
  }

  setMode(mode: UsersMode): void {
    if (this.mode() !== mode) this.editing.set(null);
    this.mode.set(mode);
  }

  /** Opens the form for a new user or role (of the current mode). */
  create(): void {
    this.notice.set(null);
    this.editing.set(
      this.mode() === 'users' ? { kind: 'user', entry: null } : { kind: 'role', entry: null },
    );
  }

  /** Opens the form to change the selected user or custom role. */
  edit(): void {
    this.notice.set(null);
    if (this.mode() === 'users') {
      const entry = this.user();
      if (entry) this.editing.set({ kind: 'user', entry });
    } else {
      const entry = this.role();
      if (entry && !entry.builtin) this.editing.set({ kind: 'role', entry });
    }
  }

  closeEditor(): void {
    this.editing.set(null);
  }

  /** After the form saved `name`: closes it, reads again and selects `name`. */
  async saved(name: string): Promise<void> {
    const subject = this.editing();
    this.editing.set(null);
    if (!subject) return;
    const noun = subject.kind === 'user' ? 'User' : 'Role';
    this.notice.set({
      text: `${noun} ${name} ${subject.entry ? 'changed' : 'created'}.`,
      error: false,
    });
    if (subject.kind === 'user') this.selectedUser.set(name);
    else this.selectedRole.set(name);
    await this.reload();
  }

  /** Drops the selected user or custom role, after the confirm dialog. */
  async drop(): Promise<void> {
    const { profileId, db } = this.target();
    if (this.mode() === 'users') {
      const user = this.user();
      if (!user) return;
      await this.change(`User ${user.name} dropped.`, () =>
        this.guard.run(
          'admin.dropUser',
          { profileId, db, user: user.name },
          {
            alwaysConfirm: true,
            title: `Drop user ${user.name}`,
            confirmLabel: 'Drop user',
            detail: `${user.name} can no longer sign in to ${db}.`,
          },
        ),
      );
    } else {
      const role = this.role();
      if (!role || role.builtin) return;
      await this.change(`Role ${role.name} dropped.`, () =>
        this.guard.run(
          'admin.dropRole',
          { profileId, db, role: role.name },
          {
            alwaysConfirm: true,
            title: `Drop role ${role.name}`,
            confirmLabel: 'Drop role',
            detail: 'Users and roles that hold it lose its privileges.',
          },
        ),
      );
    }
  }

  /**
   * Grants `ref` to the selected user or role. `field` (the role field it was typed in) is
   * emptied only when the grant worked, so a refused role can be corrected.
   */
  async grant(ref: RoleRef, field?: RoleInput): Promise<void> {
    if (await this.grantOrRevoke('admin.grantRoles', ref)) field?.clear();
  }

  /** Revokes the directly granted `ref` from the selected user or role. */
  async revoke(ref: RoleRef): Promise<void> {
    await this.grantOrRevoke('admin.revokeRoles', ref);
  }

  private async grantOrRevoke(
    method: 'admin.grantRoles' | 'admin.revokeRoles',
    ref: RoleRef,
  ): Promise<boolean> {
    const { profileId, db } = this.target();
    const users = this.mode() === 'users';
    const name = users ? this.user()?.name : this.role()?.name;
    if (name === undefined) return false;
    const kind = users ? 'user' : 'role';
    const label = roleText(ref, db);
    const text =
      method === 'admin.grantRoles'
        ? `Granted ${label} to ${name}.`
        : `Revoked ${label} from ${name}.`;
    return this.change(text, () =>
      this.guard.run(method, { profileId, db, kind, name, roles: [{ ...ref }] }),
    );
  }

  /**
   * Sends one change, then reads users and roles again; a cancelled dialog changes nothing.
   * Resolves to whether it worked while the tab still shows the same database. When the tab
   * shows another database by the time the answer comes, nothing is shown: the notice would
   * describe lists no longer on screen (and switching already read the new ones).
   */
  private async change(done: string, send: () => Promise<unknown>): Promise<boolean> {
    if (this.busy()) return false;
    const target = this.target();
    const current = () => {
      const now = this.target();
      return now.profileId === target.profileId && now.db === target.db;
    };
    this.busy.set(true);
    this.notice.set(null);
    try {
      await send();
      if (!current()) return false;
      this.notice.set({ text: done, error: false });
      await this.reload();
      return true;
    } catch (error) {
      if (current() && ApiError.from(error).code !== 'CANCELLED') {
        this.notice.set({ text: describeError(error), error: true });
      }
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private async reload(): Promise<void> {
    await Promise.all([this.loadUsers(), this.loadRoles()]);
  }

  protected roleLabel(ref: RoleRef): string {
    return roleText(ref, this.target().db);
  }

  setBuiltin(on: boolean): void {
    if (this.builtin() === on) return;
    this.builtin.set(on);
    void this.loadRoles();
  }

  selectUser(name: string): void {
    this.selectedUser.set(name);
  }

  selectRole(name: string): void {
    this.selectedRole.set(name);
  }

  /** Whether `ref` is a role of this database (so it can be opened here). */
  isLocal(ref: RoleRef): boolean {
    return ref.db === this.target().db;
  }

  /**
   * Shows the role `ref` of this database in the roles list; a built-in role turns on the
   * built-in roles first when it isn't listed.
   */
  async openRole(ref: RoleRef): Promise<void> {
    if (!this.isLocal(ref)) return;
    this.mode.set('roles');
    this.selectedRole.set(ref.role);
    const roles = this.roles();
    const listed = roles.state === 'loaded' && roles.items.some((r) => r.name === ref.role);
    if (!listed && !this.builtin()) {
      this.builtin.set(true);
      await this.loadRoles();
    }
  }

  protected readonly roleKey = roleKey;

  private async loadUsers(): Promise<void> {
    this.usersRequest?.abort();
    const request = new AbortController();
    this.usersRequest = request;
    const { profileId, db } = this.target();
    this.users.set({ state: 'loading' });
    try {
      const { users } = await this.api.request(
        'admin.users',
        { profileId, db },
        { signal: request.signal },
      );
      if (request.signal.aborted) return;
      this.users.set({ state: 'loaded', items: users.map(toUserEntry) });
    } catch (error) {
      if (request.signal.aborted || ApiError.from(error).code === 'CANCELLED') return;
      this.users.set({ state: 'error', message: describeError(error) });
    }
  }

  private async loadRoles(): Promise<void> {
    this.rolesRequest?.abort();
    const request = new AbortController();
    this.rolesRequest = request;
    const { profileId, db } = this.target();
    this.roles.set({ state: 'loading' });
    try {
      const { roles } = await this.api.request(
        'admin.roles',
        { profileId, db, builtin: this.builtin() },
        { signal: request.signal },
      );
      if (request.signal.aborted) return;
      this.roles.set({ state: 'loaded', items: roles.map(toRoleEntry) });
    } catch (error) {
      if (request.signal.aborted || ApiError.from(error).code === 'CANCELLED') return;
      this.roles.set({ state: 'error', message: describeError(error) });
    }
  }
}
