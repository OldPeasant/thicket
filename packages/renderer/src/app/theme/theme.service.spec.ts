import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { BROADCAST_STREAMS, type Settings } from '@thicket/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import { ThemeSwitcher } from './theme-switcher';
import { DARK_QUERY, ThemeService, resolveMode } from './theme.service';

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
});

function flushAll(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}
