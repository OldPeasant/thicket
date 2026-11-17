import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  viewChild,
  type Type,
} from '@angular/core';
import {
  NavigationEnd,
  NavigationSkipped,
  NavigationSkippedCode,
  Router,
  RouterOutlet,
} from '@angular/router';
import { SIDEBAR_WIDTH } from '@thicket/contract';
import { filter } from 'rxjs';

import { HostKeyDialog } from '../connections/host-key-dialog';
import { HostKeyService } from '../connections/host-key.service';
import { ConfirmDialog } from '../safety/confirm-dialog';
import { SidebarTree } from '../sidebar/sidebar-tree';
import { SidebarTreeService } from '../sidebar/sidebar-tree.service';
import { ConfirmService } from '../safety/confirm.service';
import { SidebarWidthService } from './sidebar-width.service';
import { StatusBar } from './status-bar';
import { StatusService } from './status.service';
import { START_PANEL_DOM_ID, START_TAB_DOM_ID, TabBar, tabDomId, tabPanelDomId } from './tab-bar';
import { TAB_VIEWS } from './tab-views';
import { TabPlaceholder } from './tab-placeholder';
import { WorkspaceService, type TabKind } from './workspace.service';

/** Sidebar width step for the arrow keys on the splitter. */
export const SIDEBAR_KEY_STEP = 16;

/**
 * The main window: resizable sidebar, tab strip with the open tabs (or the routed start page when
 * no tab is shown) and the status bar. Keyboard: Ctrl/Cmd+W closes the active tab,
 * Ctrl+Tab / Ctrl+Shift+Tab (and Ctrl+PageDown / Ctrl+PageUp) cycle through the tabs,
 * Ctrl+Shift+PageDown / Ctrl+Shift+PageUp move the active tab. Hosts the write confirm dialog
 * (`ConfirmDialog`): while it is open the rest of the window is `inert` and the tab shortcuts do
 * nothing. The sidebar's name/password prompt is modal too: while it is open everything but the
 * sidebar is `inert` and the shortcuts do nothing. Shows the production accent while the active
 * view is on a production connection.
 */
@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ConfirmDialog,
    HostKeyDialog,
    NgComponentOutlet,
    RouterOutlet,
    SidebarTree,
    StatusBar,
    TabBar,
  ],
  host: {
    '[style.--sidebar-width.px]': 'sidebar.width()',
    '[class.production]': 'production()',
    '[attr.data-production]': 'production() ? "" : null',
    '(document:keydown)': 'onKeydown($event)',
  },
  template: `
    <aside
      class="sidebar"
      data-testid="sidebar"
      aria-label="Connections"
      [attr.inert]="confirmOpen() ? '' : null"
    >
      <app-sidebar-tree />
    </aside>
    <div
      class="splitter"
      data-testid="splitter"
      role="separator"
      tabindex="0"
      aria-orientation="vertical"
      aria-label="Sidebar width"
      [attr.inert]="modal() ? '' : null"
      [attr.aria-valuenow]="sidebar.width()"
      [attr.aria-valuemin]="min"
      [attr.aria-valuemax]="max"
      (pointerdown)="dragStart($event)"
      (pointermove)="dragMove($event)"
      (pointerup)="dragEnd($event)"
      (pointercancel)="dragEnd($event)"
      (dblclick)="saveWidth(defaultWidth)"
      (keydown)="splitterKey($event)"
    ></div>
    <div class="work" [attr.inert]="modal() ? '' : null">
      <app-tab-bar />
      <main class="content" data-testid="workspace">
        <div
          class="pane"
          role="tabpanel"
          [id]="startPanelId"
          [attr.aria-labelledby]="startTabId"
          [hidden]="workspace.activeId() !== null"
        >
          <router-outlet />
        </div>
        @for (tab of workspace.tabs(); track tab.id) {
          <div
            class="pane"
            role="tabpanel"
            data-testid="tab-panel"
            [id]="panelId(tab.id)"
            [attr.aria-labelledby]="tabId(tab.id)"
            [attr.data-tab-id]="tab.id"
            [hidden]="tab.id !== workspace.activeId()"
          >
            <ng-container *ngComponentOutlet="viewFor(tab.kind); inputs: { tab }" />
          </div>
        }
      </main>
    </div>
    <app-status-bar class="status" [attr.inert]="modal() ? '' : null" />
    <app-confirm-dialog />
    <app-host-key-dialog />
  `,
  styleUrl: './app-shell.css',
})
export class AppShell {
  protected readonly workspace = inject(WorkspaceService);
  protected readonly sidebar = inject(SidebarWidthService);
  private readonly views = inject(TAB_VIEWS);
  private readonly tabBar = viewChild.required(TabBar);
  protected readonly min = SIDEBAR_WIDTH.min;
  protected readonly max = SIDEBAR_WIDTH.max;
  protected readonly defaultWidth = SIDEBAR_WIDTH.default;
  protected readonly startTabId = START_TAB_DOM_ID;
  protected readonly startPanelId = START_PANEL_DOM_ID;
  protected readonly tabId = tabDomId;
  protected readonly panelId = tabPanelDomId;

