import type { ElectronApplication, JSHandle, Locator, Page } from '@playwright/test';
import type { BrowserWindow, NativeImage } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** How long Playwright's own capture may take before the repaint fallback is used. */
const PLAYWRIGHT_TIMEOUT = 5_000;
/** Repaint-and-capture rounds of the fallback; the last capture is kept. */
const REPAINT_ROUNDS = 3;
const REPAINT_WAIT = 400;

/** A rectangle in CSS pixels of the page's viewport. */
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Saves a PNG of `target` (a window's page, or an element in it) to `path` and returns the PNG.
 * Use this instead of `page.screenshot()` / `locator.screenshot()` in the e2e suites.
 *
 * Why: on headless Linux (no DISPLAY, `--ozone-platform=headless`) Chromium only paints when
 * something asks for a frame. Playwright's screenshot waits for a new frame and can hang until its
 * timeout, and `webContents.capturePage()` alone can return the view from before the last click.
 * The harness gives the headless screen a real size (`headlessArgs()`), which on its own lets
 * the window paint. This helper also makes sure the window is not collapsed, asks for a repaint
 * first, and, if Playwright's capture still times out, falls back to invalidating the window in
 * the main process and capturing it several times (keeping the last capture).
 */
export async function screenshot(
  app: ElectronApplication,
  target: Page | Locator,
  path: string,
): Promise<Buffer> {
  const page = isLocator(target) ? target.page() : target;
  const window = await browserWindowOf(app, page);
  // Make sure the window has a real size and ask for a fresh frame.
  await window.evaluate((win) => {
    const [width = 0, height = 0] = win.getContentSize();
    if (width < 100 || height < 100) win.setContentSize(1280, 800);
    win.webContents.invalidate();
  });
  await mkdir(dirname(path), { recursive: true });
  try {
    return await target.screenshot({ path, timeout: PLAYWRIGHT_TIMEOUT });
  } catch (error) {
    if (!(error instanceof Error) || error.name !== 'TimeoutError') throw error;
  }
  const rect = isLocator(target) ? await target.boundingBox() : null;
  const png = await capturePageWithRepaint(app, page, rect ?? undefined);
  await writeFile(path, png);
  return png;
}

/**
 * The window of `page` as a PNG, captured by the main process after forcing repaints:
 * `invalidate()`, wait, `capturePage()`, `REPAINT_ROUNDS` times, keeping the last capture.
 * `rect` limits the capture to a part of the page (CSS pixels).
 */
export async function capturePageWithRepaint(
  app: ElectronApplication,
  page: Page,
  rect?: Rect,
): Promise<Buffer> {
  const window = await browserWindowOf(app, page);
  const base64 = await window.evaluate(
    async (win, { rounds, wait, rect }) => {
      let image: NativeImage | undefined;
      for (let round = 0; round < rounds; round++) {
        win.webContents.invalidate();
        await new Promise((resolve) => setTimeout(resolve, wait));
        image = await win.webContents.capturePage(
          rect
            ? {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              }
            : undefined,
        );
      }
      return image?.toPNG().toString('base64') ?? '';
    },
    { rounds: REPAINT_ROUNDS, wait: REPAINT_WAIT, rect },
  );
  return Buffer.from(base64, 'base64');
}

async function browserWindowOf(app: ElectronApplication, page: Page) {
  return (await app.browserWindow(page)) as JSHandle<BrowserWindow>;
}

function isLocator(target: Page | Locator): target is Locator {
  return !('goto' in target);
}
