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
/** The latest local choice for a key and how its save went. */
interface Choice {
  request: number;
  value: string;
  state: 'pending' | 'ok' | 'failed';
}
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
  /**
   * Display rule, per key: show the latest local choice while its save is pending or after it
   * succeeded, unless main reported a newer stored value since; otherwise (no choice, or its save
   * failed) show what main reported. Requests to main are numbered in sending order.
   */
  private requests = 0;
  /** Last values known to be stored in main, and per key the request whose answer recorded it. */
  private readonly confirmed: Required<ThemeSettings> = {
    style: DEFAULT_STYLE,
    mode: DEFAULT_MODE,
  };
  private readonly confirmedBy: Record<ThemeKey, number> = { style: 0, mode: 0 };
  private readonly latest: Partial<Record<ThemeKey, Choice>> = {};

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

    const request = ++this.requests;
    try {
      const { settings } = await this.api.request('app.settings.get', {});
      this.record(settings, request);
    } catch {
      // No desktop bridge (ng serve, tests) or main unavailable: keep the defaults.
    }
    this.refresh();
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
    const request = ++this.requests;
    const mine: Choice[] = [];
    for (const key of THEME_KEYS) {
      const value = patch[key];
      if (value === undefined) continue;
      const choice: Choice = { request, value, state: 'pending' };
      this.latest[key] = choice;
      mine.push(choice);
    }
    this.refresh();
    try {
      const { settings } = await this.api.request('app.settings.set', { settings: patch });
      for (const choice of mine) choice.state = 'ok';
      this.record(settings, request);
    } catch (error) {
      // Not persisted: show what is stored again, so the UI does not pretend it was saved.
      for (const choice of mine) choice.state = 'failed';
      throw error;
    } finally {
      this.refresh();
    }
  }

  /**
   * Records the values in answer number `request` (`app.settings.get/set`) as stored, per key
   * unless a newer answer was already recorded (an older answer may arrive late).
   */
  private record(settings: ThemeSettings, request: number): void {
    const valid = this.valid(settings);
    for (const key of THEME_KEYS) {
      if (valid[key] === undefined || request <= this.confirmedBy[key]) continue;
      Object.assign(this.confirmed, { [key]: valid[key] });
      this.confirmedBy[key] = request;
    }
  }

  /** Takes values known to be stored from a broadcast (`app.settings.changed`). */
  private take(settings: ThemeSettings): void {
    Object.assign(this.confirmed, this.valid(settings));
    this.refresh();
  }

  /** Shows, per key, the latest choice or the stored value (the display rule above). */
  private refresh(): void {
    const shown: ThemeSettings = {};
    for (const key of THEME_KEYS) {
      const choice = this.latest[key];
      const keep = choice && choice.state !== 'failed' && choice.request > this.confirmedBy[key];
      Object.assign(shown, { [key]: keep ? choice.value : this.confirmed[key] });
    }
    this.show(shown);
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
