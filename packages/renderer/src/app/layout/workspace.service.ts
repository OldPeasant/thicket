import { Injectable, computed, signal } from '@angular/core';

/** What a workspace tab shows. Later tasks register a view per kind (`provideTabView`). */
export type TabKind = 'collection' | 'aggregation' | 'indexes' | 'shell' | 'admin';

/** One tab of the workspace. `id` is stable: opening a tab with a known id selects it instead. */
export interface WorkspaceTab {
  id: string;
  kind: TabKind;
  /** Main label (collection name, "Shell", "Current operations", …). */
  title: string;
  /** Secondary label, e.g. `connection / database`; also the tooltip. */
  detail?: string;
  /** The tab belongs to a production connection (red accent). */
  production?: boolean;
  /** Free data for the tab's view (profile id, namespace, …). */
  data?: Readonly<Record<string, unknown>>;
}

/**
 * The open tabs and which one is shown. `activeId` is `null` when the start page (welcome
 * screen and other routed pages) is shown instead of a tab.
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceService {
  private readonly tabsState = signal<readonly WorkspaceTab[]>([]);
  private readonly activeState = signal<string | null>(null);

  readonly tabs = this.tabsState.asReadonly();
  readonly activeId = this.activeState.asReadonly();
  readonly active = computed(
    () => this.tabsState().find((tab) => tab.id === this.activeState()) ?? null,
  );

  /** Opens `tab` after the active one (or selects it when a tab with its id is open) and shows it. */
  open(tab: WorkspaceTab): void {
    const tabs = this.tabsState();
    const existing = tabs.findIndex((t) => t.id === tab.id);
    if (existing >= 0) {
      this.tabsState.set(tabs.map((t, i) => (i === existing ? { ...t, ...tab } : t)));
    } else {
      const after = tabs.findIndex((t) => t.id === this.activeState());
      const at = after >= 0 ? after + 1 : tabs.length;
      this.tabsState.set([...tabs.slice(0, at), tab, ...tabs.slice(at)]);
    }
    this.activeState.set(tab.id);
  }

  /**
   * Closes the tab `id` (default: the active one). Closing the active tab shows its right
   * neighbour, else its left one, else the start page. Returns whether a tab was closed.
   */
  close(id: string | null = this.activeState()): boolean {
    const tabs = this.tabsState();
    const index = tabs.findIndex((t) => t.id === id);
    if (index < 0) return false;
    const rest = tabs.filter((_, i) => i !== index);
    this.tabsState.set(rest);
    if (this.activeState() === id) {
      this.activeState.set((rest[index] ?? rest[index - 1])?.id ?? null);
    }
    return true;
  }

  /** Shows the tab `id`; `null` shows the start page. Unknown ids are ignored. */
  activate(id: string | null): void {
    if (id === null || this.tabsState().some((t) => t.id === id)) this.activeState.set(id);
  }

  /** Shows the start page; the tabs stay open. */
  showHome(): void {
    this.activeState.set(null);
  }

  /**
   * Shows the next (`step` 1) or previous (`step` -1) tab, wrapping around. From the start page,
   * forward goes to the first tab and backward to the last. Returns whether there was a tab.
   */
  cycle(step: 1 | -1): boolean {
    const tabs = this.tabsState();
    if (tabs.length === 0) return false;
    const index = tabs.findIndex((t) => t.id === this.activeState());
    const next =
      index < 0 ? (step === 1 ? 0 : tabs.length - 1) : (index + step + tabs.length) % tabs.length;
    this.activeState.set(tabs[next]?.id ?? null);
    return true;
  }

  /** Moves the tab `id` to position `to` (clamped to the tab list). */
  move(id: string, to: number): void {
    const tabs = [...this.tabsState()];
    const from = tabs.findIndex((t) => t.id === id);
    if (from < 0) return;
    const target = Math.max(0, Math.min(tabs.length - 1, to));
    if (target === from) return;
    tabs.splice(target, 0, ...tabs.splice(from, 1));
    this.tabsState.set(tabs);
  }
}
