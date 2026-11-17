import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { BROADCAST_STREAMS } from '@thicket/contract';

import { ApiService } from '../../api/api.service';
import { DEFAULT_NESTED_PAGE_SIZE } from '../page.util';

/**
 * Entries per page of a large array or object inside a document, from the
 * `nestedPageSize` app setting (100 until the settings arrive, and in a plain
 * browser without the desktop bridge). Follows `app.settings.changed`.
 */
@Injectable({ providedIn: 'root' })
export class NestedPageSizeService {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);
  private started = false;

  readonly size = signal(DEFAULT_NESTED_PAGE_SIZE);

  constructor() {
    void this.init();
  }

  /** Loads the setting and follows changes. Never rejects (keeps the default). */
  async init(): Promise<void> {
    if (this.started) return;
    this.started = true;
    try {
      const sub = this.api
        .broadcasts(BROADCAST_STREAMS.settingsChanged)
        .subscribe((event) => this.take(event.settings.nestedPageSize));
      this.destroyRef.onDestroy(() => sub.unsubscribe());
      const { settings } = await this.api.request('app.settings.get', {});
      this.take(settings.nestedPageSize);
    } catch {
      // No desktop bridge (ng serve, tests) or main unavailable: keep the default.
    }
  }

  private take(value: unknown): void {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) this.size.set(value);
  }
}
