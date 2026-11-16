import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { BROADCAST_STREAMS } from '@thicket/contract';

import { ApiService } from '../../api/api.service';
import { type BsonLeafValue } from '../bson-value.util';
import { type IntegerDefault, newNumber } from '../bson-input.util';

const INTEGER_DEFAULTS: readonly string[] = ['int32', 'int64', 'double'];

/**
 * The BSON type of new numbers typed where no type was chosen, from the
 * `defaultIntegerType` app setting (Int32 until the settings arrive, and in a
 * plain browser without the desktop bridge). Follows `app.settings.changed`.
 */
@Injectable({ providedIn: 'root' })
export class NumberDefaultService {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);
  private started = false;

  readonly integers = signal<IntegerDefault>('int32');

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
        .subscribe((event) => this.take(event.settings.defaultIntegerType));
      this.destroyRef.onDestroy(() => sub.unsubscribe());
      const { settings } = await this.api.request('app.settings.get', {});
      this.take(settings.defaultIntegerType);
    } catch {
      // No desktop bridge (ng serve, tests) or main unavailable: keep the default.
    }
  }

  /** The BSON value of a new number `n`. */
  newNumber(n: number): BsonLeafValue {
    return newNumber(n, this.integers());
  }

  private take(value: unknown): void {
    if (typeof value === 'string' && INTEGER_DEFAULTS.includes(value)) {
      this.integers.set(value as IntegerDefault);
    }
  }
}
