import { TestBed } from '@angular/core/testing';
import { BROADCAST_STREAMS, type Settings } from '@thicket/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import { UpdateNotice } from './update-notice';
import {
  UPDATE_CHECK_INTERVAL_MS,
  UpdateNoticeService,
  type UpdateCheck,
} from './update-notice.service';

const SETTINGS: Settings = {
  style: 'business',
  mode: 'system',
  pageSize: 50,
  nestedPageSize: 100,
  defaultIntegerType: 'int32',
  dateDisplay: 'local',
  checkForUpdates: true,
  schemaSampleSize: 1000,
  sidebarWidth: 260,
};

const NEWER: UpdateCheck = {
  current: '0.2.0',
  latest: '0.3.0',
  updateAvailable: true,
  url: 'https://github.com/OldPeasant/thicket/releases/tag/v0.3.0',
};

const SAME: UpdateCheck = { ...NEWER, current: '0.3.0', updateAvailable: false };

/** Lets pending promise chains (fake bridge answers) run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('UpdateNoticeService', () => {
  let fake: FakeThicketBridge;
  let stored: Settings;
  let answer: () => UpdateCheck | Promise<UpdateCheck>;

  const broadcast = (changes: Partial<Settings>) => {
    stored = { ...stored, ...changes };
    fake.emit({
      stream: BROADCAST_STREAMS.settingsChanged,
      kind: 'data',
      payload: { settings: stored },
    });
  };
  const checks = () => fake.requestsFor('app.checkForUpdate').length;

  const start = async () => {
    const service = TestBed.inject(UpdateNoticeService);
    await settle();
    return service;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    stored = { ...SETTINGS };
    answer = () => NEWER;
    fake = new FakeThicketBridge();
    fake.handle('app.settings.get', () => ({ settings: { ...stored } }));
    fake.handle('app.checkForUpdate', () => answer());
    TestBed.configureTestingModule({ providers: [provideFakeThicket(fake)] });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  it('checks at start and shows a newer release', async () => {
    const service = await start();
    expect(checks()).toBe(1);
    expect(service.available()).toEqual({ version: '0.3.0', url: NEWER.url });
  });

  it('shows nothing when the running version is the latest', async () => {
    answer = () => SAME;
    const service = await start();
    expect(checks()).toBe(1);
    expect(service.available()).toBeNull();
  });

  it('is silent when the check fails', async () => {
    fake.fail('app.checkForUpdate', { code: 'INTERNAL', message: 'main unavailable' });
    const service = await start();
    expect(service.available()).toBeNull();
  });

  it('checks again once a day', async () => {
    answer = () => SAME;
    const service = await start();
    answer = () => NEWER;
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS - 1);
    expect(checks()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(checks()).toBe(2);
    expect(service.available()?.version).toBe('0.3.0');
  });

  it('setting off: no check is requested, not at start and not daily', async () => {
    stored = { ...stored, checkForUpdates: false };
    const service = await start();
    await vi.advanceTimersByTimeAsync(3 * UPDATE_CHECK_INTERVAL_MS);
    expect(checks()).toBe(0);
    expect(service.available()).toBeNull();
  });

  it('turning the setting off hides the notice and stops the daily check', async () => {
    const service = await start();
    broadcast({ checkForUpdates: false });
    expect(service.available()).toBeNull();
    await vi.advanceTimersByTimeAsync(2 * UPDATE_CHECK_INTERVAL_MS);
    expect(checks()).toBe(1);
  });

  it('turning the setting on checks right away', async () => {
    stored = { ...stored, checkForUpdates: false };
    const service = await start();
    broadcast({ checkForUpdates: true });
    await settle();
    expect(checks()).toBe(1);
    expect(service.available()?.version).toBe('0.3.0');
    // Other settings changes don't trigger another check.
    broadcast({ pageSize: 100 });
    await settle();
    expect(checks()).toBe(1);
  });

  it('ignores an answer that arrives after the setting was switched off', async () => {
    let resolve: (value: UpdateCheck) => void = () => undefined;
    answer = () => new Promise((r) => (resolve = r));
    const service = await start();
    broadcast({ checkForUpdates: false });
    resolve(NEWER);
    await settle();
    expect(service.available()).toBeNull();
  });

  it('dismiss hides this version but a newer one shows again', async () => {
    const service = await start();
    service.dismiss();
    expect(service.available()).toBeNull();
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    await settle();
    expect(service.available()).toBeNull();
    answer = () => ({ ...NEWER, latest: '0.4.0' });
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    await settle();
    expect(service.available()?.version).toBe('0.4.0');
  });

  it('a failed daily check keeps the notice shown before (test-writer)', async () => {
    const service = await start();
    fake.fail('app.checkForUpdate', { code: 'INTERNAL', message: 'main unavailable' });
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    await settle();
    expect(checks()).toBe(2);
    expect(service.available()?.version).toBe('0.3.0');
  });

  it('a later "no update" answer hides the notice (test-writer)', async () => {
    const service = await start();
    answer = () => SAME;
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    await settle();
    expect(service.available()).toBeNull();
  });

  it('shows nothing for an answer without a version or link (test-writer)', async () => {
    answer = () => ({ ...NEWER, url: null });
    const service = await start();
    expect(service.available()).toBeNull();
    answer = () => ({ ...NEWER, latest: null });
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    await settle();
    expect(checks()).toBe(2);
    expect(service.available()).toBeNull();
  });

  it('dismiss without a notice changes nothing, a later update still shows (test-writer)', async () => {
    answer = () => SAME;
    const service = await start();
    service.dismiss();
    answer = () => NEWER;
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    await settle();
    expect(service.available()?.version).toBe('0.3.0');
  });

  it('init() again does not start a second check or timer (test-writer)', async () => {
    const service = await start();
    await service.init();
    await settle();
    expect(checks()).toBe(1);
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(checks()).toBe(2);
  });

  it('stops the daily check once its injector is destroyed (test-writer)', async () => {
    await start();
    expect(checks()).toBe(1);
    TestBed.resetTestingModule();
    await vi.advanceTimersByTimeAsync(3 * UPDATE_CHECK_INTERVAL_MS);
    expect(checks()).toBe(1);
  });

  it('a settings broadcast that repeats "on" does not check again (test-writer)', async () => {
    await start();
    broadcast({ checkForUpdates: true });
    await settle();
    expect(checks()).toBe(1);
  });

  it('shows nothing without the desktop bridge settings', async () => {
    fake.fail('app.settings.get', { code: 'INTERNAL', message: 'main unavailable' });
    const service = await start();
    expect(checks()).toBe(0);
    expect(service.available()).toBeNull();
  });
});

describe('UpdateNotice', () => {
  let fake: FakeThicketBridge;

  beforeEach(() => {
    fake = new FakeThicketBridge();
    fake.handle('app.settings.get', () => ({ settings: { ...SETTINGS } }));
    fake.handle('app.checkForUpdate', () => NEWER);
    TestBed.configureTestingModule({ providers: [provideFakeThicket(fake)] });
  });

  afterEach(() => TestBed.resetTestingModule());

  async function render() {
    const fixture = TestBed.createComponent(UpdateNotice);
    await vi.waitFor(() => expect(fake.requestsFor('app.checkForUpdate')).toHaveLength(1));
    await settle();
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the version and a link to the release that opens outside the app', async () => {
    const el = await render();
    const notice = el.querySelector('[data-testid="update-notice"]');
    expect(notice?.getAttribute('role')).toBe('status');
    expect(notice?.textContent).toContain('Thicket 0.3.0 is available.');
    const link = el.querySelector<HTMLAnchorElement>('[data-testid="update-link"]');
    expect(link?.href).toBe(NEWER.url);
    expect(link?.target).toBe('_blank');
    expect(link?.rel).toBe('noopener noreferrer');
  });

  it('closes with the dismiss button', async () => {
    const el = await render();
    el.querySelector<HTMLButtonElement>('[data-testid="update-dismiss"]')?.click();
    TestBed.tick();
    expect(el.querySelector('[data-testid="update-notice"]')).toBeNull();
  });

  it('renders nothing when there is no update', async () => {
    fake.handle('app.checkForUpdate', () => SAME);
    const el = await render();
    expect(el.querySelector('[data-testid="update-notice"]')).toBeNull();
  });
});
