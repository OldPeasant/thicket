import { DOCUMENT } from '@angular/common';
import { ApplicationInitStatus } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BROADCAST_STREAMS, STYLES, THEME_MODES, type Settings } from '@thicket/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import { appConfig } from '../app.config';
import { provideTheme } from './index';
import { ThemeSwitcher } from './theme-switcher';
import { DARK_QUERY, ThemeService, resolveMode, type Style, type ThemeMode } from './theme.service';

const SETTINGS: Settings = {
  style: 'business',
  mode: 'system',
  pageSize: 50,
  nestedPageSize: 100,
  defaultIntegerType: 'int32',
  dateDisplay: 'local',
  checkForUpdates: true,
  schemaSampleSize: 1000,
};

/** A controllable `prefers-color-scheme: dark` media query. */
class FakeMediaQuery {
  readonly media = DARK_QUERY;
  private readonly listeners = new Set<(event: MediaQueryListEvent) => void>();
  constructor(public matches: boolean) {}
  addEventListener(_type: 'change', listener: (event: MediaQueryListEvent) => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: 'change', listener: (event: MediaQueryListEvent) => void): void {
    this.listeners.delete(listener);
  }
  /** The OS switched its appearance. */
  change(matches: boolean): void {
    this.matches = matches;
    for (const l of this.listeners) l({ matches, media: this.media } as MediaQueryListEvent);
  }
  get listenerCount(): number {
    return this.listeners.size;
  }
}

describe('resolveMode', () => {
  it('follows the OS only for system', () => {
    expect(resolveMode('system', true)).toBe('dark');
    expect(resolveMode('system', false)).toBe('light');
    expect(resolveMode('light', true)).toBe('light');
    expect(resolveMode('dark', false)).toBe('dark');
  });
});

