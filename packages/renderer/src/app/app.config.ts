import {
  type ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withHashLocation } from '@angular/router';

import { routes } from './app.routes';
import { CollectionView } from './collection';
import { provideTabView } from './layout';
import { provideTheme } from './theme';

/** Root providers. Zoneless change detection: state lives in signals, no zone.js. */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes, withHashLocation()),
    provideTheme(),
    provideTabView('collection', CollectionView),
  ],
};
