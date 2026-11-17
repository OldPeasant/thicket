import { TestBed } from '@angular/core/testing';
import { BROADCAST_STREAMS, type Settings } from '@thicket/contract';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../../api/testing';
import { NestedPageSizeService } from './nested-page-size.service';

const SETTINGS: Settings = {
  style: 'business',
  mode: 'system',
  pageSize: 50,
  nestedPageSize: 250,
  defaultIntegerType: 'double',
  dateDisplay: 'local',
  checkForUpdates: true,
  schemaSampleSize: 1000,
  sidebarWidth: 300,
};

describe('NestedPageSizeService', () => {
  let fake: FakeThicketBridge;
  let stored: Settings;

  const broadcast = (settings: Record<string, unknown>) =>
    fake.emit({
      stream: BROADCAST_STREAMS.settingsChanged,
      kind: 'data',
      payload: { settings: { ...stored, ...settings } },
    });

  /** The service, once its constructor's load of the settings has been answered. */
  const loaded = async () => {
    const service = TestBed.inject(NestedPageSizeService);
    await vi.waitFor(() => expect(fake.requestsFor('app.settings.get')).toHaveLength(1));
    for (let i = 0; i < 5; i++) await Promise.resolve();
    return service;
  };

  beforeEach(() => {
    stored = { ...SETTINGS };
    fake = new FakeThicketBridge();
    fake.handle('app.settings.get', () => ({ settings: { ...stored } }));
    TestBed.configureTestingModule({ providers: [provideFakeThicket(fake)] });
  });

  it('is 100 before the settings arrive', () => {
    fake.handle('app.settings.get', () => new Promise(() => undefined));
    expect(TestBed.inject(NestedPageSizeService).size()).toBe(100);
  });

  it('loads nestedPageSize once', async () => {
    const service = await loaded();
    await service.init();
    expect(service.size()).toBe(250);
    expect(fake.requestsFor('app.settings.get')).toHaveLength(1);
  });

  it('follows a changed setting', async () => {
    const service = await loaded();
    broadcast({ nestedPageSize: 500 });
    expect(service.size()).toBe(500);
  });

  it('ignores a size that is not a positive whole number', async () => {
    const service = await loaded();
    for (const bad of [0, -10, 12.5, Number.NaN, '300', null]) {
      broadcast({ nestedPageSize: bad });
      expect(service.size()).toBe(250);
    }
  });

  it('keeps the default when the settings can not be read', async () => {
    fake.fail('app.settings.get', { code: 'INTERNAL', message: 'main unavailable' });
    const service = await loaded();
    expect(service.size()).toBe(100);
  });
});
