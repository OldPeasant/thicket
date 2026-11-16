import { Injectable, computed, signal } from '@angular/core';
import { type DateDisplay, displayText } from '../bson-value.util';

// How BSON values are shown: dates in local time (with the zone) or in UTC.
// The search matches the same text that is shown.
@Injectable({ providedIn: 'root' })
export class BsonDisplayService {
  readonly utc = signal(false);
  // IANA zone for local time; undefined is the system zone (tests set one).
  readonly timeZone = signal<string | undefined>(undefined);

  readonly dates = computed<DateDisplay>(() => ({ utc: this.utc(), timeZone: this.timeZone() }));

  toggleUtc(): void {
    this.utc.update((u) => !u);
  }

  text(value: unknown): string {
    return displayText(value, this.dates());
  }
}
