import { z } from 'zod';

import { emptyParams } from './common';
import { defineMethods } from './define';

export const STYLES = ['business', 'tron'] as const;
export const THEME_MODES = ['light', 'dark', 'system'] as const;
export const PAGE_SIZES = [20, 50, 100, 500] as const;

/** User settings (`settings.json`). */
export const settings = z.strictObject({
  style: z.enum(STYLES),
  mode: z.enum(THEME_MODES),
  pageSize: z.literal(PAGE_SIZES),
  /** Arrays/objects with more entries page inside a document. */
  nestedPageSize: z.number().int().positive(),
  /** Type of new integer values that fit 32 bits. */
  defaultIntegerType: z.enum(['int32', 'int64', 'double']),
  /** Dates shown in local time or UTC. */
  dateDisplay: z.enum(['local', 'utc']),
  checkForUpdates: z.boolean(),
  schemaSampleSize: z.number().int().positive(),
});

export type Settings = z.infer<typeof settings>;

/** Payload of the `app.settings.changed` broadcast event: the full settings after a change. */
export const settingsChanged = z.object({ settings });

export type SettingsChanged = z.infer<typeof settingsChanged>;

/** Effective theme: settings plus the resolved light/dark mode. */
export const themeInfo = z.object({
  style: z.enum(STYLES),
  mode: z.enum(THEME_MODES),
  effective: z.enum(['light', 'dark']),
});

export type ThemeInfo = z.infer<typeof themeInfo>;

export const appMethods = defineMethods({
  'app.ping': {
    summary: 'Answer from the main process (wiring check)',
    route: 'main',
    params: emptyParams,
    result: z.object({ process: z.literal('main'), version: z.string() }),
  },
  'app.settings.get': {
    summary: 'Current settings',
    route: 'main',
    params: emptyParams,
    result: z.object({ settings }),
  },
  'app.settings.set': {
    summary: 'Change some settings; returns the full result',
    route: 'main',
    params: z.strictObject({ settings: settings.partial() }),
    result: z.object({ settings }),
  },
  'app.theme': {
    summary: 'Effective theme (changes are also broadcast on the `app.theme` stream)',
    route: 'main',
    params: emptyParams,
    result: themeInfo,
  },
  'app.checkForUpdate': {
    summary: 'Look for a newer release on GitHub',
    route: 'main',
    params: emptyParams,
    result: z.object({
      current: z.string(),
      latest: z.string().nullable(),
      updateAvailable: z.boolean(),
      url: z.string().nullable(),
    }),
  },
});
