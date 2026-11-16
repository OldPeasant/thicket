import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { CollectionInfo, Profile } from '@thicket/contract';

import { ApiError, describeError } from '../api/api-error';
import { NAV } from '../layout/navigation';
import { ProfileSafetyService } from '../safety/profile-safety.service';
import { WriteControl } from '../safety/write-control.directive';
import { formatBytes, formatDocs } from './sidebar-format';
import {
  SidebarTreeService,
  collNameProblem,
  dbKey,
  dbNameProblem,
  type ConnState,
} from './sidebar-tree.service';

/** One visible line of the tree. Status lines (loading, error, empty) are not focusable. */
export type TreeRow =
  | { kind: 'conn'; key: string; level: 1; profile: Profile; state: ConnState; expanded: boolean }
  | {
      kind: 'db';
      key: string;
      level: 2;
      profileId: string;
      db: string;
      expanded: boolean;
      size?: number;
    }
  | { kind: 'coll'; key: string; level: 3; profileId: string; db: string; info: CollectionInfo }
  | {
      kind: 'status';
      key: string;
      level: number;
      tone: 'loading' | 'error' | 'empty';
      text: string;
      retry?: () => void;
    };

type NodeRow = Exclude<TreeRow, { kind: 'status' }>;

interface MenuItem {
  id: string;
  label: string;
  run: () => void;
  /** A write: disabled on read-only profiles. */
  write?: boolean;
  disabled?: boolean;
  danger?: boolean;
}

interface OpenMenu {
  x: number;
  y: number;
  row: NodeRow;
  items: MenuItem[];
}

interface PromptField {
  key: string;
  label: string;
  value: string;
  secret?: boolean;
  problem?: (value: string) => string | null;
}

interface Prompt {
  title: string;
  /** Connection and namespace the prompt is about. */
  context: string;
  submitLabel: string;
  fields: PromptField[];
  submit: (values: Record<string, string>) => Promise<void>;
}

const STATE_LABEL: Record<ConnState, string> = {
  connecting: 'Connecting…',
  connected: 'Connected',
  disconnected: 'Not connected',
  error: 'Connection failed',
};

const TYPE_LABEL: Record<CollectionInfo['type'], string> = {
  collection: 'Collection',
  view: 'View',
  timeseries: 'Time series',
};

/** Distance the context menu keeps from the window edges. */
const MENU_MARGIN = 4;

/**
 * The sidebar: connections → databases → collections, views and time series, loaded when a node
 * is expanded. Counts and sizes are loaded on demand (context menu). The context menu (right
 * click, Shift+F10 or the menu key) creates, renames and drops databases and collections; drops
 * ask for the name to be typed, writes on read-only connections are disabled. Keyboard: arrows move
 * and expand/collapse, Enter opens a collection.
 */
