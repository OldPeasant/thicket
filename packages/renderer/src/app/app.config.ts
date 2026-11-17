import {
  type ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withComponentInputBinding, withHashLocation } from '@angular/router';

import { CurrentOpView } from './admin/currentop';
import { ServerStatsView } from './admin/stats';
import { UsersRolesView } from './admin/users';
import { GridfsView } from './gridfs';
import { AggregationView } from './aggregation';
import { routes } from './app.routes';
import { CollectionView } from './collection';
import { ShellConsole } from './console';
import { IndexesView } from './indexes';
import { ValidatorView } from './validator';
import { provideTabView } from './layout';
import { provideTheme } from './theme';

/** Root providers. Zoneless change detection: state lives in signals, no zone.js. */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes, withHashLocation(), withComponentInputBinding()),
    provideTheme(),
    provideTabView('collection', CollectionView),
    provideTabView('aggregation', AggregationView),
    provideTabView('indexes', IndexesView),
    provideTabView('users', UsersRolesView),
    provideTabView('gridfs', GridfsView),
    provideTabView('currentop', CurrentOpView),
    provideTabView('serverstats', ServerStatsView),
    provideTabView('shell', ShellConsole),
    provideTabView('validator', ValidatorView),
  ],
};
