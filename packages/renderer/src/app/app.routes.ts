import type { Routes } from '@angular/router';

import { Home } from './home';

/**
 * Hash-based routes (`index.html#/dev/explorer`): the built renderer is loaded with Electron's
 * `loadFile`, where path-based URLs would point at files.
 */
export const routes: Routes = [
  { path: '', component: Home, title: 'Thicket' },
  {
    // Development page for the copied JSON Canopy explorer, on its demo document.
    path: 'dev/explorer',
    title: 'Explorer demo · Thicket',
    loadComponent: () => import('./dev/explorer-demo').then((m) => m.ExplorerDemo),
  },
  { path: '**', redirectTo: '' },
];
