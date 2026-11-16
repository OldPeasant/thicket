import type { Routes } from '@angular/router';

import { AppShell } from './layout/app-shell';
import { PlannedPage } from './layout/planned-page';
import { Welcome } from './layout/welcome';

/**
 * Hash-based routes (`index.html#/dev/explorer`): the built renderer is loaded with Electron's
 * `loadFile`, where path-based URLs would point at files. The main window layout (`AppShell`)
 * shows the child routes when no tab is active.
 */
export const routes: Routes = [
  {
    // Development page for the copied JSON Canopy explorer, on its demo document.
    path: 'dev/explorer',
    title: 'Explorer demo · Thicket',
    loadComponent: () => import('./dev/explorer-demo').then((m) => m.ExplorerDemo),
  },
  {
    path: '',
    component: AppShell,
    children: [
      { path: '', pathMatch: 'full', component: Welcome, title: 'Thicket' },
      // Placeholders until connection-ui and profiles-import-export build these pages.
      {
        path: 'connections/new',
        component: PlannedPage,
        title: 'New connection · Thicket',
        data: { heading: 'New connection' },
      },
      {
        path: 'connections/import/compass',
        component: PlannedPage,
        title: 'Import from Compass · Thicket',
        data: { heading: 'Import from Compass' },
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
