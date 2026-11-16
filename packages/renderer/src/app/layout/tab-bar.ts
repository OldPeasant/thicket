import { ChangeDetectionStrategy, Component, ElementRef, inject, signal } from '@angular/core';

import { WorkspaceService, type WorkspaceTab } from './workspace.service';

/** DOM id of the "Start" tab and of its panel (the routed pane). */
export const START_TAB_DOM_ID = 'ws-start-tab';
export const START_PANEL_DOM_ID = 'ws-start-panel';

/** DOM id of the tab `id` (encoded: tab ids are free text, IDREFs must not contain spaces). */
export function tabDomId(id: string): string {
  return `ws-tab-${encodeURIComponent(id)}`;
}

/** DOM id of the panel of the tab `id`. */
export function tabPanelDomId(id: string): string {
  return `ws-panel-${encodeURIComponent(id)}`;
}

/**
 * The tab strip (WAI-ARIA tabs pattern): a "Start" tab (welcome screen and other routed pages),
 * then the open tabs. Only the selected tab is a Tab stop; ArrowLeft/ArrowRight (wrapping),
 * Home and End select another tab, Delete closes the focused one. Click selects, the × button
 * (pointer only) or a middle click closes, drag and drop reorders.
 */
@Component({
  selector: 'app-tab-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="strip" role="tablist" aria-label="Open tabs" (keydown)="onKeydown($event)">
      <button
        type="button"
        role="tab"
        class="tab home"
        data-testid="tab-home"
        [id]="startTabId"
        [attr.aria-controls]="startPanelId"
        [attr.aria-selected]="workspace.activeId() === null"
        [attr.tabindex]="workspace.activeId() === null ? 0 : -1"
        [class.active]="workspace.activeId() === null"
        (click)="workspace.showHome()"
        title="Start"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 14V7M8 9 4.5 5.5M8 7l3-3M4.5 5.5 3 4M4.5 5.5V3M11 4h1.5M11 4V2.5" />
        </svg>
        <span class="sr-only">Start</span>
      </button>
      @for (tab of workspace.tabs(); track tab.id; let i = $index) {
        <div
          class="tab"
          role="presentation"
          data-testid="tab"
          [attr.data-tab-id]="tab.id"
          [class.active]="tab.id === workspace.activeId()"
          [class.production]="tab.production"
          [class.dragging]="tab.id === dragId()"
          [class.drop-before]="dropAt() === i && dragId() !== tab.id"
          [class.drop-after]="dropAt() === i + 1 && i === workspace.tabs().length - 1"
          draggable="true"
          (dragstart)="dragStart($event, tab)"
          (dragover)="dragOver($event, i)"
          (drop)="drop($event)"
          (dragend)="dragEnd()"
          (auxclick)="auxClose($event, tab)"
        >
          <button
            type="button"
            role="tab"
            class="select"
            [id]="tabId(tab.id)"
            [attr.aria-controls]="panelId(tab.id)"
            [attr.aria-selected]="tab.id === workspace.activeId()"
            [attr.tabindex]="tab.id === workspace.activeId() ? 0 : -1"
            aria-keyshortcuts="Delete"
            [attr.title]="tab.detail ? tab.title + ' — ' + tab.detail : tab.title"
            (click)="workspace.activate(tab.id)"
          >
            <span class="kind" [attr.data-kind]="tab.kind" aria-hidden="true"></span>
            <span class="title">{{ tab.title }}</span>
            @if (tab.detail) {
              <span class="detail">{{ tab.detail }}</span>
            }
          </button>
          <!-- Pointer only: keyboard users close the focused tab with Delete. -->
          <button
            type="button"
            class="close"
            data-testid="tab-close"
            tabindex="-1"
            aria-hidden="true"
            [attr.title]="'Close ' + tab.title"
            (click)="closeTab(tab.id)"
          >
            <svg viewBox="0 0 12 12"><path d="M3 3l6 6M9 3l-6 6" /></svg>
          </button>
        </div>
      }
    </div>
  `,
  styleUrl: './tab-bar.css',
})
export class TabBar {
  protected readonly workspace = inject(WorkspaceService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly startTabId = START_TAB_DOM_ID;
  protected readonly startPanelId = START_PANEL_DOM_ID;
  protected readonly tabId = tabDomId;
  protected readonly panelId = tabPanelDomId;
  /** The tab being dragged. */
  protected readonly dragId = signal<string | null>(null);
  /** Index the dragged tab would be dropped at. */
  protected readonly dropAt = signal<number | null>(null);

  protected dragStart(event: DragEvent, tab: WorkspaceTab): void {
    this.dragId.set(tab.id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', tab.title);
    }
  }

  protected dragOver(event: DragEvent, index: number): void {
    if (this.dragId() === null) return;
    event.preventDefault();
    const target = event.currentTarget as HTMLElement | null;
    const rect = target?.getBoundingClientRect();
    const after = rect && rect.width > 0 && event.clientX > rect.left + rect.width / 2;
    this.dropAt.set(after ? index + 1 : index);
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  protected drop(event: DragEvent): void {
    const id = this.dragId();
    const at = this.dropAt();
    if (id === null || at === null) return;
    event.preventDefault();
    const from = this.workspace.tabs().findIndex((t) => t.id === id);
    // Dropping after itself: positions to the right shift left once the tab is taken out.
    this.workspace.move(id, at > from ? at - 1 : at);
    this.dragEnd();
  }

  protected dragEnd(): void {
    this.dragId.set(null);
    this.dropAt.set(null);
  }

  protected auxClose(event: MouseEvent, tab: WorkspaceTab): void {
    if (event.button !== 1) return;
    event.preventDefault();
    this.closeTab(tab.id);
  }

  /**
   * Closes the tab `id`. When it was the selected tab or focus was in the strip, focus moves to the
   * newly selected tab (or "Start"), so it is not lost with the removed element.
   */
  protected closeTab(id: string): void {
    const wasActive = this.workspace.activeId() === id;
    const hadFocus = this.hasFocus();
    if (this.workspace.close(id) && (wasActive || hadFocus)) this.focusSelected();
  }

  /**
   * Closes the active tab (Ctrl/Cmd+W). Focus moves to the newly selected tab only when it was in
   * the strip (e.g. on the closed tab); focus elsewhere stays where it is.
   */
  closeActive(): void {
    const hadFocus = this.hasFocus();
    if (this.workspace.close() && hadFocus) this.focusSelected();
  }

  private hasFocus(): boolean {
    const active = this.host.nativeElement.ownerDocument.activeElement;
    return active !== null && this.host.nativeElement.contains(active);
  }

  /** Arrow keys, Home and End select and focus another tab; Delete closes the focused tab. */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.getAttribute('role') !== 'tab') return;
    // `null` is the "Start" tab.
    const ids: (string | null)[] = [null, ...this.workspace.tabs().map((t) => t.id)];
    const tabId = target.closest<HTMLElement>('[data-testid="tab"]')?.dataset['tabId'] ?? null;
    const index = Math.max(0, ids.indexOf(tabId));
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = (index + 1) % ids.length;
        break;
      case 'ArrowLeft':
        next = (index - 1 + ids.length) % ids.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = ids.length - 1;
        break;
      case 'Delete':
        if (tabId === null) return;
        event.preventDefault();
        this.closeTab(tabId);
        return;
      default:
        return;
    }
    event.preventDefault();
    this.workspace.activate(ids[next] ?? null);
    this.focusSelected();
  }

  /** Focuses the selected tab; its element is already rendered (only the closed tab goes away). */
  private focusSelected(): void {
    const active = this.workspace.activeId();
    const id = active === null ? START_TAB_DOM_ID : tabDomId(active);
    this.host.nativeElement.ownerDocument.getElementById(id)?.focus();
  }
}
