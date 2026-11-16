import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { BROADCAST_STREAMS, SIDEBAR_WIDTH } from '@thicket/contract';

import { ApiService } from '../api/api.service';

/** `width` rounded and clamped to the allowed sidebar widths. */
export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_WIDTH.default;
  return Math.max(SIDEBAR_WIDTH.min, Math.min(SIDEBAR_WIDTH.max, Math.round(width)));
}

/**
 * The sidebar width, persisted in the app settings (`sidebarWidth`). `preview()` changes it while
 * dragging without saving; `commit()` saves the current width. Stored values from main
 * (`app.settings.get`, the `app.settings.changed` broadcast) are taken unless a drag is running.
 */
@Injectable({ providedIn: 'root' })
export class SidebarWidthService {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly widthState = signal<number>(SIDEBAR_WIDTH.default);
  private started = false;
  private dragging = false;
  /** Last width known to be stored in main (no save needed when it is unchanged). */
  private stored: number = SIDEBAR_WIDTH.default;

  readonly width = this.widthState.asReadonly();

  /** Loads the stored width and follows changes. Never rejects (keeps the default). */
  async init(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const sub = this.api
      .broadcasts(BROADCAST_STREAMS.settingsChanged)
      .subscribe((event) => this.take(event.settings.sidebarWidth));
    this.destroyRef.onDestroy(() => sub.unsubscribe());
    try {
      const { settings } = await this.api.request('app.settings.get', {});
      this.take(settings.sidebarWidth);
    } catch {
      // No desktop bridge (ng serve, tests) or main unavailable: keep the default.
    }
  }

  /** Shows `width` (clamped) without saving it, e.g. while the splitter is dragged. */
  preview(width: number): void {
    this.dragging = true;
    this.widthState.set(clampSidebarWidth(width));
  }

  /** Saves the shown width (or `width`, clamped). A failed save shows the stored width again. */
  async commit(width: number = this.widthState()): Promise<void> {
    this.dragging = false;
    const value = clampSidebarWidth(width);
    this.widthState.set(value);
    if (value === this.stored) return;
    try {
      const { settings } = await this.api.request('app.settings.set', {
        settings: { sidebarWidth: value },
      });
      this.stored = settings.sidebarWidth;
    } catch (error) {
      if (this.widthState() === value) this.widthState.set(this.stored);
      throw error;
    }
  }

  private take(width: number | undefined): void {
    if (typeof width !== 'number') return;
    this.stored = clampSidebarWidth(width);
    if (!this.dragging) this.widthState.set(this.stored);
  }
}
