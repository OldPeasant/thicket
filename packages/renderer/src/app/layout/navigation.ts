/**
 * Router URLs of the pages the layout links to. `importCompass` is the import and export page
 * (Compass file, connection strings, export without secrets).
 */
export const NAV = {
  home: '/',
  connections: '/connections',
  newConnection: '/connections/new',
  importCompass: '/connections/import/compass',
} as const;

/** URL of the connection editor for a saved profile. */
export function editConnectionUrl(profileId: string): string {
  return `/connections/${encodeURIComponent(profileId)}`;
}
