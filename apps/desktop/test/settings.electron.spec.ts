import type { Event, Request, Response } from '@thicket/contract';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ElectronApplication, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { launchApp, type TestWindow } from './helpers';

type SettingsWindow = TestWindow & { settingsEvents: Event[] };

let userData: string;
let app: ElectronApplication | undefined;
let page: Page;
const output: string[] = [];

async function start(): Promise<void> {
  app = await launchApp(output, { THICKET_USER_DATA: userData });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
}

function call(request: Request): Promise<Response> {
  return page.evaluate((r) => (window as unknown as TestWindow).thicket.request(r), request);
}

beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'thicket-userdata-'));
  await start();
});

afterAll(async () => {
  await app?.close();
  await rm(userData, { recursive: true, force: true });
});

describe('settings in the running app', () => {
  it('uses THICKET_USER_DATA as userData', async () => {
    const dir = await app?.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
    expect(dir).toBe(userData);
  });

  it('app.settings.get answers the defaults on a fresh profile', async () => {
    const answer = await call({ id: 'g1', method: 'app.settings.get', params: {} });
    expect(answer).toMatchObject({
      ok: true,
      result: { settings: { style: 'business', mode: 'system', pageSize: 50 } },
    });
  });

  it('the renderer gets app.settings.changed after app.settings.set', async () => {
    await page.evaluate(() => {
      const w = window as unknown as SettingsWindow;
      w.settingsEvents = [];
      w.thicket.on('app.settings.changed', (event) => w.settingsEvents.push(event));
    });
    const answer = await call({
      id: 's1',
      method: 'app.settings.set',
      params: { settings: { style: 'tron', pageSize: 100 } },
    });
    expect(answer).toMatchObject({
      ok: true,
      result: { settings: { style: 'tron', pageSize: 100 } },
    });
    await expect
      .poll(
        () => page.evaluate(() => (window as unknown as SettingsWindow).settingsEvents.length),
        {
          timeout: 5_000,
        },
      )
      .toBe(1);
    const [event] = await page.evaluate(() => (window as unknown as SettingsWindow).settingsEvents);
    expect(event).toMatchObject({
      stream: 'app.settings.changed',
      kind: 'data',
      payload: { settings: { style: 'tron', pageSize: 100, mode: 'system' } },
    });

    const file = JSON.parse(
      await readFile(path.join(userData, 'settings.json'), 'utf8'),
    ) as unknown;
    expect(file).toMatchObject({ version: 1, settings: { style: 'tron', pageSize: 100 } });
  });

  it('invalid settings are refused and change nothing', async () => {
    const answer = await call({
      id: 's2',
      method: 'app.settings.set',
      params: { settings: { pageSize: 30 } },
    });
    expect(answer).toMatchObject({ ok: false, error: { code: 'INVALID_PARAMS' } });
    const events = await page.evaluate(
      () => (window as unknown as SettingsWindow).settingsEvents.length,
    );
    expect(events).toBe(1);
  });

  it('settings survive a restart of the app', async () => {
    await app?.close();
    app = undefined;
    await start();
    const answer = await call({ id: 'g2', method: 'app.settings.get', params: {} });
    expect(answer).toMatchObject({
      ok: true,
      result: { settings: { style: 'tron', pageSize: 100 } },
    });
  });
});
