import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import {
  BROADCAST_STREAMS,
  STYLES,
  THEME_MODES,
  type Settings,
  type SettingsChanged,
} from '@thicket/contract';

import { ApiService } from '../api/api.service';

export type Style = (typeof STYLES)[number];
export type ThemeMode = (typeof THEME_MODES)[number];
export type EffectiveMode = Exclude<ThemeMode, 'system'>;

type ThemeSettings = Partial<Pick<Settings, 'style' | 'mode'>>;
type ThemeKey = keyof ThemeSettings;
type Generations = Record<ThemeKey, number>;
const THEME_KEYS: readonly ThemeKey[] = ['style', 'mode'];

/** Defaults until the settings arrive (and in a plain browser without the desktop bridge). */
export const DEFAULT_STYLE: Style = 'business';
export const DEFAULT_MODE: ThemeMode = 'system';

/** Media query whose changes `system` mode follows. */
export const DARK_QUERY = '(prefers-color-scheme: dark)';

/** The light/dark variant to show for `mode`, given whether the OS prefers dark. */
export function resolveMode(mode: ThemeMode, systemDark: boolean): EffectiveMode {
  if (mode === 'system') return systemDark ? 'dark' : 'light';
  return mode;
}

/**
 * Applies the visual style (Business/Tron) and mode (light/dark/system) by setting `data-style`
 * and `data-theme` on <html>; app/theme/tokens.css does the rest, so switching needs no reload.
 * The choice is persisted through the app settings (`app.settings.get/set`, kept in sync by the
 * `app.settings.changed` broadcast); `system` follows `prefers-color-scheme` changes live.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly api = inject(ApiService);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  private readonly styleState = signal<Style>(DEFAULT_STYLE);
  private readonly modeState = signal<ThemeMode>(DEFAULT_MODE);
  private readonly systemDark = signal(false);
  private started = false;
  /** Last values known to be stored in main; a failed save shows these again. */
  private readonly confirmed: Required<ThemeSettings> = {
    style: DEFAULT_STYLE,
    mode: DEFAULT_MODE,
  };
  /** Per key: how many local choices were made, and how many saves are still on their way. */
  private readonly generation: Generations = { style: 0, mode: 0 };
  private readonly inFlight: Generations = { style: 0, mode: 0 };
  /** Per key: the generation of the latest local choice whose save failed (0: none). */
  private readonly failed: Generations = { style: 0, mode: 0 };
  /**
   * Requests to main are numbered in sending order (main answers them in that order). Per key, the
   * number of the request whose answer `confirmed` holds, so an older answer arriving late does
   * not overwrite it.
   */
  private requests = 0;
  private readonly confirmedBy: Generations = { style: 0, mode: 0 };

  readonly style = this.styleState.asReadonly();
  readonly mode = this.modeState.asReadonly();
  readonly effective = computed(() => resolveMode(this.modeState(), this.systemDark()));

  /**
   * Starts following the OS preference and the settings; applies the defaults right away so the
   * first paint is themed. Resolves once the stored settings were applied (or could not be read).
   */
  async init(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.watchSystem();
    this.apply();

    const sub = this.api
      .broadcasts(BROADCAST_STREAMS.settingsChanged)
      .subscribe((event: SettingsChanged) => this.take(event.settings));
    this.destroyRef.onDestroy(() => sub.unsubscribe());

    const asked = { ...this.generation };
    const request = ++this.requests;
    try {
      const { settings } = await this.api.request('app.settings.get', {});
      // A choice made while the answer was on its way is newer than what main read.
      this.takeAnswer(settings, request, asked, []);
    } catch {
      // No desktop bridge (ng serve, tests) or main unavailable: keep the defaults.
    }
  }

  /** Switches the style now and persists it. */
  setStyle(style: Style): Promise<void> {
    return this.change({ style });
  }

  /** Switches the mode now and persists it. */
  setMode(mode: ThemeMode): Promise<void> {
    return this.change({ mode });
  }

  private async change(patch: ThemeSettings): Promise<void> {
    const keys = THEME_KEYS.filter((key) => patch[key] !== undefined);
    for (const key of keys) {
      this.generation[key] += 1;
      this.inFlight[key] += 1;
    }
    const mine = { ...this.generation };
    const request = ++this.requests;
    this.show(patch);
    try {
      const { settings } = await this.api.request('app.settings.set', { settings: patch });
      this.takeAnswer(settings, request, mine, keys);
    } catch (error) {
      // Not persisted: show what is stored again, so the UI does not pretend it was saved. Only the
      // keys this call changed, and only while nothing newer was chosen for them.
      const revert: ThemeSettings = {};
      for (const key of keys) {
        if (this.generation[key] !== mine[key]) continue;
        // Answers still on their way show the value they confirm (see takeAnswer).
        this.failed[key] = mine[key];
        if (this.current()[key] === patch[key]) {
          Object.assign(revert, { [key]: this.confirmed[key] });
        }
      }
      this.show(revert);
      throw error;
    } finally {
      for (const key of keys) this.inFlight[key] -= 1;
    }
  }

  /**
   * Applies answer number `request` from main (`app.settings.get/set`), requested when the local
   * generations were `asked`. Its values are always recorded as stored (unless a later answer was
   * already recorded), so a later failed save reverts to what main really holds. A key is shown
   * only if no newer local choice was made for it since and no other save of it is still on its
   * way (unless this answer is for the latest save of that key). If the newer choice failed and no
   * other save of the key is pending, the stored value is shown again.
   */
  private takeAnswer(
    settings: ThemeSettings,
    request: number,
    asked: Generations,
    own: readonly ThemeKey[],
  ): void {
    const valid = this.valid(settings);
    const shown: ThemeSettings = {};
    for (const key of THEME_KEYS) {
      if (valid[key] !== undefined && request > this.confirmedBy[key]) {
        Object.assign(this.confirmed, { [key]: valid[key] });
        this.confirmedBy[key] = request;
      }
      const othersInFlight = this.inFlight[key] - (own.includes(key) ? 1 : 0);
      if (this.generation[key] === asked[key]) {
        if (own.includes(key) || othersInFlight === 0) Object.assign(shown, { [key]: valid[key] });
      } else if (this.failed[key] === this.generation[key] && othersInFlight === 0) {
        Object.assign(shown, { [key]: this.confirmed[key] });
      }
    }
    this.show(shown);
  }

  /** Takes values known to be stored (answers and broadcasts from main). */
  private take(settings: ThemeSettings): void {
    const valid = this.valid(settings);
    Object.assign(this.confirmed, valid);
    this.show(valid);
  }

  /** Shows `settings` without recording them as stored. */
  private show(settings: ThemeSettings): void {
    const valid = this.valid(settings);
    if (valid.style) this.styleState.set(valid.style);
    if (valid.mode) this.modeState.set(valid.mode);
    this.apply();
  }

  private valid(settings: ThemeSettings): ThemeSettings {
    const valid: ThemeSettings = {};
    if (settings.style && (STYLES as readonly string[]).includes(settings.style)) {
      valid.style = settings.style;
    }
    if (settings.mode && (THEME_MODES as readonly string[]).includes(settings.mode)) {
      valid.mode = settings.mode;
    }
    return valid;
  }

  private current(): Required<ThemeSettings> {
    return { style: this.styleState(), mode: this.modeState() };
  }

  private watchSystem(): void {
    const view = this.document.defaultView;
    if (!view || typeof view.matchMedia !== 'function') return;
    const query = view.matchMedia(DARK_QUERY);
    this.systemDark.set(query.matches);
    const onChange = (event: MediaQueryListEvent): void => {
      this.systemDark.set(event.matches);
      this.apply();
    };
    query.addEventListener('change', onChange);
    this.destroyRef.onDestroy(() => query.removeEventListener('change', onChange));
  }

  private apply(): void {
    const root = this.document.documentElement;
    root.setAttribute('data-style', this.styleState());
    root.setAttribute('data-theme', this.effective());
  }
}
