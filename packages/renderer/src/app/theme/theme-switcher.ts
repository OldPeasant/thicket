import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { ThemeService, type Style, type ThemeMode } from './theme.service';

/** Style and mode pickers (used by the dev pages now, by the settings page later). */
@Component({
  selector: 'app-theme-switcher',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="field">
      <span>Style</span>
      <select
        data-testid="theme-style"
        [value]="theme.style()"
        (change)="pickStyle($any($event.target).value)"
      >
        @for (s of styles; track s.value) {
          <option [value]="s.value" [selected]="theme.style() === s.value">{{ s.label }}</option>
        }
      </select>
    </label>
    <label class="field">
      <span>Mode</span>
      <select
        data-testid="theme-mode"
        [value]="theme.mode()"
        (change)="pickMode($any($event.target).value)"
      >
        @for (m of modes; track m.value) {
          <option [value]="m.value" [selected]="theme.mode() === m.value">{{ m.label }}</option>
        }
      </select>
    </label>
  `,
  styles: `
    :host {
      display: inline-flex;
      gap: 0.75rem;
      align-items: center;
    }
    .field {
      display: inline-flex;
      gap: 0.375rem;
      align-items: center;
      font-size: 0.75rem;
      color: var(--text-muted);
    }
    select {
      font: inherit;
      color: var(--text);
      background: var(--bg-input);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 0.125rem 0.375rem;
    }
  `,
})
export class ThemeSwitcher {
  protected readonly theme = inject(ThemeService);

  protected readonly styles: { value: Style; label: string }[] = [
    { value: 'business', label: 'Business' },
    { value: 'tron', label: 'Tron' },
  ];

  protected readonly modes: { value: ThemeMode; label: string }[] = [
    { value: 'system', label: 'Follow system' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];

  protected pickStyle(value: Style): void {
    this.theme.setStyle(value).catch((error: unknown) => console.error(error));
  }

  protected pickMode(value: ThemeMode): void {
    this.theme.setMode(value).catch((error: unknown) => console.error(error));
  }
}