describe('ThemeService', () => {
  let fake: FakeThicketBridge;
  let media: FakeMediaQuery;
  let stored: Settings;
  let root: HTMLElement;
  let view: Record<string, unknown>;
  let originalMatchMedia: unknown;

  const attrs = () => ({
    style: root.getAttribute('data-style'),
    theme: root.getAttribute('data-theme'),
  });

  beforeEach(() => {
    stored = { ...SETTINGS };
    media = new FakeMediaQuery(false);
    fake = new FakeThicketBridge();
    fake.handle('app.settings.get', () => ({ settings: { ...stored } }));
    fake.handle('app.settings.set', (params) => {
      stored = { ...stored, ...params.settings };
      return { settings: { ...stored } };
    });
    TestBed.configureTestingModule({ providers: [provideFakeThicket(fake)] });
    const doc = TestBed.inject(DOCUMENT);
    root = doc.documentElement;
    root.removeAttribute('data-style');
    root.removeAttribute('data-theme');
    // jsdom has no matchMedia: install a controllable one.
    view = doc.defaultView as unknown as Record<string, unknown>;
    originalMatchMedia = view['matchMedia'];
    view['matchMedia'] = (query: string) => (query === DARK_QUERY ? media : null);
  });

  afterEach(() => {
    view['matchMedia'] = originalMatchMedia;
    TestBed.resetTestingModule();
  });

  it('applies the defaults synchronously, then the stored settings', async () => {
    stored = { ...stored, style: 'tron', mode: 'dark' };
    const theme = TestBed.inject(ThemeService);
    const started = theme.init();
    expect(attrs()).toEqual({ style: 'business', theme: 'light' });
    await started;
    expect(attrs()).toEqual({ style: 'tron', theme: 'dark' });
    expect(theme.style()).toBe('tron');
    expect(theme.mode()).toBe('dark');
    expect(theme.effective()).toBe('dark');
  });

  it('starts once, even when init is called again', async () => {
    const theme = TestBed.inject(ThemeService);
    await theme.init();
    await theme.init();
    expect(fake.requestsFor('app.settings.get')).toHaveLength(1);
    expect(media.listenerCount).toBe(1);
  });

  it('system: follows prefers-color-scheme changes without reload', async () => {
    const theme = TestBed.inject(ThemeService);
    await theme.init();
    expect(attrs().theme).toBe('light');
    media.change(true);
    expect(attrs().theme).toBe('dark');
    expect(theme.effective()).toBe('dark');
    media.change(false);
    expect(attrs().theme).toBe('light');
  });

  it('starts dark when the OS already prefers dark', async () => {
    media = new FakeMediaQuery(true);
    await TestBed.inject(ThemeService).init();
    expect(attrs()).toEqual({ style: 'business', theme: 'dark' });
  });

  it('a fixed mode ignores OS changes', async () => {
    stored = { ...stored, mode: 'light' };
    await TestBed.inject(ThemeService).init();
    media.change(true);
    expect(attrs().theme).toBe('light');
  });

  it('switching style and mode applies immediately and persists via app.settings.set', async () => {
    const theme = TestBed.inject(ThemeService);
    await theme.init();

    const pending = theme.setStyle('tron');
    expect(attrs().style).toBe('tron'); // before the round trip
    await pending;
    await theme.setMode('dark');

    expect(attrs()).toEqual({ style: 'tron', theme: 'dark' });
    expect(fake.requestsFor('app.settings.set').map((r) => r.params)).toEqual([
      { settings: { style: 'tron' } },
      { settings: { mode: 'dark' } },
    ]);
    expect(stored).toMatchObject({ style: 'tron', mode: 'dark' });
  });

  it('reverts and rejects when the setting cannot be saved', async () => {
    fake.fail('app.settings.set', { code: 'INTERNAL', message: 'disk full' });
    const theme = TestBed.inject(ThemeService);
    await theme.init();
    await expect(theme.setStyle('tron')).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(attrs().style).toBe('business');
    expect(theme.style()).toBe('business');
  });

  it('follows app.settings.changed broadcasts (another window, or main)', async () => {
    const theme = TestBed.inject(ThemeService);
    await theme.init();
    fake.emit({
      stream: BROADCAST_STREAMS.settingsChanged,
      kind: 'data',
      payload: { settings: { ...SETTINGS, style: 'tron', mode: 'dark' } },
    });
    expect(attrs()).toEqual({ style: 'tron', theme: 'dark' });
    expect(theme.mode()).toBe('dark');
  });

  it('keeps the defaults without a desktop bridge', async () => {
    fake.fail('app.settings.get', { code: 'INTERNAL', message: 'no bridge' });
    await TestBed.inject(ThemeService).init();
    expect(attrs()).toEqual({ style: 'business', theme: 'light' });
  });

  it('ignores values outside the contract', async () => {
    const theme = TestBed.inject(ThemeService);
    await theme.init();
    fake.emit({
      stream: BROADCAST_STREAMS.settingsChanged,
      kind: 'data',
      payload: { settings: { ...SETTINGS, style: 'neon', mode: 'sepia' } },
    });
    expect(attrs()).toEqual({ style: 'business', theme: 'light' });
  });

  it('stops listening to the OS when destroyed', async () => {
    await TestBed.inject(ThemeService).init();
    expect(media.listenerCount).toBe(1);
    TestBed.resetTestingModule();
    expect(media.listenerCount).toBe(0);
  });

  it('works without matchMedia', async () => {
    view['matchMedia'] = undefined;
    await TestBed.inject(ThemeService).init();
    expect(attrs()).toEqual({ style: 'business', theme: 'light' });
  });

  it('applies a broadcast that changes only the mode, keeping the style', async () => {
    stored = { ...stored, style: 'tron', mode: 'light' };
    const theme = TestBed.inject(ThemeService);
    await theme.init();
    fake.emit({
      stream: BROADCAST_STREAMS.settingsChanged,
      kind: 'data',
      payload: { settings: { mode: 'dark' } as Settings },
    });
    expect(attrs()).toEqual({ style: 'tron', theme: 'dark' });
  });

  it('switching to system mode picks up the current OS preference at once', async () => {
    media = new FakeMediaQuery(true);
    stored = { ...stored, mode: 'light' };
    const theme = TestBed.inject(ThemeService);
    await theme.init();
    expect(attrs().theme).toBe('light');
    await theme.setMode('system');
    expect(attrs().theme).toBe('dark');
  });

  describe('overlapping requests (order controlled with deferred answers)', () => {
    it('a late app.settings.get answer does not undo a choice made meanwhile', async () => {
      const get = deferred<{ settings: Settings }>();
      const before = { ...stored }; // what main read before the user changed anything
      fake.handle('app.settings.get', () => get.promise);
      const theme = TestBed.inject(ThemeService);
      const started = theme.init();

      await theme.setStyle('tron');
      expect(stored.style).toBe('tron');
      get.resolve({ settings: before });
      await started;

      // The stored setting is Tron; the window must not fall back to Business.
      expect(attrs().style).toBe('tron');
      expect(theme.style()).toBe('tron');
    });

    it('answers in reverse order: the last choice wins (shown == stored)', async () => {
      const answers: (() => void)[] = [];
      fake.handle('app.settings.set', (params) => {
        stored = { ...stored, ...params.settings };
        const snapshot = { settings: { ...stored } };
        return new Promise((resolve) => answers.push(() => resolve(snapshot)));
      });
      const theme = TestBed.inject(ThemeService);
      await theme.init();

      const first = theme.setStyle('tron');
      const second = theme.setStyle('business');
      await flushAll();
      expect(answers).toHaveLength(2);
      answers[1]?.();
      await second;
      answers[0]?.(); // the older answer (style: tron) arrives last
      await first;

      expect(stored.style).toBe('business');
      expect(attrs().style).toBe('business');
      expect(theme.style()).toBe('business');
    });

    it('a failed earlier save does not revert a later save that succeeded', async () => {
      const failing = deferred<{ error: { code: 'INTERNAL'; message: string } }>();
      let calls = 0;
      fake.handle('app.settings.set', (params) => {
        calls += 1;
        if (calls === 1) return failing.promise;
        stored = { ...stored, ...params.settings };
        return { settings: { ...stored } };
      });
      const theme = TestBed.inject(ThemeService);
      await theme.init();

      const style = theme.setStyle('tron');
      await theme.setMode('dark'); // saved
      failing.resolve({ error: { code: 'INTERNAL', message: 'disk full' } });
      await expect(style).rejects.toMatchObject({ code: 'INTERNAL' });

      expect(stored).toMatchObject({ style: 'business', mode: 'dark' });
      expect(theme.mode()).toBe('dark');
      expect(attrs()).toEqual({ style: 'business', theme: 'dark' });
    });

    it('two overlapping failed saves end on the stored values, not an unsaved one', async () => {
      const failures = [
        deferred<{ error: { code: 'INTERNAL'; message: string } }>(),
        deferred<{ error: { code: 'INTERNAL'; message: string } }>(),
      ];
      let calls = 0;
      fake.handle(
        'app.settings.set',
        () => failures[calls++]?.promise ?? new Promise(() => undefined),
      );
      const theme = TestBed.inject(ThemeService);
      await theme.init();

      const style = theme.setStyle('tron');
      const mode = theme.setMode('dark');
      failures[0]?.resolve({ error: { code: 'INTERNAL', message: 'disk full' } });
      await expect(style).rejects.toMatchObject({ code: 'INTERNAL' });
      failures[1]?.resolve({ error: { code: 'INTERNAL', message: 'disk full' } });
      await expect(mode).rejects.toMatchObject({ code: 'INTERNAL' });

      expect(theme.style()).toBe('business');
      expect(theme.mode()).toBe('system');
      expect(attrs()).toEqual({ style: 'business', theme: 'light' });
    });

    const changed = (settings: Settings) =>
      fake.emit({ stream: BROADCAST_STREAMS.settingsChanged, kind: 'data', payload: { settings } });

    it('a broadcast from another window while a save is pending: the later save wins', async () => {
      const save = deferred<{ settings: Settings }>();
      fake.handle('app.settings.set', () => save.promise);
      const theme = TestBed.inject(ThemeService);
      await theme.init();

      const pending = theme.setStyle('tron');
      // Another window stores Business/dark before main handles this window's save.
      stored = { ...stored, style: 'business', mode: 'dark' };
      changed({ ...stored });
      stored = { ...stored, style: 'tron' }; // then main stores this window's choice
      save.resolve({ settings: { ...stored } });
      await pending;

      expect(theme.style()).toBe('tron');
      expect(theme.mode()).toBe('dark');
      expect(attrs()).toEqual({ style: 'tron', theme: 'dark' });
    });

    it('a pending save that fails after a broadcast of the same value keeps the broadcast value', async () => {
      const save = deferred<{ error: { code: 'INTERNAL'; message: string } }>();
      fake.handle('app.settings.set', () => save.promise);
      const theme = TestBed.inject(ThemeService);
      await theme.init();

      const pending = theme.setStyle('tron');
      changed({ ...stored, style: 'tron' }); // another window stored Tron meanwhile
      save.resolve({ error: { code: 'INTERNAL', message: 'disk full' } });
      await expect(pending).rejects.toMatchObject({ code: 'INTERNAL' });

      // Tron is what main stores now, so the failed save must not fall back to Business.
      expect(theme.style()).toBe('tron');
      expect(attrs().style).toBe('tron');
    });

    it('a pending save that fails after a broadcast of another value shows the broadcast value', async () => {
      const save = deferred<{ error: { code: 'INTERNAL'; message: string } }>();
      fake.handle('app.settings.set', () => save.promise);
      const theme = TestBed.inject(ThemeService);
      await theme.init();

      const pending = theme.setMode('dark');
      changed({ ...stored, mode: 'light' });
      save.resolve({ error: { code: 'INTERNAL', message: 'disk full' } });
      await expect(pending).rejects.toMatchObject({ code: 'INTERNAL' });

      expect(theme.mode()).toBe('light');
      expect(attrs().theme).toBe('light');
    });

    it('main echoes each save as a broadcast before answering: quick choices end on the last one', async () => {
      // Like apps/desktop main: the store broadcasts the full settings, then the set answers.
      const queue: (() => void)[] = [];
      fake.handle('app.settings.set', (params) => {
        return new Promise((resolve) =>
          queue.push(() => {
            stored = { ...stored, ...params.settings };
            changed({ ...stored });
            resolve({ settings: { ...stored } });
          }),
        );
      });
      const theme = TestBed.inject(ThemeService);
      await theme.init();

      const saves = [theme.setStyle('tron'), theme.setMode('dark'), theme.setStyle('business')];
      await flushAll();
      expect(queue).toHaveLength(3);
      for (const step of queue) {
        step();
        await flushAll();
      }
      await Promise.all(saves);

      expect(stored).toMatchObject({ style: 'business', mode: 'dark' });
      expect(theme.style()).toBe('business');
      expect(theme.mode()).toBe('dark');
      expect(attrs()).toEqual({ style: 'business', theme: 'dark' });
    });

    it('a save that fails before the late app.settings.get answer ends on the stored value', async () => {
      stored = { ...stored, style: 'tron' };
      const get = deferred<{ settings: Settings }>();
      fake.handle('app.settings.get', () => get.promise);
      fake.fail('app.settings.set', { code: 'INTERNAL', message: 'disk full' });
      const theme = TestBed.inject(ThemeService);
      const started = theme.init();

      // Startup still shows the default (Business); the user picks Business, the save fails.
      await expect(theme.setStyle('business')).rejects.toMatchObject({ code: 'INTERNAL' });
      get.resolve({ settings: { ...stored } });
      await started;

      // Nothing was saved, so the window must show what main stores: Tron.
      expect(stored.style).toBe('tron');
      expect(theme.style()).toBe('tron');
      expect(attrs().style).toBe('tron');
    });

    it('an earlier save that succeeds after a later one failed ends on its stored value', async () => {
      const first = deferred<{ settings: Settings }>();
      let calls = 0;
      fake.handle('app.settings.set', (params) => {
        calls += 1;
        if (calls === 2) return { error: { code: 'INTERNAL', message: 'disk full' } };
        stored = { ...stored, ...params.settings };
        const snapshot = { settings: { ...stored } };
        return first.promise.then(() => snapshot);
      });
      const theme = TestBed.inject(ThemeService);
      await theme.init();

      const saved = theme.setStyle('tron'); // stored, but the answer is late
      await expect(theme.setStyle('business')).rejects.toMatchObject({ code: 'INTERNAL' });
      first.resolve({ settings: { ...stored } });
      await saved;

      // The fake does not broadcast: only the late answer tells the window that Tron is stored.
      expect(stored.style).toBe('tron');
      expect(theme.style()).toBe('tron');
      expect(attrs().style).toBe('tron');
    });

    it('a stale app.settings.get answer does not replace a newer stored value for a later revert', async () => {
      const get = deferred<{ settings: Settings }>();
      const before = { ...stored };
      fake.handle('app.settings.get', () => get.promise);
      let calls = 0;
      fake.handle('app.settings.set', (params) => {
        calls += 1;
        if (calls === 2) return { error: { code: 'INTERNAL', message: 'disk full' } };
        stored = { ...stored, ...params.settings };
        return { settings: { ...stored } };
      });
      const theme = TestBed.inject(ThemeService);
      const started = theme.init();

      await theme.setStyle('tron'); // stored
      get.resolve({ settings: before }); // read before the save: Business
      await started;
      await expect(theme.setStyle('business')).rejects.toMatchObject({ code: 'INTERNAL' });

      expect(stored.style).toBe('tron');
      expect(theme.style()).toBe('tron');
      expect(attrs().style).toBe('tron');
    });

    it('the last pending save failing after the latest choice failed ends on the stored value', async () => {
      // Three style saves; the answers arrive as: third fails, first succeeds, second fails.
      const firstAnswer = deferred<{ settings: Settings }>();
      const secondAnswer = deferred<{ error: { code: 'INTERNAL'; message: string } }>();
      let calls = 0;
      fake.handle('app.settings.set', (params) => {
        calls += 1;
        if (calls === 1) {
          stored = { ...stored, ...params.settings };
          const snapshot = { settings: { ...stored } };
          return firstAnswer.promise.then(() => snapshot);
        }
        if (calls === 2) return secondAnswer.promise;
        return { error: { code: 'INTERNAL', message: 'disk full' } };
      });
      const theme = TestBed.inject(ThemeService);
      await theme.init();

      const first = theme.setStyle('tron'); // stored, answer late
      const second = theme.setStyle('business'); // will fail, answer late
      await expect(theme.setStyle('tron')).rejects.toMatchObject({ code: 'INTERNAL' });
      firstAnswer.resolve({ settings: { ...stored } });
      await first;
      secondAnswer.resolve({ error: { code: 'INTERNAL', message: 'disk full' } });
      await expect(second).rejects.toMatchObject({ code: 'INTERNAL' });

      // Only the first save was stored: the window must show Tron, as main does.
      expect(stored.style).toBe('tron');
      expect(theme.style()).toBe('tron');
      expect(attrs().style).toBe('tron');
    });

    it('a late startup answer while an older save is pending, then that save fails: ends on the stored value', async () => {
      stored = { ...stored, mode: 'dark' };
      const get = deferred<{ settings: Settings }>();
      fake.handle('app.settings.get', () => get.promise);
      const older = deferred<{ error: { code: 'INTERNAL'; message: string } }>();
      let calls = 0;
      fake.handle('app.settings.set', () => {
        calls += 1;
        if (calls === 1) return older.promise;
        return { error: { code: 'INTERNAL', message: 'disk full' } };
      });
      const theme = TestBed.inject(ThemeService);
      const started = theme.init();

      const first = theme.setMode('light'); // fails, answer late
      await expect(theme.setMode('dark')).rejects.toMatchObject({ code: 'INTERNAL' });
      get.resolve({ settings: { ...stored } }); // main stores dark
      await started;
      older.resolve({ error: { code: 'INTERNAL', message: 'disk full' } });
      await expect(first).rejects.toMatchObject({ code: 'INTERNAL' });

      expect(stored.mode).toBe('dark');
      expect(theme.mode()).toBe('dark');
      expect(attrs().theme).toBe('dark');
    });

    describe('one rule per key: latest choice unless failed or superseded by main', () => {
      interface Failure {
        error: { code: 'INTERNAL'; message: string };
      }
      const diskFull: Failure = { error: { code: 'INTERNAL', message: 'disk full' } };

      it('a broadcast from another window after this window saved replaces the saved choice', async () => {
        const theme = TestBed.inject(ThemeService);
        await theme.init();

        await theme.setStyle('tron');
        expect(theme.style()).toBe('tron');
        stored = { ...stored, style: 'business' }; // another window picks Business afterwards
        changed({ ...stored });

        expect(theme.style()).toBe('business');
        expect(attrs().style).toBe('business');
      });

      it('a broadcast while a save is pending changes only the key without a pending choice', async () => {
        const save = deferred<{ settings: Settings }>();
        fake.handle('app.settings.set', () => save.promise);
        const theme = TestBed.inject(ThemeService);
        await theme.init();

        const pending = theme.setStyle('tron');
        changed({ ...stored, style: 'business', mode: 'dark' }); // another window
        // The pending choice keeps showing; the mode (no local choice) follows the broadcast.
        expect(theme.style()).toBe('tron');
        expect(theme.mode()).toBe('dark');
        expect(attrs()).toEqual({ style: 'tron', theme: 'dark' });

        stored = { ...stored, style: 'tron', mode: 'dark' };
        save.resolve({ settings: { ...stored } });
        await pending;
        expect(attrs()).toEqual({ style: 'tron', theme: 'dark' });
      });

      it('echo of an older save does not flash its stale value over a newer pending choice', async () => {
        // Main broadcasts the full settings after each write, then answers (apps/desktop main).
        const queue: (() => void)[] = [];
        fake.handle('app.settings.set', (params) => {
          return new Promise((resolve) =>
            queue.push(() => {
              stored = { ...stored, ...params.settings };
              changed({ ...stored });
              resolve({ settings: { ...stored } });
            }),
          );
        });
        const theme = TestBed.inject(ThemeService);
        await theme.init();

        const saves = [theme.setStyle('tron'), theme.setMode('dark'), theme.setStyle('business')];
        await flushAll();
        const seen: string[] = [];
        for (const step of queue) {
          step(); // broadcast first ...
          seen.push(`${theme.style()}/${theme.mode()}`);
          await flushAll(); // ... then the answer
          seen.push(`${theme.style()}/${theme.mode()}`);
        }
        await Promise.all(saves);

        // Every intermediate state shows the latest choices: no flicker to tron or system.
        expect(seen).toEqual(Array(6).fill('business/dark'));
      });

      it('a late app.settings.get answer while a save is pending keeps the pending choice, then the save wins', async () => {
        stored = { ...stored, style: 'tron' };
        const get = deferred<{ settings: Settings }>();
        fake.handle('app.settings.get', () => get.promise);
        const save = deferred<{ settings: Settings }>();
        fake.handle('app.settings.set', () => save.promise);
        const theme = TestBed.inject(ThemeService);
        const started = theme.init();

        const pending = theme.setStyle('business');
        get.resolve({ settings: { ...stored } }); // main still stores Tron
        await started;
        expect(theme.style()).toBe('business');

        stored = { ...stored, style: 'business' };
        save.resolve({ settings: { ...stored } });
        await pending;
        expect(theme.style()).toBe('business');
        expect(attrs().style).toBe('business');
      });

      it('a late app.settings.get answer while a save is pending, then the save fails: shows the stored value', async () => {
        stored = { ...stored, style: 'tron', mode: 'dark' };
        const get = deferred<{ settings: Settings }>();
        fake.handle('app.settings.get', () => get.promise);
        const save = deferred<Failure>();
        fake.handle('app.settings.set', () => save.promise);
        const theme = TestBed.inject(ThemeService);
        const started = theme.init();

        const pending = theme.setStyle('business');
        get.resolve({ settings: { ...stored } });
        await started;
        // Style keeps the pending choice; mode had no choice and shows the stored dark at once.
        expect(attrs()).toEqual({ style: 'business', theme: 'dark' });

        save.resolve(diskFull);
        await expect(pending).rejects.toMatchObject({ code: 'INTERNAL' });
        expect(theme.style()).toBe('tron');
        expect(attrs()).toEqual({ style: 'tron', theme: 'dark' });
      });

      it('both keys interleaved: a saved style and a failed mode end on the saved style and the stored mode', async () => {
        const styleSave = deferred<{ settings: Settings }>();
        const modeSave = deferred<Failure>();
        fake.handle('app.settings.set', (params) => {
          if (params.settings.mode) return modeSave.promise;
          return styleSave.promise;
        });
        const theme = TestBed.inject(ThemeService);
        await theme.init();

        const style = theme.setStyle('tron');
        const mode = theme.setMode('dark');
        expect(attrs()).toEqual({ style: 'tron', theme: 'dark' });

        modeSave.resolve(diskFull); // the newer request fails first
        await expect(mode).rejects.toMatchObject({ code: 'INTERNAL' });
        expect(attrs()).toEqual({ style: 'tron', theme: 'light' }); // mode back to stored system

        stored = { ...stored, style: 'tron' };
        styleSave.resolve({ settings: { ...stored } });
        await style;
        expect(theme.style()).toBe('tron');
        expect(theme.mode()).toBe('system');
        expect(attrs()).toEqual({ style: 'tron', theme: 'light' });
      });

      it('both keys interleaved: an older style answer carrying the old mode does not hide a newer pending mode', async () => {
        const answers: (() => void)[] = [];
        fake.handle('app.settings.set', (params) => {
          stored = { ...stored, ...params.settings };
          const snapshot = { settings: { ...stored } };
          return new Promise((resolve) => answers.push(() => resolve(snapshot)));
        });
        const theme = TestBed.inject(ThemeService);
        await theme.init();

        const style = theme.setStyle('tron'); // answer: tron/system
        const mode = theme.setMode('dark'); // answer: tron/dark
        await flushAll();
        answers[0]?.();
        await style;
        expect(attrs()).toEqual({ style: 'tron', theme: 'dark' });
        answers[1]?.();
        await mode;
        expect(stored).toMatchObject({ style: 'tron', mode: 'dark' });
        expect(attrs()).toEqual({ style: 'tron', theme: 'dark' });
      });

      it('a new choice after a failed one shows again and is kept when it saves', async () => {
        let calls = 0;
        fake.handle('app.settings.set', (params) => {
          calls += 1;
          if (calls === 1) return diskFull;
          stored = { ...stored, ...params.settings };
          return { settings: { ...stored } };
        });
        const theme = TestBed.inject(ThemeService);
        await theme.init();

        await expect(theme.setMode('dark')).rejects.toMatchObject({ code: 'INTERNAL' });
        expect(theme.mode()).toBe('system');
        await theme.setMode('dark');
        expect(theme.mode()).toBe('dark');
        expect(attrs().theme).toBe('dark');
        expect(stored.mode).toBe('dark');
      });

      it('choosing the value that is already stored keeps it, whether the save succeeds or fails', async () => {
        let fail = false;
        fake.handle('app.settings.set', (params) => {
          if (fail) return diskFull;
          stored = { ...stored, ...params.settings };
          return { settings: { ...stored } };
        });
        const theme = TestBed.inject(ThemeService);
        await theme.init();

        await theme.setStyle('business');
        expect(attrs().style).toBe('business');
        fail = true;
        await expect(theme.setStyle('business')).rejects.toMatchObject({ code: 'INTERNAL' });
        expect(theme.style()).toBe('business');
        expect(attrs().style).toBe('business');
      });

      it('a value outside the contract is never shown, while the save is pending or after main refuses it', async () => {
        const save = deferred<Failure>();
        fake.handle('app.settings.set', () => save.promise);
        const theme = TestBed.inject(ThemeService);
        await theme.init();

        const style = theme.setStyle('neon' as Style);
        const mode = theme.setMode('dim' as ThemeMode);
        expect(theme.style()).toBe('business');
        expect(theme.mode()).toBe('system');
        expect(attrs()).toEqual({ style: 'business', theme: 'light' });

        save.resolve(diskFull); // main validates settings and refuses both
        await expect(style).rejects.toMatchObject({ code: 'INTERNAL' });
        await expect(mode).rejects.toMatchObject({ code: 'INTERNAL' });
        expect(attrs()).toEqual({ style: 'business', theme: 'light' });
      });

      it('a failed save while main is unreachable at startup falls back to the defaults', async () => {
        fake.fail('app.settings.get', { code: 'INTERNAL', message: 'main unavailable' });
        fake.fail('app.settings.set', { code: 'INTERNAL', message: 'main unavailable' });
        const theme = TestBed.inject(ThemeService);
        await theme.init();

        await expect(theme.setStyle('tron')).rejects.toMatchObject({ code: 'INTERNAL' });
        expect(attrs()).toEqual({ style: 'business', theme: 'light' });
      });
    });
  });
});