@Component({
  selector: 'app-sidebar-tree',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, WriteControl],
  host: {
    '(document:mousedown)': 'onDocumentMousedown($event)',
  },
  templateUrl: './sidebar-tree.html',
  styleUrl: './sidebar-tree.css',
})
export class SidebarTree {
  protected readonly tree = inject(SidebarTreeService);
  private readonly safety = inject(ProfileSafetyService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly nav = NAV;
  protected readonly stateLabel = STATE_LABEL;
  protected readonly typeLabel = TYPE_LABEL;

  private readonly expanded = signal<ReadonlySet<string>>(new Set());
  /** Key of the focused (selected) node. */
  protected readonly focusKey = signal<string | null>(null);
  protected readonly menu = signal<OpenMenu | null>(null);
  protected readonly prompt = signal<Prompt | null>(null);
  protected readonly promptValues = signal<Record<string, string>>({});
  protected readonly promptError = signal<string | null>(null);
  protected readonly promptBusy = signal(false);
  protected readonly promptTouched = signal(false);
  /** Error of the last action without its own place to show it (drop, disconnect). */
  protected readonly notice = signal<string | null>(null);

  /** Bumped whenever focus should move to `tabStop()` after the next render. */
  private readonly focusRequest = signal(0);
  private focusPending = false;
  private menuFocusPending = false;
  private promptFocusPending = false;
  private returnFocus: string | null = null;

  /** The visible lines, in order. */
  protected readonly rows = computed<TreeRow[]>(() => {
    const rows: TreeRow[] = [];
    const expanded = this.expanded();
    for (const profile of this.tree.profileList()) {
      const ck = connKey(profile.id);
      const conn = this.tree.conn(profile.id);
      const open = expanded.has(ck);
      rows.push({ kind: 'conn', key: ck, level: 1, profile, state: conn.state, expanded: open });
      if (!open) continue;
      if (conn.state === 'connecting') {
        rows.push(status(`${ck}/s`, 2, 'loading', 'Connecting…'));
        continue;
      }
      if (conn.state === 'error') {
        rows.push(
          status(`${ck}/s`, 2, 'error', conn.message ?? 'Connection failed.', () =>
            this.connect(profile.id),
          ),
        );
        continue;
      }
      if (conn.state === 'disconnected') {
        rows.push(status(`${ck}/s`, 2, 'empty', 'Not connected.', () => this.connect(profile.id)));
        continue;
      }
      const dbs = this.tree.databases(profile.id);
      if (!dbs || dbs.status === 'loading') {
        rows.push(status(`${ck}/s`, 2, 'loading', 'Loading databases…'));
        continue;
      }
      if (dbs.status === 'error') {
        rows.push(
          status(`${ck}/s`, 2, 'error', dbs.message, () => this.tree.loadDatabases(profile.id)),
        );
        continue;
      }
      if (dbs.value.length === 0) rows.push(status(`${ck}/s`, 2, 'empty', 'No databases.'));
      for (const db of dbs.value) {
        const dk = dbNodeKey(profile.id, db.name);
        const dbOpen = expanded.has(dk);
        const row: TreeRow = {
          kind: 'db',
          key: dk,
          level: 2,
          profileId: profile.id,
          db: db.name,
          expanded: dbOpen,
        };
        if (db.sizeOnDisk !== undefined) row.size = db.sizeOnDisk;
        rows.push(row);
        if (!dbOpen) continue;
        const colls = this.tree.collections(profile.id, db.name);
        if (!colls || colls.status === 'loading') {
          rows.push(status(`${dk}/s`, 3, 'loading', 'Loading collections…'));
        } else if (colls.status === 'error') {
          rows.push(
            status(`${dk}/s`, 3, 'error', colls.message, () =>
              this.tree.loadCollections(profile.id, db.name),
            ),
          );
        } else if (colls.value.length === 0) {
          rows.push(status(`${dk}/s`, 3, 'empty', 'No collections.'));
        } else {
          for (const info of colls.value) {
            rows.push({
              kind: 'coll',
              key: collNodeKey(profile.id, db.name, info.name),
              level: 3,
              profileId: profile.id,
              db: db.name,
              info,
            });
          }
        }
      }
    }
    return rows;
  });

  protected readonly profilesError = computed(() => {
    const load = this.tree.profiles();
    return load.status === 'error' ? load.message : '';
  });

  private readonly nodes = computed(() =>
    this.rows().filter((row): row is NodeRow => row.kind !== 'status'),
  );

  /** The node that takes Tab focus: the focused one, else the first. */
  protected readonly tabStop = computed(() => {
    const key = this.focusKey();
    const nodes = this.nodes();
    return nodes.some((n) => n.key === key) ? key : (nodes[0]?.key ?? null);
  });

  constructor() {
    this.tree.start();
    // When a connection's lists are forgotten (disconnect, connection error, backend restart),
    // its databases collapse, so after reconnecting they load their collections again when
    // expanded instead of waiting for a list nobody requests.
    effect(() => {
      const expanded = this.expanded();
      const forgotten = this.tree
        .profileList()
        .filter((p) => this.tree.databases(p.id) === undefined)
        .map((p) => dbNodeKey(p.id, ''));
      const stale = [...expanded].filter((k) => forgotten.some((prefix) => k.startsWith(prefix)));
      if (stale.length === 0) return;
      untracked(() => {
        for (const key of stale) this.setExpanded(key, false);
      });
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.prompt()) this.tree.setPromptOpen(false);
    });
    afterRenderEffect(() => {
      this.rows();
      this.focusRequest();
      this.menu();
      this.prompt();
      const root = this.host.nativeElement;
      if (this.promptFocusPending && this.prompt()) {
        this.promptFocusPending = false;
        root.querySelector<HTMLElement>('.prompt input')?.focus();
      }
      const menu = this.menu();
      if (menu) this.keepMenuInView(menu);
      if (this.menuFocusPending && this.menu()) {
        this.menuFocusPending = false;
        root.querySelector<HTMLElement>('.menu button:not([disabled])')?.focus();
      }
      if (this.focusPending) {
        this.focusPending = false;
        const key = this.tabStop();
        if (key !== null) this.nodeElement(key)?.focus();
      }
    });
  }

