import type { Request, Response } from '@thicket/contract';
import type { ElectronApplication, Page } from 'playwright-core';
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { launchApp, type TestWindow } from './helpers';

/*
 * The real `safeStorage` on Linux without a keyring: `--password-store=basic` forces Electron's
 * `basic_text` backend. `--user-data-dir` keeps `secrets.bin` in a temp folder, never in the
 * developer's real profile. All secret values are fictitious.
 */
const linuxOnly = process.platform === 'linux' ? describe : describe.skip;

linuxOnly('secrets with the real safeStorage on basic_text (Linux)', () => {
  const SECRET = 'fictitious-Electron-Secret-0815';
  let app: ElectronApplication;
  let page: Page;
  let userData: string;
  const output: string[] = [];

  function call(request: Request): Promise<Response> {
    return page.evaluate((r) => (window as unknown as TestWindow).thicket.request(r), request);
  }

  beforeAll(async () => {
    userData = await realpath(await mkdtemp(path.join(tmpdir(), 'thicket-electron-secrets-')));
    app = await launchApp(output, {}, ['--password-store=basic', `--user-data-dir=${userData}`]);
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
  });

  afterAll(async () => {
    await app?.close();
    if (userData) await rm(userData, { recursive: true, force: true });
  });

  it('uses the temp user data folder (guard for the tests below)', async () => {
    const actual = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
    expect(actual).toBe(userData);
  });

  it('profiles.secretStorage reports weak basic_text and defaultSecretMode ask', async () => {
    const answer = await call({ id: 'st', method: 'profiles.secretStorage', params: {} });
    expect(answer).toEqual({
      id: 'st',
      ok: true,
      result: { level: 'weak', backend: 'basic_text', defaultSecretMode: 'ask' },
    });
  });

  it('setSecret still saves (secureStorage: false), encrypted, and the renderer gets no value back', async () => {
    // Never write a test secret into a real profile folder.
    const actual = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
    expect(actual).toBe(userData);
    const set = await call({
      id: 'set',
      method: 'profiles.setSecret',
      params: { profileId: 'p-electron', kind: 'password', value: SECRET },
    });
    expect(set).toEqual({ id: 'set', ok: true, result: { secureStorage: false } });
    const bytes = await readFile(path.join(userData, 'secrets.bin'));
    expect(bytes.length).toBeGreaterThan(0);
    // Chromium's os_crypt marks basic_text ciphertext `v10` (keyring ciphertext is `v11`); the
    // store relies on this to tell a corrupt file from one written with an absent keyring.
    expect(bytes.subarray(0, 3).toString('latin1')).toBe('v10');
    expect(bytes.toString('latin1')).not.toContain(SECRET);
    expect(bytes.toString('latin1')).not.toContain('p-electron');

    const get = await call({
      id: 'get',
      method: 'secrets.get',
      params: { profileId: 'p-electron' },
    });
    expect(get).toMatchObject({ ok: false, error: { code: 'UNKNOWN_METHOD' } });
    expect(JSON.stringify([set, get])).not.toContain(SECRET);
  });

  it('after a restart the basic_text file still decrypts (not moved aside as corrupt)', async () => {
    await app.close();
    app = await launchApp(output, {}, ['--password-store=basic', `--user-data-dir=${userData}`]);
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    const before = await readFile(path.join(userData, 'secrets.bin'));
    // Clearing a kind that is stored forces a load (decrypt) and a rewrite.
    const cleared = await call({
      id: 'clr',
      method: 'profiles.clearSecret',
      params: { profileId: 'p-electron', kind: 'password' },
    });
    expect(cleared).toEqual({ id: 'clr', ok: true, result: {} });
    const files = await readdir(userData);
    expect(files.filter((name) => name.startsWith('secrets.bin.corrupt'))).toEqual([]);
    // The rewrite happened only because the old file decrypted and held p-electron's password.
    expect(await readFile(path.join(userData, 'secrets.bin'))).not.toEqual(before);
  });
});
