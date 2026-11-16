import { Injectable, computed, signal, type Signal } from '@angular/core';

import type { SafetyProfile } from './safety.types';

/**
 * The read-only and production flags of the known profiles. The connection UI registers a
 * profile when it is loaded or changed (`set`); write controls bind to `readOnly(id)` and views to
 * `production(id)`, so a flag change updates every control at once. Unknown profiles count as
 * neither (the backend still refuses writes on read-only profiles).
 */
@Injectable({ providedIn: 'root' })
export class ProfileSafetyService {
  private readonly profiles = signal<ReadonlyMap<string, SafetyProfile>>(new Map());
  private readonly readOnlyCache = new Map<string, Signal<boolean>>();
  private readonly productionCache = new Map<string, Signal<boolean>>();

  /** Registers or updates a profile's flags. */
  set(profile: SafetyProfile): void {
    this.profiles.update((map) => new Map(map).set(profile.id, { ...profile }));
  }

  /** Forgets a profile (deleted). */
  remove(id: string): void {
    this.profiles.update((map) => {
      if (!map.has(id)) return map;
      const next = new Map(map);
      next.delete(id);
      return next;
    });
  }

  /** The profile's flags, or `null` when unknown. */
  get(id: string): SafetyProfile | null {
    return this.profiles().get(id) ?? null;
  }

  /** `true` while the profile is read-only: bind write controls' `disabled` to it. */
  readOnly(id: string): Signal<boolean> {
    let flag = this.readOnlyCache.get(id);
    if (!flag) {
      flag = computed(() => this.profiles().get(id)?.readOnly ?? false);
      this.readOnlyCache.set(id, flag);
    }
    return flag;
  }

  /** `true` while the profile is a production connection (red accent, confirm every write). */
  production(id: string): Signal<boolean> {
    let flag = this.productionCache.get(id);
    if (!flag) {
      flag = computed(() => this.profiles().get(id)?.production ?? false);
      this.productionCache.set(id, flag);
    }
    return flag;
  }
}
