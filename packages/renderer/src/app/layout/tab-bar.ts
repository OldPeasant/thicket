import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';

import { WorkspaceService, type WorkspaceTab } from './workspace.service';

/**
 * The tab strip: a "Start" tab (welcome screen and other routed pages), then the open tabs.
 * Click selects, the × button or a middle click closes, drag and drop reorders.
 */
@Component({
  selector: 'app-tab-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="strip" role="tablist" aria-label="Open tabs">
      <button
        type="button"
        role="tab"
        class="tab home"
        data-testid="tab-home"
        [attr.aria-selected]="workspace.activeId() === null"
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
            [attr.aria-selected]="tab.id === workspace.activeId()"
            [attr.title]="tab.detail ? tab.title + ' — ' + tab.detail : tab.title"
            (click)="workspace.activate(tab.id)"
          >
            <span class="kind" [attr.data-kind]="tab.kind" aria-hidden="true"></span>
            <span class="title">{{ tab.title }}</span>
            @if (tab.detail) {
              <span class="detail">{{ tab.detail }}</span>
            }
          </button>
          <button
            type="button"
            class="close"
            data-testid="tab-close"
            [attr.aria-label]="'Close ' + tab.title"
            (click)="workspace.close(tab.id)"
          >
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" /></svg>
          </button>
        </div>
      }
    </div>
  `,
  styleUrl: './tab-bar.css',
})
export class TabBar {
  protected readonly workspace = inject(WorkspaceService);
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
    this.workspace.close(tab.id);
  }
}