  // ---- rendering helpers ------------------------------------------------------------------

  protected readOnly(profileId: string): boolean {
    return this.safety.readOnly(profileId)();
  }

  protected dbStatsText(row: Extract<TreeRow, { kind: 'db' }>): string | null {
    const stats = this.tree.dbStats(row.profileId, row.db);
    if (stats?.status === 'loading') return '…';
    if (stats?.status === 'error') return 'stats failed';
    if (stats?.status === 'loaded') {
      const s = stats.value;
      return `${s.collections + s.views} coll., ${formatDocs(s.objects, s.storageSize)}`;
    }
    return row.size !== undefined ? formatBytes(row.size) : null;
  }

  protected collStatsText(row: Extract<TreeRow, { kind: 'coll' }>): string | null {
    const stats = this.tree.collStats(row.profileId, row.db, row.info.name);
    if (stats?.status === 'loading') return '…';
    if (stats?.status === 'error') return 'stats failed';
    if (stats?.status === 'loaded') return formatDocs(stats.value.count, stats.value.size);
    return null;
  }

  protected statsTitle(profileId: string, db: string, coll?: string): string | null {
    const stats =
      coll === undefined
        ? this.tree.dbStats(profileId, db)
        : this.tree.collStats(profileId, db, coll);
    return stats?.status === 'error' ? stats.message : null;
  }

  protected connColor(profile: Profile): string | null {
    return profile.color ?? null;
  }

  // ---- actions ---------------------------------------------------------------------------

  /** Click or Enter on a node. */
  protected activate(row: NodeRow): void {
    this.focusKey.set(row.key);
    if (row.kind === 'coll') this.tree.openCollection(row.profileId, row.db, row.info);
    else this.toggle(row);
  }

  protected toggle(row: NodeRow, open?: boolean): void {
    if (row.kind === 'coll') return;
    const willOpen = open ?? !row.expanded;
    if (
      willOpen === row.expanded &&
      !(row.kind === 'conn' && willOpen && row.state !== 'connected')
    )
      return;
    this.setExpanded(row.key, willOpen);
    if (!willOpen) return;
    if (row.kind === 'conn') {
      const state = this.tree.conn(row.profile.id).state;
      if (state === 'connected') {
        if (!this.tree.databases(row.profile.id)) void this.tree.loadDatabases(row.profile.id);
      } else if (state !== 'connecting') {
        this.connect(row.profile.id);
      }
    } else if (!this.tree.collections(row.profileId, row.db)) {
      void this.tree.loadCollections(row.profileId, row.db);
    }
  }

  protected connect(profileId: string): void {
    this.setExpanded(connKey(profileId), true);
    if (!this.tree.asksPassword(profileId)) {
      void this.tree.connect(profileId);
      return;
    }
    const profile = this.tree.profile(profileId);
    this.openPrompt({
      title: 'Connect',
      context: profile?.name ?? profileId,
      submitLabel: 'Connect',
      fields: [{ key: 'password', label: 'Password', value: '', secret: true }],
      submit: async ({ password }) => {
        // The password is passed once to conn.open and not kept.
        const view = await this.tree.connect(profileId, password ?? '');
        if (view.state === 'error') throw new Error(view.message ?? 'Connection failed.');
      },
    });
  }

