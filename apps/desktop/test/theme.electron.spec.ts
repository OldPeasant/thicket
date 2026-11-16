// Styles and modes in the running app: the explorer demo (#/dev/explorer) in all four
// combinations, switched through the UI without reload, `system` following the OS preference,
// persisted in settings.json. Screenshots go to THICKET_SCREENSHOTS (default:
// apps/desktop/test-results/screenshots, git-ignored, kept so they can be attached to a review).
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ElectronApplication, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { appDir, launchApp } from './helpers';

type MarkedWindow = typeof globalThis & { noReloadMarker?: string };

let userData: string;
let shots: string;
let app: ElectronApplication | undefined;
let page: Page;
const output: string[] = [];

async function start(): Promise<void> {
  app = await launchApp(output, { THICKET_USER_DATA: userData });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => {
    location.hash = '#/dev/explorer';
  });
  await page.waitForSelector('app-json-explorer');
}

/** data-style / data-theme on <html>, plus a few computed results of the tokens. */
function look(): Promise<{
  style: string | null;
  theme: string | null;
  bg: string;
  font: string;
  overlay: string;
  production: string;
  bsonObjectId: string;
}> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const css = getComputedStyle(root);
    return {
      style: root.getAttribute('data-style'),
      theme: root.getAttribute('data-theme'),
      bg: getComputedStyle(document.body).backgroundColor,
      font: getComputedStyle(document.body).fontFamily,
      overlay: getComputedStyle(document.body, '::before').backgroundImage,
      production: css.getPropertyValue('--production').trim(),
      bsonObjectId: css.getPropertyValue('--bson-object-id').trim(),
    };
  });
}

async function pick(style: string, mode: string): Promise<void> {
  await page.selectOption('[data-testid=theme-style]', style);
  await page.selectOption('[data-testid=theme-mode]', mode);
  await page.waitForFunction(
    ([s, m]) =>
      document.documentElement.getAttribute('data-style') === s &&
      document.documentElement.getAttribute('data-theme') === m,
    [style, mode],
  );
}

beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'thicket-theme-'));
  shots = process.env['THICKET_SCREENSHOTS'] ?? path.join(appDir, 'test-results', 'screenshots');
  await mkdir(shots, { recursive: true });
  await start();
});

afterAll(async () => {
  await app?.close();
  await rm(userData, { recursive: true, force: true });
});

describe('themes in the running app', () => {
  it('starts in Business (the default), mode following the OS', async () => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForFunction(() => document.documentElement.dataset['theme'] === 'light');
    const now = await look();
    expect(now.style).toBe('business');
    expect(now.overlay).toMatch(/^none(, none)*$/);
    expect(now.font).toMatch(/^system-ui/);
  });

  it('renders the explorer demo in all four combinations, switched without reload', async () => {
    await page.evaluate(() => {
      (window as MarkedWindow).noReloadMarker = 'still here';
    });
    const seen = new Map<string, Awaited<ReturnType<typeof look>>>();
    for (const style of ['business', 'tron']) {
      for (const mode of ['light', 'dark']) {
        await pick(style, mode);
        // Tron fonts come from the app bundle (font-src 'self'), wait until they are in use.
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        const now = await look();
        seen.set(`${style}/${mode}`, now);
        expect(now.production, `${style}/${mode} --production`).toMatch(/^#[0-9a-f]{6}$/);
        expect(now.bsonObjectId, `${style}/${mode} --bson-object-id`).toMatch(/^#[0-9a-f]{6}$/);
        if (style === 'tron') {
          expect(now.font).toMatch(/^Orbitron/);
          expect(now.overlay).toMatch(/linear-gradient/);
          const loaded = await page.evaluate(() =>
            [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family),
          );
          expect(loaded).toEqual(expect.arrayContaining(['Orbitron', 'Share Tech Mono']));
        } else {
          expect(now.font).toMatch(/^system-ui/);
          expect(now.overlay).toMatch(/^none(, none)*$/);
        }
        // Controls fade between themes (CSS transitions): shoot the final colors, not a mix.
        await page.evaluate(() =>
          Promise.all(document.getAnimations().map((a) => a.finished)).then(() => undefined),
        );
        await page.screenshot({
          path: path.join(shots, `explorer-${style}-${mode}.png`),
          animations: 'disabled',
        });
      }
    }
    // Four different page backgrounds, and the page was never reloaded.
    expect(new Set([...seen.values()].map((s) => s.bg)).size).toBe(4);
    expect(await page.evaluate(() => (window as MarkedWindow).noReloadMarker)).toBe('still here');
  });

  it('system mode follows prefers-color-scheme changes live', async () => {
    await pick('business', 'light');
    await page.selectOption('[data-testid=theme-mode]', 'system');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(() => document.documentElement.dataset['theme'] === 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForFunction(() => document.documentElement.dataset['theme'] === 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(() => document.documentElement.dataset['theme'] === 'dark');
    expect((await look()).theme).toBe('dark');
  });

  it('persists the choice in settings.json and applies it after a restart', async () => {
    await pick('tron', 'light');
    await expect
      .poll(async () => {
        const file = JSON.parse(await readFile(path.join(userData, 'settings.json'), 'utf8')) as {
          settings: { style: string; mode: string };
        };
        return file.settings;
      })
      .toMatchObject({ style: 'tron', mode: 'light' });

    await app?.close();
    await start();
    await page.waitForFunction(() => document.documentElement.dataset['style'] === 'tron');
    expect(await look()).toMatchObject({ style: 'tron', theme: 'light' });
  });
});
