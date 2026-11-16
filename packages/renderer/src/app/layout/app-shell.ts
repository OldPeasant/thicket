import { NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, type Type } from '@angular/core';
import {
  NavigationEnd,
  NavigationSkipped,
  NavigationSkippedCode,
  Router,
  RouterLink,
  RouterOutlet,
} from '@angular/router';
import { SIDEBAR_WIDTH } from '@thicket/contract';
import { filter } from 'rxjs';

import { NAV } from './navigation';
import { SidebarWidthService } from './sidebar-width.service';
import { StatusBar } from './status-bar';
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
 * Ctrl+Shift+PageDown / Ctrl+Shift+PageUp move the active tab.
 */
@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgComponentOutlet, RouterLink, RouterOutlet, StatusBar, TabBar],
  host: {
    '[style.--sidebar-width.px]': 'sidebar.width()',
    '(document:keydown)': 'onKeydown($event)',
  },
  template: `
    <aside class="sidebar" data-testid="sidebar" aria-label="Connections">
      <h2 class="sidebar-title">Connections</h2>
      <div class="sidebar-empty">
        <p>No connections yet.</p>
        <a [routerLink]="nav.newConnection" data-testid="sidebar-new">New connection</a>
      </div>
    </aside>
    <div
      class="splitter"
      data-testid="splitter"
      role="separator"
      tabindex="0"
      aria-orientation="vertical"
      aria-label="Sidebar width"
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
    <div class="work">
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
    <app-status-bar class="status" />
  `,
  styleUrl: './app-shell.css',
})
export class AppShell {
  protected readonly workspace = inject(WorkspaceService);
  protected readonly sidebar = inject(SidebarWidthService);
  private readonly views = inject(TAB_VIEWS);
  protected readonly nav = NAV;
  protected readonly min = SIDEBAR_WIDTH.min;
  protected readonly max = SIDEBAR_WIDTH.max;
  protected readonly defaultWidth = SIDEBAR_WIDTH.default;
  protected readonly startTabId = START_TAB_DOM_ID;
  protected readonly startPanelId = START_PANEL_DOM_ID;
  protected readonly tabId = tabDomId;
  protected readonly panelId = tabPanelDomId;

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
    if (isW && !event.shiftKey) {
      // Always consumed, so the shortcut never closes the window instead of a tab.
      event.preventDefault();
      this.workspace.close();
    } else if (key === 'Tab') {
      event.preventDefault();
      this.workspace.cycle(event.shiftKey ? -1 : 1);
    } else if ((key === 'PageDown' || key === 'PageUp') && event.ctrlKey) {
      event.preventDefault();
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