  private readonly status = inject(StatusService);
  private readonly confirm = inject(ConfirmService);
  private readonly sidebarTree = inject(SidebarTreeService);
  private readonly hostKeys = inject(HostKeyService);
  /** The write confirm dialog or the SSH host key dialog is open: everything else is inert. */
  protected readonly confirmOpen = computed(
    () => this.confirm.current() !== null || this.hostKeys.current() !== null,
  );
  /**
   * A modal dialog is open (the confirm dialog or the sidebar's prompt): the shortcuts are
   * ignored and the work area, splitter and status bar are inert.
   */
  protected readonly modal = computed(() => this.confirmOpen() || this.sidebarTree.promptOpen());
  /**
   * The active view belongs to a production connection: the active tab's flag, or (on the start
   * page) the status bar's connection. Draws the red accent along the sidebar and status bar.
   */
  protected readonly production = computed(() => {
    const tab = this.workspace.active();
    return tab ? tab.production === true : this.status.connection()?.production === true;
  });

  private drag: { pointerId: number; startX: number; startWidth: number } | null = null;

  constructor() {
    void this.sidebar.init();
    // Following a link (welcome screen, sidebar) shows the routed page instead of a tab, also
    // when it leads to the current URL (the router skips that navigation).
    const sub = inject(Router)
      .events.pipe(
        filter(
          (event) =>
            event instanceof NavigationEnd ||
            (event instanceof NavigationSkipped &&
              event.code === NavigationSkippedCode.IgnoredSameUrlNavigation),
        ),
      )
      .subscribe(() => this.workspace.showHome());
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());
  }

  protected viewFor(kind: TabKind): Type<unknown> {
    return this.views.find((view) => view.kind === kind)?.component ?? TabPlaceholder;
  }

  protected onKeydown(event: KeyboardEvent): void {
    const mod = event.ctrlKey || event.metaKey;
    if (!mod || event.altKey) return;
    const key = event.key;
    // The physical W key also counts on non-Latin layouts (e.g. key 'ц'), where the menu
    // accelerator could close the window; a Latin letter on that key (AZERTY 'z') is left alone.
    const isW = key === 'w' || key === 'W' || (event.code === 'KeyW' && !/^[a-z]$/i.test(key));
    // While a modal dialog is open the shortcuts are still consumed (so Ctrl+W never closes
    // the window) but do not touch the tabs behind it.
    const modal = this.modal();
    if (isW && !event.shiftKey) {
      // Always consumed, so the shortcut never closes the window instead of a tab.
      event.preventDefault();
      if (!modal) this.tabBar().closeActive();
    } else if (key === 'Tab') {
      event.preventDefault();
      if (!modal) this.workspace.cycle(event.shiftKey ? -1 : 1);
    } else if ((key === 'PageDown' || key === 'PageUp') && event.ctrlKey) {
      event.preventDefault();
      if (modal) return;
      const step = key === 'PageDown' ? 1 : -1;
      const active = this.workspace.activeId();
      if (!event.shiftKey) this.workspace.cycle(step);
      else if (active !== null) {
        const index = this.workspace.tabs().findIndex((t) => t.id === active);
        this.workspace.move(active, index + step);
      }
    }
  }

  protected dragStart(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    this.drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: this.sidebar.width(),
    };
    (event.currentTarget as Element | null)?.setPointerCapture?.(event.pointerId);
  }

  protected dragMove(event: PointerEvent): void {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    this.sidebar.preview(this.drag.startWidth + event.clientX - this.drag.startX);
  }

  protected dragEnd(event: PointerEvent): void {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    this.drag = null;
    this.saveWidth(this.sidebar.width());
  }

  protected splitterKey(event: KeyboardEvent): void {
    const width = this.sidebar.width();
    const next =
      event.key === 'ArrowLeft'
        ? width - SIDEBAR_KEY_STEP
        : event.key === 'ArrowRight'
          ? width + SIDEBAR_KEY_STEP
          : event.key === 'Home'
            ? SIDEBAR_WIDTH.min
            : event.key === 'End'
              ? SIDEBAR_WIDTH.max
              : null;
    if (next === null) return;
    event.preventDefault();
    this.saveWidth(next);
  }

  protected saveWidth(width: number): void {
    this.sidebar.commit(width).catch((error: unknown) => console.error(error));
  }
}
