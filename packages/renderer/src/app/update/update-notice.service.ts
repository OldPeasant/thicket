import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { BROADCAST_STREAMS, type ResultOf } from '@thicket/contract';

import { ApiService } from '../api/api.service';

export type UpdateCheck = ResultOf<'app.checkForUpdate'>;

/** How often a running app looks for a new release again. */
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** A newer release to tell the user about. */
export interface AvailableUpdate {
  version: string;
  url: string;
}

/**
 * Looks for a newer Thicket release at start and once a day (`app.checkForUpdate`, answered by
 * main from the GitHub releases API) while the `checkForUpdates` setting is on. With the setting
 * off no check is requested; turning it on checks right away, turning it off hides the notice.
 * Failures are silent: the notice just doesn't show. A dismissed version is not shown again in
 * this window.
 */
@Injectable({ providedIn: 'root' })
export class UpdateNoticeService {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);
  private started = false;
  private enabled = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly found = signal<AvailableUpdate | null>(null);
  private readonly dismissed = signal<ReadonlySet<string>>(new Set());

  /** The release the notice shows, or `null`. */
  readonly available = computed(() => {
    const update = this.found();
    return update && !this.dismissed().has(update.version) ? update : null;
  });

  constructor() {
    void this.init();
    this.destroyRef.onDestroy(() => this.stopTimer());
  }

  /** Reads the setting, checks once if it is on and follows changes. Never rejects. */
  async init(): Promise<void> {
    if (this.started) return;
    this.started = true;
    try {
      const sub = this.api
        .broadcasts(BROADCAST_STREAMS.settingsChanged)
        .subscribe((event) => this.setEnabled(event.settings.checkForUpdates));
      this.destroyRef.onDestroy(() => sub.unsubscribe());
      const { settings } = await this.api.request('app.settings.get', {});
      this.setEnabled(settings.checkForUpdates);
    } catch {
      // No desktop bridge (ng serve, tests) or main unavailable: no notice.
    }
  }

  /** Hides the notice for this version. */
  dismiss(): void {
    const update = this.found();
    if (update) this.dismissed.update((set) => new Set(set).add(update.version));
  }

  private setEnabled(value: unknown): void {
    const on = value === true;
    if (on === this.enabled) return;
    this.enabled = on;
    if (!on) {
      this.stopTimer();
      this.found.set(null);
      return;
    }
    void this.check();
    this.timer = setInterval(() => void this.check(), UPDATE_CHECK_INTERVAL_MS);
  }

  private stopTimer(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async check(): Promise<void> {
    if (!this.enabled) return;
    try {
      const result = await this.api.request('app.checkForUpdate', {});
      // The setting may have been switched off while the request ran.
      if (!this.enabled) return;
      this.found.set(
        result.updateAvailable && result.latest && result.url
          ? { version: result.latest, url: result.url }
          : null,
      );
    } catch {
      // Silent: a failed check shows nothing (and keeps an earlier notice).
    }
  }
}