  private async run(work: () => Promise<void>): Promise<void> {
    this.notice.set(null);
    try {
      await work();
    } catch (error) {
      if (ApiError.from(error).code !== 'CANCELLED') this.notice.set(describeError(error));
    }
  }

  private menuItems(row: NodeRow): MenuItem[] {
    if (row.kind === 'conn') {
      const id = row.profile.id;
      const connected = row.state === 'connected';
      return [
        connected || row.state === 'connecting'
          ? {
              id: 'disconnect',
              label: 'Disconnect',
              run: () => void this.run(() => this.tree.disconnect(id)),
            }
          : { id: 'connect', label: 'Connect', run: () => this.connect(id) },
        {
          id: 'refresh',
          label: 'Refresh',
          disabled: !connected,
          run: () => void this.tree.loadDatabases(id),
        },
        {
          id: 'sizes',
          label: 'Show database sizes',
          disabled: !connected,
          run: () => {
            this.setExpanded(row.key, true);
            void this.tree.loadDatabases(id, true);
          },
        },
        {
          id: 'create-db',
          label: 'Create database…',
          write: true,
          disabled: !connected,
          run: () => this.promptCreateDatabase(row.profile),
        },
      ];
    }
    if (row.kind === 'db') {
      const { profileId, db } = row;
      return [
        {
          id: 'refresh',
          label: 'Refresh',
          run: () => void this.tree.loadCollections(profileId, db),
        },
        {
          id: 'stats',
          label: 'Show counts and sizes',
          run: () => void this.tree.loadDbStats(profileId, db),
        },
        {
          id: 'create-coll',
          label: 'Create collection…',
          write: true,
          run: () => this.promptCreateCollection(profileId, db),
        },
        {
          id: 'drop-db',
          label: 'Drop database…',
          write: true,
          danger: true,
          run: () => void this.run(() => this.tree.dropDatabase(profileId, db)),
        },
      ];
    }
    const { profileId, db, info } = row;
    return [
      { id: 'open', label: 'Open', run: () => this.tree.openCollection(profileId, db, info) },
      {
        id: 'stats',
        label: 'Show counts and sizes',
        disabled: info.type === 'view',
        run: () => void this.tree.loadCollStats(profileId, db, info.name),
      },
      {
        id: 'rename',
        label: 'Rename…',
        write: true,
        disabled: info.type === 'view',
        run: () => this.promptRename(profileId, db, info.name),
      },
      {
        id: 'drop-coll',
        label: info.type === 'view' ? 'Drop view…' : 'Drop collection…',
        write: true,
        danger: true,
        run: () => void this.run(() => this.tree.dropCollection(profileId, db, info.name)),
      },
    ];
  }

  private promptCreateDatabase(profile: Profile): void {
    this.setExpanded(connKey(profile.id), true);
    this.openPrompt({
      title: 'Create database',
      context: profile.name,
      submitLabel: 'Create database',
      fields: [
        { key: 'db', label: 'Database name', value: '', problem: dbNameProblem },
        { key: 'coll', label: 'First collection', value: '', problem: collNameProblem },
      ],
      submit: async ({ db = '', coll = '' }) => {
        await this.tree.createDatabase(profile.id, db, coll);
        this.setExpanded(dbNodeKey(profile.id, db), true);
      },
    });
  }

  private promptCreateCollection(profileId: string, db: string): void {
    this.setExpanded(dbNodeKey(profileId, db), true);
    this.openPrompt({
      title: 'Create collection',
      context: `${this.tree.profile(profileId)?.name ?? profileId} / ${db}`,
      submitLabel: 'Create collection',
      fields: [{ key: 'coll', label: 'Collection name', value: '', problem: collNameProblem }],
      submit: ({ coll = '' }) => this.tree.createCollection(profileId, db, coll),
    });
  }

