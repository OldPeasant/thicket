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

/**
 * Users and roles of one database, read-only (SPEC M6 "Should"): the users with their roles,
 * the roles they hold through them and every privilege; the roles with their own privileges, the
 * roles they inherit from and all inherited privileges. Built-in roles are listed on request.
 * A role of this database named anywhere opens that role.
 */
@Component({
  selector: 'app-users-roles-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet],
  templateUrl: './users-roles-view.html',
  styleUrl: './users-roles-view.css',
})
export class UsersRolesView {
  readonly tab = input.required<WorkspaceTab>();

  private readonly api = inject(ApiService);

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

  private usersRequest: AbortController | null = null;
  private rolesRequest: AbortController | null = null;

  constructor() {
    effect(() => {
      const target = this.target();
      untracked(() => {
        this.selectedUser.set(null);
        this.selectedRole.set(null);
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
    this.mode.set(mode);
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
