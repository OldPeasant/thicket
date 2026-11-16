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
      // Development page: production accent and the write confirm dialog (safety-ui screenshots).
      {
        path: 'dev/safety',
        title: 'Safety demo · Thicket',
        loadComponent: () => import('./dev/safety-demo').then((m) => m.SafetyDemo),
      },
      // Lazy: the connection pages bring the connection string parser (whatwg-url).
      {
        path: 'connections',
        title: 'Connections · Thicket',
        loadComponent: () =>
          import('./connections/connections-page').then((m) => m.ConnectionsPage),
      },
      {
        path: 'connections/new',
        title: 'New connection · Thicket',
        loadComponent: () =>
          import('./connections/connection-editor').then((m) => m.ConnectionEditor),
      },
      // Placeholder until profiles-import-export builds this page.
      {
        path: 'connections/import/compass',
        component: PlannedPage,
        title: 'Import from Compass · Thicket',
        data: { heading: 'Import from Compass' },
      },
      // Route parameter `id` → the editor's `id` input (`withComponentInputBinding`).
      {
        path: 'connections/:id',
        title: 'Connection · Thicket',
        loadComponent: () =>
          import('./connections/connection-editor').then((m) => m.ConnectionEditor),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
