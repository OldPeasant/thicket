import { TestBed } from '@angular/core/testing';
import { BROADCAST_STREAMS, type Settings } from '@thicket/contract';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../../api/testing';
import { NumberDefaultService } from './number-default.service';

const SETTINGS: Settings = {
  style: 'business',
  mode: 'system',
  pageSize: 50,
  nestedPageSize: 100,
  defaultIntegerType: 'double',
  dateDisplay: 'local',
  checkForUpdates: true,
  schemaSampleSize: 1000,
  sidebarWidth: 300,
};

describe('NumberDefaultService', () => {
  let fake: FakeThicketBridge;
  let stored: Settings;

  const broadcast = (settings: Record<string, unknown>) =>
    fake.emit({
      stream: BROADCAST_STREAMS.settingsChanged,
      kind: 'data',
      payload: { settings: { ...stored, ...settings } },
    });

  const create = () => TestBed.inject(NumberDefaultService);

  /** The service, once its constructor's load of the settings has been answered. */
  const loaded = async () => {
    const service = create();
    await vi.waitFor(() => expect(fake.requestsFor('app.settings.get')).toHaveLength(1));
    // Let the answer reach the service.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    return service;
  };

  beforeEach(() => {
    stored = { ...SETTINGS };
    fake = new FakeThicketBridge();
    fake.handle('app.settings.get', () => ({ settings: { ...stored } }));
    TestBed.configureTestingModule({ providers: [provideFakeThicket(fake)] });
  });

  it('makes Int32 for small integers before the settings arrive', () => {
    fake.handle('app.settings.get', () => new Promise(() => undefined));
    const service = create();
    expect(service.integers()).toBe('int32');
    expect(service.newNumber(5)).toEqual({ type: 'int', value: 5 });
  });

  it('loads defaultIntegerType from app.settings.get once', async () => {
    const service = await loaded();
    await service.init();
    expect(service.integers()).toBe('double');
    expect(service.newNumber(5)).toEqual({ type: 'double', value: 5 });
    expect(fake.requestsFor('app.settings.get')).toHaveLength(1);
  });

  it('loads int64', async () => {
    stored = { ...stored, defaultIntegerType: 'int64' };
    const service = await loaded();
    expect(service.newNumber(5)).toEqual({ type: 'long', value: 5n });
  });

  it('follows app.settings.changed broadcasts', async () => {
    const service = await loaded();
    broadcast({ defaultIntegerType: 'int64' });
    expect(service.integers()).toBe('int64');
    broadcast({ defaultIntegerType: 'int32' });
    expect(service.newNumber(7)).toEqual({ type: 'int', value: 7 });
  });

  it('ignores unknown and missing values, from the load and from broadcasts', async () => {
    stored = { ...stored, defaultIntegerType: 'int128' as never };
    const service = await loaded();
    expect(service.integers()).toBe('int32');
    broadcast({ defaultIntegerType: 'double' });
    expect(service.integers()).toBe('double');
    broadcast({ defaultIntegerType: 'Int64' });
    broadcast({ defaultIntegerType: 64 });
    broadcast({ defaultIntegerType: undefined });
    expect(service.integers()).toBe('double');
  });

  it('keeps Int32 and does not reject when main answers with an error', async () => {
    fake.fail('app.settings.get', { code: 'INTERNAL', message: 'settings file unreadable' });
    // (A rejected load would surface as an unhandled rejection and fail the test.)
    const service = await loaded();
    expect(service.integers()).toBe('int32');
    // Broadcasts are still followed after a failed load.
    broadcast({ defaultIntegerType: 'int64' });
    expect(service.integers()).toBe('int64');
  });

  it('keeps Int32 without the desktop bridge (plain browser)', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const service = create();
    // Let the missing bridge's INTERNAL answer arrive.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await expect(service.init()).resolves.toBeUndefined();
    expect(service.integers()).toBe('int32');
    expect(service.newNumber(3)).toEqual({ type: 'int', value: 3 });
  });

  it('stops following broadcasts when the injector is destroyed', async () => {
    const service = await loaded();
    expect(service.integers()).toBe('double');
    expect(fake.listenerCount).toBe(1);
    TestBed.resetTestingModule();
    expect(fake.listenerCount).toBe(0);
    broadcast({ defaultIntegerType: 'int64' });
    expect(service.integers()).toBe('double');
  });
});