describe('provideTheme', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('themes the root at startup without waiting for the settings', async () => {
    const fake = new FakeThicketBridge();
    // main never answers: bootstrap must not hang on it.
    fake.handle('app.settings.get', () => new Promise(() => undefined));
    // TestBed's DOCUMENT is the global jsdom document; clear it before the initializers run.
    const root = document.documentElement;
    root.removeAttribute('data-style');
    root.removeAttribute('data-theme');
    TestBed.configureTestingModule({ providers: [provideFakeThicket(fake), provideTheme()] });

    await TestBed.inject(ApplicationInitStatus).donePromise;
    expect(TestBed.inject(DOCUMENT).documentElement).toBe(root);

    expect(root.getAttribute('data-style')).toBe('business');
    expect(root.getAttribute('data-theme')).toMatch(/^(light|dark)$/);
    expect(fake.requestsFor('app.settings.get')).toHaveLength(1);
  });

  it('is part of the root app config', () => {
    const fake = new FakeThicketBridge();
    fake.respond('app.settings.get', { settings: { ...SETTINGS, style: 'tron', mode: 'dark' } });
    TestBed.configureTestingModule({
      providers: [...appConfig.providers, provideFakeThicket(fake)],
    });
    TestBed.inject(ApplicationInitStatus);
    expect(fake.requestsFor('app.settings.get')).toHaveLength(1);
  });
});

