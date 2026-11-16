import { inject, provideAppInitializer, type EnvironmentProviders } from '@angular/core';

import { ThemeService } from './theme.service';

export * from './theme.service';
export * from './theme-switcher';

/**
 * Themes the app from startup. Does not wait for the settings, so a missing or slow main process
 * never blocks the first paint (the defaults are applied synchronously).
 */
export function provideTheme(): EnvironmentProviders {
  return provideAppInitializer(() => {
    void inject(ThemeService).init();
  });
}