  private promptRename(profileId: string, db: string, coll: string): void {
    this.openPrompt({
      title: 'Rename collection',
      context: `${this.tree.profile(profileId)?.name ?? profileId} / ${db}.${coll}`,
      submitLabel: 'Rename',
      fields: [
        {
          key: 'name',
          label: 'New name',
          value: coll,
          problem: (v) => collNameProblem(v) ?? (v === coll ? 'Enter a different name.' : null),
        },
      ],
      submit: async ({ name = '' }) => {
        await this.tree.renameCollection(profileId, db, coll, name);
        this.focusKey.set(collNodeKey(profileId, db, name));
      },
    });
  }

  // ---- context menu ----------------------------------------------------------------------

  protected openMenu(row: NodeRow, event?: MouseEvent): void {
    event?.preventDefault();
    this.focusKey.set(row.key);
    let x: number;
    let y: number;
    if (event && (event.clientX !== 0 || event.clientY !== 0)) {
      x = event.clientX;
      y = event.clientY;
    } else {
      const rect = this.nodeElement(row.key)?.getBoundingClientRect();
      x = (rect?.left ?? 0) + 24;
      y = rect?.bottom ?? 0;
    }
    this.returnFocus = row.key;
    this.menuFocusPending = true;
    this.menu.set({ x, y, row, items: this.menuItems(row) });
  }

  protected closeMenu(refocus = true): void {
    if (!this.menu()) return;
    this.menu.set(null);
    if (refocus) this.refocus();
  }

  protected chooseItem(item: MenuItem, row: NodeRow): void {
    if (item.disabled || (item.write && this.readOnly(profileIdOf(row)))) return;
    this.menu.set(null);
    item.run();
    // An item that opened the prompt leaves the focus to it; closing the prompt returns it here.
    if (!this.prompt()) this.refocus();
  }

  /** Moves the open menu inside the window (above the pointer when there is no room below). */
  private keepMenuInView(menu: OpenMenu): void {
    const el = this.host.nativeElement.querySelector<HTMLElement>('.menu');
    const view = this.host.nativeElement.ownerDocument.defaultView;
    if (!el || !view) return;
    const { width, height } = el.getBoundingClientRect();
    let { x, y } = menu;
    if (x + width + MENU_MARGIN > view.innerWidth) {
      x = Math.max(MENU_MARGIN, view.innerWidth - width - MENU_MARGIN);
    }
    if (y + height + MENU_MARGIN > view.innerHeight) {
      y = Math.max(MENU_MARGIN, y - height);
    }
    if (x !== menu.x || y !== menu.y) this.menu.set({ ...menu, x, y });
  }

