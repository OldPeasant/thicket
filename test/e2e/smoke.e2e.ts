import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, realUserDataDir, test } from './harness';

test('the main window opens with the title Thicket', async ({ window }) => {
  await expect(window).toHaveTitle('Thicket');
  expect(window.url()).toMatch(/^thicket:\/\/app\//);
});

test('the app uses the fresh temporary userData folder, not the real one', async ({
  electronApp,
  window,
  userDataDir,
}) => {
  const paths = await electronApp.evaluate(({ app }) => ({
    userData: app.getPath('userData'),
    appData: app.getPath('appData'),
    name: app.getName(),
  }));
  expect(paths.userData).toBe(userDataDir);
  // The harness's idea of the real folder (checked unchanged after every test) is Electron's own.
  expect(realUserDataDir()).toBe(join(paths.appData, paths.name));

  // Something is written there: a settings change goes to settings.json in the temp folder.
  const result = await window.evaluate(() =>
    (
      window as unknown as {
        thicket: { request(r: unknown): Promise<{ ok: boolean }> };
      }
    ).thicket.request({
      id: 's1',
      method: 'app.settings.set',
      params: { settings: { pageSize: 100 } },
    }),
  );
  expect(result).toMatchObject({ ok: true });
  await expect.poll(() => readdir(userDataDir)).toContain('settings.json');
});

let previousUserDataDir: string | undefined;
for (const run of [1, 2]) {
  test(`every test gets its own empty userData folder (${run})`, async ({ userDataDir }) => {
    expect(userDataDir).not.toBe(previousUserDataDir);
    expect(await readdir(userDataDir)).toEqual([]);
    previousUserDataDir = userDataDir;
  });
}
