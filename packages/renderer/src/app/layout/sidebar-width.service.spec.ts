import { TestBed } from '@angular/core/testing';
import { BROADCAST_STREAMS, SIDEBAR_WIDTH, type Settings } from '@thicket/contract';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import { SidebarWidthService, clampSidebarWidth } from './sidebar-width.service';

const SETTINGS: Settings = {
  style: 'business',
  mode: 'system',
  pageSize: 50,
  nestedPageSize: 100,
  defaultIntegerType: 'int32',
  dateDisplay: 'local',
  checkForUpdates: true,
  schemaSampleSize: 1000,
  sidebarWidth: 300,
};

/** `settings` as sent by a main process from before `sidebarWidth` existed. */
function withoutWidth(settings: Settings): Settings {
  const copy: Partial<Settings> = { ...settings };
  delete copy.sidebarWidth;
  return copy as Settings;
}

/** A promise settled from the test, to control when a fake response arrives. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('clampSidebarWidth', () => {
  it('keeps widths inside the range, including both ends', () => {
    expect(clampSidebarWidth(SIDEBAR_WIDTH.min)).toBe(180);
    expect(clampSidebarWidth(300)).toBe(300);
    expect(clampSidebarWidth(SIDEBAR_WIDTH.max)).toBe(560);
  });

  it('clamps widths just outside the range and far beyond it', () => {
    expect(clampSidebarWidth(179)).toBe(180);
    expect(clampSidebarWidth(561)).toBe(560);
    expect(clampSidebarWidth(-50)).toBe(180);
    expect(clampSidebarWidth(1e9)).toBe(560);
  });

  it('rounds fractional widths to whole pixels', () => {
    expect(clampSidebarWidth(300.4)).toBe(300);
    expect(clampSidebarWidth(300.6)).toBe(301);
    expect(clampSidebarWidth(179.6)).toBe(180);
  });

  it('uses the default for non-finite widths', () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_WIDTH.default);
    expect(clampSidebarWidth(Number.POSITIVE_INFINITY)).toBe(SIDEBAR_WIDTH.default);
    expect(clampSidebarWidth(Number.NEGATIVE_INFINITY)).toBe(SIDEBAR_WIDTH.default);
  });
});

describe('SidebarWidthService', () => {
  let fake: FakeThicketBridge;
  let stored: Settings;
  let service: SidebarWidthService;

  const broadcast = (settings: Partial<Settings>) =>
    fake.emit({
      stream: BROADCAST_STREAMS.settingsChanged,
      kind: 'data',
      payload: { settings: { ...stored, ...settings } },
    });
  const saves = () => fake.requestsFor('app.settings.set').map((r) => r.params);

  beforeEach(() => {
    stored = { ...SETTINGS };
    fake = new FakeThicketBridge();
    fake.handle('app.settings.get', () => ({ settings: { ...stored } }));
    fake.handle('app.settings.set', (params) => {
      stored = { ...stored, ...params.settings };
      return { settings: { ...stored } };
    });
    TestBed.configureTestingModule({ providers: [provideFakeThicket(fake)] });
    service = TestBed.inject(SidebarWidthService);
  });

  describe('init', () => {
    it('starts with the default width before loading', () => {
      expect(service.width()).toBe(SIDEBAR_WIDTH.default);
    });

    it('loads the stored width once, even when called again', async () => {
      await service.init();
      await service.init();
      expect(service.width()).toBe(300);
      expect(fake.requestsFor('app.settings.get')).toHaveLength(1);
    });

    it('keeps the default and does not reject when main is unavailable', async () => {
      const bare = new FakeThicketBridge();
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [provideFakeThicket(bare)] });
      const fresh = TestBed.inject(SidebarWidthService);
      await expect(fresh.init()).resolves.toBeUndefined();
      expect(fresh.width()).toBe(SIDEBAR_WIDTH.default);
    });

    it('keeps the default when the stored settings have no sidebarWidth (older main)', async () => {
      fake.handle('app.settings.get', () => ({ settings: withoutWidth(SETTINGS) }));
      await service.init();
      expect(service.width()).toBe(SIDEBAR_WIDTH.default);
    });

    it('clamps an out-of-range stored width', async () => {
      stored = { ...stored, sidebarWidth: 9999 };
      await service.init();
      expect(service.width()).toBe(560);
    });

    it('stops following broadcasts when the injector is destroyed', async () => {
      await service.init();
      expect(fake.listenerCount).toBe(1);
      TestBed.resetTestingModule();
      expect(fake.listenerCount).toBe(0);
    });
  });

  describe('broadcasts', () => {
    it('follows widths broadcast from main', async () => {
      await service.init();
      broadcast({ sidebarWidth: 444 });
      expect(service.width()).toBe(444);
    });

    it('ignores broadcasts without a sidebarWidth', async () => {
      await service.init();
      fake.emit({
        stream: BROADCAST_STREAMS.settingsChanged,
        kind: 'data',
        payload: { settings: withoutWidth(stored) },
      });
      expect(service.width()).toBe(300);
    });

    it('a broadcast during a drag does not move the splitter under the pointer', async () => {
      await service.init();
      service.preview(350);
      broadcast({ sidebarWidth: 444 });
      expect(service.width()).toBe(350);
      await service.commit();
      expect(service.width()).toBe(350);
      expect(saves()).toEqual([{ settings: { sidebarWidth: 350 } }]);
    });

    it('a drag ending on the width broadcast meanwhile needs no save', async () => {
      await service.init();
      service.preview(350);
      broadcast({ sidebarWidth: 444 });
      service.preview(444);
      await service.commit();
      expect(service.width()).toBe(444);
      expect(saves()).toEqual([]);
    });

    it('after the drag, broadcasts are followed again', async () => {
      await service.init();
      service.preview(350);
      await service.commit();
      broadcast({ sidebarWidth: 200 });
      expect(service.width()).toBe(200);
    });
  });

  describe('preview and commit', () => {
    it('preview shows the clamped width without saving', async () => {
      await service.init();
      service.preview(10);
      expect(service.width()).toBe(180);
      service.preview(700.7);
      expect(service.width()).toBe(560);
      expect(saves()).toEqual([]);
    });

    it('commit saves the shown width by default', async () => {
      await service.init();
      service.preview(321.4);
      await service.commit();
      expect(saves()).toEqual([{ settings: { sidebarWidth: 321 } }]);
      expect(stored.sidebarWidth).toBe(321);
    });

    it('commit saves a given width clamped and rounded', async () => {
      await service.init();
      await service.commit(1000);
      await service.commit(150);
      await service.commit(Number.NaN);
      expect(saves()).toEqual([
        { settings: { sidebarWidth: 560 } },
        { settings: { sidebarWidth: 180 } },
        { settings: { sidebarWidth: SIDEBAR_WIDTH.default } },
      ]);
    });

    it('commit of the stored width sends nothing', async () => {
      await service.init();
      await service.commit(300);
      await service.commit();
      expect(saves()).toEqual([]);
    });

    it('a failed save shows the stored width again and rejects', async () => {
      await service.init();
      fake.fail('app.settings.set', { code: 'INTERNAL', message: 'disk full' });
      service.preview(400);
      await expect(service.commit()).rejects.toThrow('disk full');
      expect(service.width()).toBe(300);
      // The stored width is unchanged, so a retry with the same width sends again.
      fake.handle('app.settings.set', (params) => {
        stored = { ...stored, ...params.settings };
        return { settings: { ...stored } };
      });
      await service.commit(400);
      expect(service.width()).toBe(400);
      expect(stored.sidebarWidth).toBe(400);
    });

    it('a failed save does not undo a newer width shown meanwhile', async () => {
      await service.init();
      const pending = deferred<{ settings: Settings }>();
      fake.handle('app.settings.set', () => pending.promise);
      const first = service.commit(400);
      service.preview(420);
      pending.reject(new Error('write failed'));
      await expect(first).rejects.toThrow('write failed');
      expect(service.width()).toBe(420);
    });

    it('overlapping saves: answers and broadcasts of earlier saves do not undo newer widths', async () => {
      stored = { ...stored, sidebarWidth: 260 };
      await service.init();
      // Main answers each save later and then broadcasts the saved settings, like the real one.
      const answers: (() => void)[] = [];
      fake.handle(
        'app.settings.set',
        (params) =>
          new Promise<{ settings: Settings }>((resolve) =>
            answers.push(() => {
              stored = { ...stored, ...params.settings };
              resolve({ settings: { ...stored } });
              broadcast({});
            }),
          ),
      );
      const answer = async (count: number) => {
        await vi.waitFor(() => expect(answers.length).toBeGreaterThanOrEqual(count));
        answers[count - 1]?.();
        await Promise.resolve();
      };
      // Three quick presses of ArrowRight on the splitter (step 16).
      const press = () => service.commit(service.width() + 16);
      const first = press();
      const second = press();
      await answer(1);
      await first;
      expect(service.width()).toBe(292);
      const third = press();
      expect(service.width()).toBe(308);
      await answer(2);
      await second;
      expect(service.width()).toBe(308);
      await answer(3);
      await third;
      expect(service.width()).toBe(308);
      expect(stored.sidebarWidth).toBe(308);
      expect(saves()).toEqual([
        { settings: { sidebarWidth: 276 } },
        { settings: { sidebarWidth: 292 } },
        { settings: { sidebarWidth: 308 } },
      ]);
      // With no save in flight, broadcasts from other windows are followed again.
      broadcast({ sidebarWidth: 400 });
      expect(service.width()).toBe(400);
    });

    it('a save back to the stored width while another save is in flight is still sent', async () => {
      await service.init();
      const pending = deferred<{ settings: Settings }>();
      fake.handle('app.settings.set', () => pending.promise);
      const first = service.commit(400);
      const back = service.commit(300);
      expect(service.width()).toBe(300);
      await vi.waitFor(() => expect(saves()).toHaveLength(2));
      pending.resolve({ settings: { ...stored, sidebarWidth: 300 } });
      await Promise.all([first, back]);
      expect(saves()).toEqual([
        { settings: { sidebarWidth: 400 } },
        { settings: { sidebarWidth: 300 } },
      ]);
      expect(service.width()).toBe(300);
    });

    it('a late answer to the initial load does not undo a width saved meanwhile', async () => {
      const load = deferred<{ settings: Settings }>();
      fake.handle('app.settings.get', () => load.promise);
      const saved = deferred<{ settings: Settings }>();
      fake.handle('app.settings.set', () => saved.promise);
      const init = service.init();
      const commit = service.commit(350);
      load.resolve({ settings: { ...stored } });
      await init;
      expect(service.width()).toBe(350);
      saved.resolve({ settings: { ...stored, sidebarWidth: 350 } });
      await commit;
      expect(service.width()).toBe(350);
    });

    it('a failed save after a successful one reverts to the last saved width', async () => {
      await service.init();
      await service.commit(350);
      fake.fail('app.settings.set', { code: 'INTERNAL', message: 'locked' });
      await expect(service.commit(500)).rejects.toThrow('locked');
      expect(service.width()).toBe(350);
    });
  });
});
