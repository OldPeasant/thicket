import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

import { expect, launchApp, test } from './harness';

/** Where the layout screenshots go (git-ignored; copied into reviews/ for a review). */
const SHOTS = process.env['THICKET_SCREENSHOTS'] ?? join('test-results', 'screenshots');

interface Bridge {
  thicket: { request(r: unknown): Promise<{ ok: boolean }> };
}

async function setSettings(window: Page, settings: Record<string, unknown>): Promise<void> {
  const result = await window.evaluate(
    (s) =>
      (window as unknown as Bridge).thicket.request({
        id: `set-${Date.now()}`,
        method: 'app.settings.set',
        params: { settings: s },
      }),
    settings,
  );
  expect(result).toMatchObject({ ok: true });
}

test('the main window shows the layout with the welcome screen', async ({ window }) => {
  await expect(window.getByTestId('sidebar')).toBeVisible();
  await expect(window.getByRole('tablist', { name: 'Open tabs' })).toBeVisible();
  await expect(window.getByTestId('status-connection')).toHaveText(/No connection/);
  await expect(window.getByRole('heading', { name: 'Thicket', level: 1 })).toBeVisible();
  await expect(window.getByTestId('welcome-new')).toContainText('New connection');
  await expect(window.getByTestId('welcome-import')).toContainText('Import from Compass');
});

test('welcome buttons navigate to the connection editor and the Compass import', async ({
  window,
}) => {
  await window.getByTestId('welcome-new').click();
  await expect(window).toHaveURL(/#\/connections\/new$/);
  await expect(window.getByTestId('page-heading')).toHaveText('New connection');
  await expect(window.getByTestId('connection-editor')).toBeVisible();
  await window.goBack();
  await expect(window).toHaveURL(/#\/$/);
  await window.getByTestId('welcome-import').click();
  await expect(window).toHaveURL(/#\/connections\/import\/compass$/);
  await expect(window.getByTestId('page-heading')).toHaveText('Import from Compass');
});

test('Ctrl+W does not close the window', async ({ electronApp, window }) => {
  await expect(window.getByTestId('welcome-new')).toBeVisible();
  await window.keyboard.press('Control+w');
  await window.keyboard.press('Meta+w');
  // Give a menu accelerator time to act if it were going to close the window.
  await window.waitForTimeout(500);
  expect(electronApp.windows()).toHaveLength(1);
  expect(window.isClosed()).toBe(false);
  await expect(window.getByTestId('welcome-new')).toBeVisible();
});

test('the sidebar width is dragged, saved and restored after a restart', async ({
  userDataDir,
}) => {
  const first = await launchApp({ userDataDir });
  try {
    const window = await first.firstWindow();
    const splitter = window.getByTestId('splitter');
    await expect(splitter).toHaveAttribute('aria-valuenow', '260');
    const box = await splitter.boundingBox();
    if (!box) throw new Error('splitter has no box');
    const y = box.y + box.height / 2;
    await window.mouse.move(box.x + 2, y);
    await window.mouse.down();
    await window.mouse.move(box.x + 60, y, { steps: 5 });
    await window.mouse.move(box.x + 82, y, { steps: 5 });
    await window.mouse.up();
    await expect(splitter).toHaveAttribute('aria-valuenow', '340');
    await expect
      .poll(async () => (await window.getByTestId('sidebar').boundingBox())?.width)
      .toBe(340);
  } finally {
    await first.close();
  }

  const second = await launchApp({ userDataDir });
  try {
    const window = await second.firstWindow();
    await expect(window.getByTestId('splitter')).toHaveAttribute('aria-valuenow', '340');
    await expect
      .poll(async () => (await window.getByTestId('sidebar').boundingBox())?.width)
      .toBe(340);
  } finally {
    await second.close();
  }
});

for (const [style, mode] of [
  ['business', 'light'],
  ['tron', 'dark'],
] as const) {
  test(`screenshot: layout in ${style} ${mode}`, async ({ window }) => {
    await window.setViewportSize({ width: 1280, height: 800 });
    await setSettings(window, { style, mode });
    const root = window.locator('html');
    await expect(root).toHaveAttribute('data-style', style);
    await expect(root).toHaveAttribute('data-theme', mode);
    await expect(window.getByTestId('welcome-new')).toBeVisible();
    // The root tsconfig has no DOM lib: reach `document` through `globalThis`.
    await window.evaluate(async () => {
      await (globalThis as unknown as { document: { fonts: { ready: Promise<unknown> } } }).document
        .fonts.ready;
    });
    // Let the theme transition settle before the picture.
    await window.waitForTimeout(400);
    await mkdir(SHOTS, { recursive: true });
    await window.screenshot({ path: join(SHOTS, `layout-${style}-${mode}.png`) });
  });
}