describe('ThemeSwitcher', () => {
  let fake: FakeThicketBridge;

  beforeEach(() => {
    fake = new FakeThicketBridge();
    let stored = { ...SETTINGS };
    fake.handle('app.settings.get', () => ({ settings: { ...stored } }));
    fake.handle('app.settings.set', (params) => {
      stored = { ...stored, ...params.settings };
      return { settings: { ...stored } };
    });
    TestBed.configureTestingModule({ providers: [provideFakeThicket(fake)] });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('shows the current choice and switches style and mode', async () => {
    await TestBed.inject(ThemeService).init();
    const fixture = TestBed.createComponent(ThemeSwitcher);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const style = el.querySelector<HTMLSelectElement>('[data-testid=theme-style]');
    const mode = el.querySelector<HTMLSelectElement>('[data-testid=theme-mode]');
    if (!style || !mode) throw new Error('selects missing');
    expect(style.value).toBe('business');
    expect(mode.value).toBe('system');

    style.value = 'tron';
    style.dispatchEvent(new Event('change'));
    mode.value = 'dark';
    mode.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    await flushAll();

    const root = TestBed.inject(DOCUMENT).documentElement;
    expect(root.getAttribute('data-style')).toBe('tron');
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(fake.requestsFor('app.settings.set')).toHaveLength(2);
  });

  it('logs a failed save instead of throwing', async () => {
    fake.fail('app.settings.set', { code: 'INTERNAL', message: 'disk full' });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await TestBed.inject(ThemeService).init();
    const fixture = TestBed.createComponent(ThemeSwitcher);
    await fixture.whenStable();
    const style = (fixture.nativeElement as HTMLElement).querySelector('select');
    if (!style) throw new Error('select missing');
    style.value = 'tron';
    style.dispatchEvent(new Event('change'));
    await flushAll();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('logs a failed mode save and shows the stored mode again', async () => {
    const answer = deferred<{ error: { code: 'INTERNAL'; message: string } }>();
    fake.handle('app.settings.set', () => answer.promise);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await TestBed.inject(ThemeService).init();
    const fixture = TestBed.createComponent(ThemeSwitcher);
    await fixture.whenStable();
    const mode = (fixture.nativeElement as HTMLElement).querySelector<HTMLSelectElement>(
      '[data-testid=theme-mode]',
    );
    if (!mode) throw new Error('mode select missing');
    mode.value = 'dark';
    mode.dispatchEvent(new Event('change'));
    await fixture.whenStable(); // rendered while the save is pending (IPC answers later)
    answer.resolve({ error: { code: 'INTERNAL', message: 'disk full' } });
    await flushAll();
    await fixture.whenStable();
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ code: 'INTERNAL' }));
    expect(mode.value).toBe('system');
    log.mockRestore();
  });

  it('offers exactly the contract styles and modes', async () => {
    await TestBed.inject(ThemeService).init();
    const fixture = TestBed.createComponent(ThemeSwitcher);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const values = (id: string) =>
      [...el.querySelectorAll<HTMLOptionElement>(`[data-testid=${id}] option`)].map((o) => o.value);
    expect(values('theme-style')).toEqual([...STYLES]);
    expect([...values('theme-mode')].sort()).toEqual([...THEME_MODES].sort());
  });

  it('reflects a change made elsewhere (app.settings.changed)', async () => {
    await TestBed.inject(ThemeService).init();
    const fixture = TestBed.createComponent(ThemeSwitcher);
    await fixture.whenStable();
    fake.emit({
      stream: BROADCAST_STREAMS.settingsChanged,
      kind: 'data',
      payload: { settings: { ...SETTINGS, style: 'tron', mode: 'light' } },
    });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector<HTMLSelectElement>('[data-testid=theme-style]')?.value).toBe('tron');
    expect(el.querySelector<HTMLSelectElement>('[data-testid=theme-mode]')?.value).toBe('light');
  });
});

function flushAll(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
