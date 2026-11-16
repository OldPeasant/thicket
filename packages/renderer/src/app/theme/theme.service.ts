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

    try {
      const { settings } = await this.api.request('app.settings.get', {});
      this.take(settings);
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

  private async change(patch: Partial<Pick<Settings, 'style' | 'mode'>>): Promise<void> {
    const before = { style: this.styleState(), mode: this.modeState() };
    this.take(patch);
    try {
      const { settings } = await this.api.request('app.settings.set', { settings: patch });
      this.take(settings);
    } catch (error) {
      // Not persisted: show what is stored again, so the UI does not pretend it was saved.
      this.take(before);
      throw error;
    }
  }

  private take(settings: Partial<Pick<Settings, 'style' | 'mode'>>): void {
    if (settings.style && (STYLES as readonly string[]).includes(settings.style)) {
      this.styleState.set(settings.style);
    }
    if (settings.mode && (THEME_MODES as readonly string[]).includes(settings.mode)) {
      this.modeState.set(settings.mode);
    }
    this.apply();
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
