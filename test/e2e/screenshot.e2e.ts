import type { Page } from '@playwright/test';

import { headlessArgs } from './harness/app';
import { capturePageWithRepaint, expect, screenshot, test } from './harness';

// The harness `screenshot()` helper on headless Linux: after each view switch the capture shows
// the new view (a marker drawn in a distinctive colour after the switch) and none times out.
// The app is started without DISPLAY/WAYLAND_DISPLAY, i.e. on Chromium's headless Ozone backend.

const saved: Record<string, string | undefined> = {};
test.beforeAll(() => {
  for (const key of ['DISPLAY', 'WAYLAND_DISPLAY', 'THICKET_TEST_HEADLESS']) {
    saved[key] = process.env[key];
    Reflect.deleteProperty(process.env, key);
  }
});
test.afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = value;
  }
});

type Rgb = [number, number, number];

// The few DOM types the page functions use (test/e2e is type-checked without the DOM lib).
interface El {
  id: string;
  style: { cssText: string; background: string };
}
interface Canvas {
  width: number;
  height: number;
  getContext(kind: '2d'): {
    drawImage(image: Img, x: number, y: number): void;
    getImageData(x: number, y: number, w: number, h: number): { data: Iterable<number> };
  } | null;
}
interface Img {
  src: string;
  width: number;
  height: number;
  decode(): Promise<void>;
}
interface Dom {
  document: {
    body: { appendChild(el: El): void };
    getElementById(id: string): El | null;
    createElement(tag: 'div'): El;
    createElement(tag: 'canvas'): Canvas;
  };
  Image: new () => Img;
  location: { hash: string };
}

const MARKER_HEIGHT = 40;

/** Draws a full-width bar of `rgb` at the top of the page, above everything. */
async function drawMarker(window: Page, rgb: Rgb): Promise<void> {
  await window.evaluate(([r, g, b]) => {
    const doc = (globalThis as unknown as Dom).document;
    let marker = doc.getElementById('e2e-screenshot-marker');
    if (!marker) {
      marker = doc.createElement('div');
      marker.id = 'e2e-screenshot-marker';
      marker.style.cssText =
        'position:fixed;left:0;top:0;right:0;height:40px;z-index:2147483647;pointer-events:none';
      doc.body.appendChild(marker);
    }
    marker.style.background = `rgb(${r}, ${g}, ${b})`;
  }, rgb);
}

/** Size of `png` and the colour of its pixel (x, y), decoded by the renderer's canvas. */
async function pixel(window: Page, png: Buffer, x: number, y: number) {
  return window.evaluate(
    async ({ data, x, y }) => {
      const page = globalThis as unknown as Dom;
      const image = new page.Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = page.document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('no 2d context');
      context.drawImage(image, 0, 0);
      const [r = 0, g = 0, b = 0] = context.getImageData(x, y, 1, 1).data;
      return { width: image.width, height: image.height, rgb: [r, g, b] };
    },
    { data: png.toString('base64'), x, y },
  );
}

/** The view switches of the test: a click, then what shows that the new view is there. */
const STEPS: { name: string; rgb: Rgb; go: (window: Page) => Promise<void> }[] = [
  {
    name: 'connection-editor',
    rgb: [255, 0, 0],
    go: async (window) => {
      await window.getByTestId('welcome-new').click();
      await expect(window.getByTestId('page-heading')).toHaveText('New connection');
    },
  },
  {
    name: 'welcome',
    rgb: [0, 200, 0],
    go: async (window) => {
      await window.evaluate(() => ((globalThis as unknown as Dom).location.hash = '#/'));
      await expect(window.getByTestId('welcome-import')).toBeVisible();
    },
  },
  {
    name: 'compass-import',
    rgb: [0, 0, 255],
    go: async (window) => {
      await window.getByTestId('welcome-import').click();
      await expect(window.getByTestId('welcome-import')).toBeHidden();
    },
  },
  {
    name: 'welcome-again',
    rgb: [255, 0, 255],
    go: async (window) => {
      await window.evaluate(() => ((globalThis as unknown as Dom).location.hash = '#/'));
      await expect(window.getByTestId('welcome-new')).toBeVisible();
    },
  },
  {
    name: 'connection-editor-again',
    rgb: [0, 200, 200],
    go: async (window) => {
      await window.getByTestId('welcome-new').click();
      await expect(window.getByTestId('page-heading')).toHaveText('New connection');
    },
  },
];

test.describe('screenshot() on headless Linux', () => {
  test.skip(process.platform !== 'linux', 'the headless Ozone backend is Linux-only');

  test('the app is started headless with a real screen size', async ({ electronApp }) => {
    expect(headlessArgs()).toContain('--ozone-platform=headless');
    const size = await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.getContentSize(),
    );
    expect(size?.[0]).toBeGreaterThan(100);
    expect(size?.[1]).toBeGreaterThan(100);
  });

  test('each screenshot after a view switch shows the new view', async ({
    electronApp,
    window,
  }, testInfo) => {
    await expect(window.getByTestId('welcome-new')).toBeVisible();
    let previous: Buffer | undefined;
    for (const step of STEPS) {
      await step.go(window);
      await drawMarker(window, step.rgb);
      const started = Date.now();
      const png = await screenshot(electronApp, window, testInfo.outputPath(`${step.name}.png`));
      // Well below Playwright's 5 s screenshot timeout: no capture waited for a frame.
      expect(Date.now() - started, `${step.name}: capture time`).toBeLessThan(4_000);
      const shown = await pixel(window, png, 10, MARKER_HEIGHT / 2);
      expect(shown.width, `${step.name}: width`).toBeGreaterThan(100);
      expect(shown.height, `${step.name}: height`).toBeGreaterThan(100);
      expect(shown.rgb, `${step.name}: marker colour`).toEqual(step.rgb);
      if (previous) expect(png.equals(previous), `${step.name}: differs from before`).toBe(false);
      previous = png;
    }
  });

  test('an element screenshot shows the element in its current state', async ({
    electronApp,
    window,
  }, testInfo) => {
    await window.getByTestId('welcome-new').click();
    // The form's heading (a loading-state heading with the same test id is shown before it).
    const heading = window.locator('.where-heading');
    await expect(heading).toHaveText('New connection');
    await heading.evaluate((el) => ((el as unknown as El).style.background = 'rgb(255, 128, 0)'));
    await expect(heading).toHaveCSS('background-color', 'rgb(255, 128, 0)');
    const png = await screenshot(electronApp, heading, testInfo.outputPath('heading.png'));
    const box = await heading.boundingBox();
    const shown = await pixel(window, png, 1, 1);
    // Only the element: its width, give or take the rounding of fractional CSS pixels.
    expect(Math.abs(shown.width - (box?.width ?? 0))).toBeLessThanOrEqual(1);
    expect(shown.rgb).toEqual([255, 128, 0]);
  });

  test('the repaint fallback captures the current view', async ({ electronApp, window }) => {
    await window.getByTestId('welcome-new').click();
    await expect(window.getByTestId('page-heading')).toHaveText('New connection');
    await drawMarker(window, [255, 255, 0]);
    const png = await capturePageWithRepaint(electronApp, window);
    const shown = await pixel(window, png, 10, MARKER_HEIGHT / 2);
    expect(shown.width).toBeGreaterThan(100);
    expect(shown.rgb).toEqual([255, 255, 0]);
  });
});
