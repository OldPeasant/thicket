import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

import { expect, test } from './harness';

/** Where the screenshots go (git-ignored; copied into reviews/ for a review). */
const SHOTS = process.env['THICKET_SCREENSHOTS'] ?? join('test-results', 'screenshots');

interface Bridge {
  thicket: { request(r: unknown): Promise<{ ok: boolean }> };
}

/** The root tsconfig has no DOM lib: the page is reached through `globalThis`. */
interface Doc {
  documentElement: unknown;
  querySelector(s: string): unknown;
  fonts: { ready: Promise<unknown> };
}
interface Win {
  document: Doc;
  location: { hash: string };
  getComputedStyle(
    el: unknown,
    pseudo?: string,
  ): {
    getPropertyValue(p: string): string;
    boxShadow: string;
    borderTopColor: string;
    backgroundColor: string;
  };
}

async function setSettings(window: Page, settings: Record<string, unknown>): Promise<void> {
  const result = await window.evaluate(
    (s) =>
      (globalThis as unknown as Bridge).thicket.request({
        id: `set-${Date.now()}`,
        method: 'app.settings.set',
        params: { settings: s },
      }),
    settings,
  );
  expect(result).toMatchObject({ ok: true });
}

/** Colors where the production accent should show, resolved by the browser to rgb(). */
async function accentColors(window: Page) {
  return window.evaluate(() => {
    const w = globalThis as unknown as Win;
    const d = w.document;
    const style = (sel: string, pseudo?: string) => {
      const el = d.querySelector(sel);
      if (!el) throw new Error(`missing ${sel}`);
      return w.getComputedStyle(el, pseudo);
    };
    // Resolve the token through a property the browser normalizes to rgb().
    const probe = style('.dialog.production');
    return {
      production: probe.borderTopColor,
      sidebar: style('[data-testid="sidebar"]').boxShadow,
      statusBar: style('app-status-bar').borderTopColor,
      tab: style('[data-testid="tab"].production', '::after').backgroundColor,
    };
  });
}

for (const [style, mode] of [
  ['business', 'light'],
  ['business', 'dark'],
  ['tron', 'light'],
  ['tron', 'dark'],
] as const) {
  test(`production accent and confirm dialog in ${style} ${mode}`, async ({ window }) => {
    await window.setViewportSize({ width: 1280, height: 800 });
    await setSettings(window, { style, mode });
    const root = window.locator('html');
    await expect(root).toHaveAttribute('data-style', style);
    await expect(root).toHaveAttribute('data-theme', mode);

    await window.evaluate(() => {
      (globalThis as unknown as Win).location.hash = '#/dev/safety';
    });
    const dialog = window.getByTestId('confirm-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveClass(/production/);
    await expect(window.getByTestId('confirm-operation')).toContainText(
      'db.getSiblingDB("shop").getCollection("orders").deleteMany({',
    );
    await expect(window.getByTestId('confirm-operation')).toContainText(
      'ISODate("2025-01-01T00:00:00.000Z")',
    );
    await expect(window.getByTestId('confirm-production')).toHaveText('Production');
    await expect(window.getByTestId('confirm-ok')).toBeDisabled();
    await expect(window.locator('app-shell')).toHaveClass(/production/);
    await expect(window.locator('app-status-bar')).toHaveClass(/production/);

    const colors = await accentColors(window);
    expect(colors.production).toMatch(/^rgb/);
    expect(colors.sidebar).toContain(colors.production);
    expect(colors.statusBar).toBe(colors.production);
    expect(colors.tab).toBe(colors.production);

    await window.evaluate(async () => {
      await (globalThis as unknown as Win).document.fonts.ready;
    });
    await window.waitForTimeout(400);
    await mkdir(SHOTS, { recursive: true });
    await window.screenshot({ path: join(SHOTS, `safety-${style}-${mode}.png`) });

    // Typing the collection name enables the button; cancel closes the dialog.
    await window.getByTestId('confirm-type').fill('orders');
    await expect(window.getByTestId('confirm-ok')).toBeEnabled();
    await window.screenshot({ path: join(SHOTS, `safety-${style}-${mode}-typed.png`) });
    await window.getByTestId('confirm-cancel').click();
    await expect(dialog).toBeHidden();
    // The accent without the dialog's backdrop.
    await window.waitForTimeout(200);
    await window.screenshot({ path: join(SHOTS, `safety-${style}-${mode}-accent.png`) });
  });
}