  protected onMenuKeydown(event: KeyboardEvent): void {
    const buttons = Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>('.menu button:not([disabled])'),
    );
    const index = buttons.indexOf(event.target as HTMLElement);
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      this.closeMenu();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      buttons[(index + step + buttons.length) % buttons.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      (event.key === 'Home' ? buttons[0] : buttons.at(-1))?.focus();
    }
  }

  protected onDocumentMousedown(event: MouseEvent): void {
    if (!this.menu()) return;
    const menu = this.host.nativeElement.querySelector('.menu');
    if (menu && !menu.contains(event.target as Node | null)) this.closeMenu(false);
  }

  // ---- prompt ----------------------------------------------------------------------------

  private openPrompt(prompt: Prompt): void {
    this.menu.set(null);
    this.promptValues.set(Object.fromEntries(prompt.fields.map((f) => [f.key, f.value])));
    this.promptError.set(null);
    this.promptTouched.set(false);
    this.promptBusy.set(false);
    this.promptFocusPending = true;
    this.returnFocus ??= this.focusKey();
    this.prompt.set(prompt);
    this.tree.setPromptOpen(true);
  }

  protected fieldProblem(field: PromptField): string | null {
    return field.problem?.(this.promptValues()[field.key] ?? '') ?? null;
  }

  protected onPromptInput(field: PromptField, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.promptValues.update((v) => ({ ...v, [field.key]: value }));
    this.promptError.set(null);
  }

  protected async submitPrompt(event?: Event): Promise<void> {
    event?.preventDefault();
    const prompt = this.prompt();
    if (!prompt || this.promptBusy()) return;
    this.promptTouched.set(true);
    if (prompt.fields.some((f) => this.fieldProblem(f) !== null)) return;
    this.promptBusy.set(true);
    this.promptError.set(null);
    try {
      await prompt.submit(this.promptValues());
      if (this.prompt() === prompt) this.closePrompt();
    } catch (error) {
      if (this.prompt() !== prompt) return;
      const apiError = ApiError.from(error);
      // A cancelled confirm dialog keeps the prompt open to change the name or cancel.
      this.promptError.set(apiError.code === 'CANCELLED' ? null : describeError(error));
    } finally {
      if (this.prompt() === prompt) this.promptBusy.set(false);
    }
  }

  protected closePrompt(): void {
    this.prompt.set(null);
    this.promptValues.set({});
    this.tree.setPromptOpen(false);
    this.refocus();
  }

  protected onPromptKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (!this.promptBusy()) this.closePrompt();
    } else if (event.key === 'Tab') {
      const items = Array.from(
        this.host.nativeElement.querySelectorAll<HTMLElement>(
          '.prompt input, .prompt button:not([disabled])',
        ),
      );
      const first = items[0];
      const last = items.at(-1);
      const active = this.host.nativeElement.ownerDocument.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  }

  // ---- keyboard --------------------------------------------------------------------------

  protected onTreeKeydown(event: KeyboardEvent, row: NodeRow): void {
    const nodes = this.nodes();
    const index = nodes.findIndex((n) => n.key === row.key);
    const move = (to: number): void => {
      const target = nodes[Math.max(0, Math.min(nodes.length - 1, to))];
      if (!target) return;
      event.preventDefault();
      this.focusKey.set(target.key);
      this.requestFocus();
    };
    switch (event.key) {
      case 'ArrowDown':
        move(index + 1);
        break;
      case 'ArrowUp':
        move(index - 1);
        break;
      case 'Home':
        move(0);
        break;
      case 'End':
        move(nodes.length - 1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (row.kind !== 'coll' && !row.expanded) this.toggle(row, true);
        else if (row.kind !== 'coll') move(index + 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (row.kind !== 'coll' && row.expanded) this.toggle(row, false);
        else {
          const parent = nodes.slice(0, index).findLast((n) => n.level < row.level);
          if (parent) move(nodes.indexOf(parent));
        }
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.activate(row);
        break;
      case 'ContextMenu':
        this.openMenu(row);
        event.preventDefault();
        break;
      case 'F10':
        if (event.shiftKey) {
          event.preventDefault();
          this.openMenu(row);
        }
        break;
    }
  }

  protected onNodeFocus(row: NodeRow): void {
    this.focusKey.set(row.key);
  }

  protected dismissNotice(): void {
    this.notice.set(null);
  }

  private setExpanded(key: string, open: boolean): void {
    this.expanded.update((set) => {
      if (set.has(key) === open) return set;
      const next = new Set(set);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  private refocus(): void {
    const key = this.returnFocus;
    this.returnFocus = null;
    if (key !== null) this.focusKey.set(key);
    this.requestFocus();
  }

  private requestFocus(): void {
    this.focusPending = true;
    this.focusRequest.update((n) => n + 1);
  }

  private nodeElement(key: string): HTMLElement | null {
    return (
      Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('[data-node-key]')).find(
        (el) => el.dataset['nodeKey'] === key,
      ) ?? null
    );
  }
}

function status(
  key: string,
  level: number,
  tone: 'loading' | 'error' | 'empty',
  text: string,
  retry?: () => unknown,
): TreeRow {
  const row: TreeRow = { kind: 'status', key, level, tone, text };
  if (retry) row.retry = () => void retry();
  return row;
}

function connKey(profileId: string): string {
  return `c\u0000${profileId}`;
}

function dbNodeKey(profileId: string, db: string): string {
  return `d\u0000${dbKey(profileId, db)}`;
}

function collNodeKey(profileId: string, db: string, coll: string): string {
  return `k\u0000${dbKey(profileId, db)}\u0000${coll}`;
}

function profileIdOf(row: NodeRow): string {
  return row.kind === 'conn' ? row.profile.id : row.profileId;
}
