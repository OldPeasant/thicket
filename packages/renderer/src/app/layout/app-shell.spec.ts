import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withHashLocation } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { BROADCAST_STREAMS, type Settings } from '@thicket/contract';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import { routes } from '../app.routes';
import { AppShell, SIDEBAR_KEY_STEP } from './app-shell';
import { NAV } from './navigation';
import { SidebarWidthService } from './sidebar-width.service';
import { StatusService } from './status.service';
import { provideTabView } from './tab-views';
import { WorkspaceService, type WorkspaceTab } from './workspace.service';

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

@Component({
  selector: 'app-test-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p class="test-view">view of {{ tab().id }}</p>`,
})
class TestView {
  readonly tab = input.required<WorkspaceTab>();
}

/** `value`, failing the test when the element is missing. */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('element not found');
  return value;
}

const tab = (id: string, extra: Partial<WorkspaceTab> = {}): WorkspaceTab => ({
  id,
  kind: 'collection',
  title: `title-${id}`,
  ...extra,
});

describe('AppShell', () => {
  let fake: FakeThicketBridge;
  let stored: Settings;
  let harness: RouterTestingHarness;
  let ws: WorkspaceService;
  let el: HTMLElement;

  async function start(url = '/'): Promise<void> {
    harness = await RouterTestingHarness.create(url);
    ws = TestBed.inject(WorkspaceService);
    el = harness.routeNativeElement as HTMLElement;
    await harness.fixture.whenStable();
  }

  const tabIds = () =>
    [...el.querySelectorAll<HTMLElement>('[data-testid="tab"]')].map((t) => t.dataset['tabId']);
  const activeTab = () =>
    el.querySelector<HTMLElement>('.tab.active[data-testid="tab"]')?.dataset['tabId'] ?? null;
  const visiblePanels = () =>
    [...el.querySelectorAll<HTMLElement>('[data-testid="tab-panel"]')]
      .filter((p) => !p.hidden)
      .map((p) => p.dataset['tabId']);
  const settle = () => harness.fixture.whenStable();
  const key = (init: KeyboardEventInit) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    document.body.dispatchEvent(event);
    return event;
  };

  beforeEach(() => {
    stored = { ...SETTINGS };
    fake = new FakeThicketBridge();
    fake.handle('app.settings.get', () => ({ settings: { ...stored } }));
    fake.handle('app.settings.set', (params) => {
      stored = { ...stored, ...params.settings };
      return { settings: { ...stored } };
    });
    TestBed.configureTestingModule({
      providers: [
        provideFakeThicket(fake),
        provideRouter(routes, withHashLocation()),
        provideTabView('collection', TestView),
      ],
    });
  });

  describe('tabs', () => {
    it('shows the welcome screen when no tab is open', async () => {
      await start();
      expect(el.querySelector('app-welcome')).not.toBeNull();
      expect(tabIds()).toEqual([]);
      expect(el.querySelector('[data-testid="tab-home"]')?.getAttribute('aria-selected')).toBe(
        'true',
      );
    });

    it('opens tabs and renders the registered view for the active one', async () => {
      await start();
      ws.open(tab('a'));
      ws.open(tab('b', { kind: 'shell', title: 'Shell', detail: 'local / test' }));
      await settle();
      expect(tabIds()).toEqual(['a', 'b']);
      expect(activeTab()).toBe('b');
      expect(visiblePanels()).toEqual(['b']);
      // `shell` has no registered view: the placeholder names the tab.
      const panelB = el.querySelector('[data-testid="tab-panel"][data-tab-id="b"]');
      expect(panelB?.querySelector('app-tab-placeholder h1')?.textContent).toBe('Shell');
      const panelA = el.querySelector('[data-testid="tab-panel"][data-tab-id="a"]');
      expect(panelA?.querySelector('.test-view')?.textContent).toBe('view of a');
      // The welcome pane is hidden while a tab is shown.
      expect(el.querySelector('app-welcome')?.closest<HTMLElement>('.pane')?.hidden).toBe(true);
    });

    it('selects a tab on click and goes back to the start page with the home tab', async () => {
      await start();
      ws.open(tab('a'));
      ws.open(tab('b'));
      await settle();
      el.querySelector<HTMLElement>('[data-tab-id="a"] button[role="tab"]')?.click();
      await settle();
      expect(activeTab()).toBe('a');
      expect(visiblePanels()).toEqual(['a']);
      el.querySelector<HTMLElement>('[data-testid="tab-home"]')?.click();
      await settle();
      expect(activeTab()).toBeNull();
      expect(visiblePanels()).toEqual([]);
    });

    it('closes a tab with its close button and by middle click', async () => {
      await start();
      ['a', 'b', 'c'].forEach((id) => ws.open(tab(id)));
      await settle();
      el.querySelector<HTMLElement>('[data-tab-id="b"] [data-testid="tab-close"]')?.click();
      await settle();
      expect(tabIds()).toEqual(['a', 'c']);
      expect(el.querySelector('[data-testid="tab-panel"][data-tab-id="b"]')).toBeNull();
      el.querySelector('[data-tab-id="a"]')?.dispatchEvent(
        new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }),
      );
      await settle();
      expect(tabIds()).toEqual(['c']);
      expect(activeTab()).toBe('c');
    });

    it('reorders tabs by drag and drop', async () => {
      await start();
      ['a', 'b', 'c'].forEach((id) => ws.open(tab(id)));
      await settle();
      const tabEl = (id: string) =>
        must(el.querySelector(`[data-testid="tab"][data-tab-id="${id}"]`));
      const fire = (target: Element, type: string) => {
        const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 0 });
        target.dispatchEvent(event);
        return event;
      };
      // Drag "c" onto "a" (left half: before it).
      fire(tabEl('c'), 'dragstart');
      const over = fire(tabEl('a'), 'dragover');
      expect(over.defaultPrevented).toBe(true);
      await settle();
      expect(tabEl('a').classList).toContain('drop-before');
      fire(tabEl('a'), 'drop');
      await settle();
      expect(tabIds()).toEqual(['c', 'a', 'b']);
      expect(el.querySelector('.drop-before, .dragging')).toBeNull();
      // Drag "c" onto "b": jsdom has no layout, so it lands before "b".
      fire(tabEl('c'), 'dragstart');
      fire(tabEl('b'), 'dragover');
      fire(tabEl('b'), 'drop');
      await settle();
      expect(tabIds()).toEqual(['a', 'c', 'b']);
    });

    it('ignores drag events that did not start on a tab', async () => {
      await start();
      ['a', 'b'].forEach((id) => ws.open(tab(id)));
      await settle();
      const target = must(el.querySelector('[data-tab-id="a"]'));
      const over = new MouseEvent('dragover', { bubbles: true, cancelable: true });
      target.dispatchEvent(over);
      target.dispatchEvent(new MouseEvent('drop', { bubbles: true, cancelable: true }));
      expect(over.defaultPrevented).toBe(false);
      expect(tabIds()).toEqual(['a', 'b']);
    });

    it('marks tabs of production connections', async () => {
      await start();
      ws.open(tab('p', { production: true }));
      await settle();
      expect(el.querySelector('[data-tab-id="p"]')?.classList).toContain('production');
    });

    it('following a link shows the routed page instead of the active tab', async () => {
      await start();
      ws.open(tab('a'));
      await settle();
      await harness.navigateByUrl(NAV.newConnection);
      await settle();
      expect(ws.activeId()).toBeNull();
      expect(el.querySelector('[data-testid="page-heading"]')?.textContent).toBe('New connection');
      expect(tabIds()).toEqual(['a']);
    });
  });

  describe('keyboard', () => {
    it('Ctrl+W and Cmd+W close the active tab and are always consumed', async () => {
      await start();
      ['a', 'b', 'c'].forEach((id) => ws.open(tab(id)));
      await settle();
      expect(key({ key: 'w', ctrlKey: true }).defaultPrevented).toBe(true);
      await settle();
      expect(tabIds()).toEqual(['a', 'b']);
      expect(activeTab()).toBe('b');
      key({ key: 'w', metaKey: true });
      await settle();
      expect(tabIds()).toEqual(['a']);
      key({ key: 'W', ctrlKey: true });
      await settle();
      expect(tabIds()).toEqual([]);
      // Nothing left to close: still consumed so the window stays open.
      expect(key({ key: 'w', ctrlKey: true }).defaultPrevented).toBe(true);
    });

    it('leaves W without a modifier, with Alt or with Shift alone', async () => {
      await start();
      ws.open(tab('a'));
      await settle();
      expect(key({ key: 'w' }).defaultPrevented).toBe(false);
      expect(key({ key: 'w', ctrlKey: true, altKey: true }).defaultPrevented).toBe(false);
      expect(key({ key: 'W', ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
      expect(tabIds()).toEqual(['a']);
    });

    it('Ctrl+Tab cycles forward, Ctrl+Shift+Tab backward, with wrap-around', async () => {
      await start();
      ['a', 'b', 'c'].forEach((id) => ws.open(tab(id)));
      await settle();
      expect(key({ key: 'Tab', ctrlKey: true }).defaultPrevented).toBe(true);
      await settle();
      expect(activeTab()).toBe('a');
      key({ key: 'Tab', ctrlKey: true });
      await settle();
      expect(activeTab()).toBe('b');
      key({ key: 'Tab', ctrlKey: true, shiftKey: true });
      key({ key: 'Tab', ctrlKey: true, shiftKey: true });
      await settle();
      expect(activeTab()).toBe('c');
      expect(visiblePanels()).toEqual(['c']);
      // Cmd+Tab works too (on macOS the OS usually takes it).
      key({ key: 'Tab', metaKey: true });
      await settle();
      expect(activeTab()).toBe('a');
    });

    it('Ctrl+PageDown/PageUp cycle, Ctrl+Shift+PageDown/PageUp move the active tab', async () => {
      await start();
      ['a', 'b', 'c'].forEach((id) => ws.open(tab(id)));
      ws.activate('a');
      await settle();
      key({ key: 'PageDown', ctrlKey: true });
      await settle();
      expect(activeTab()).toBe('b');
      key({ key: 'PageUp', ctrlKey: true, shiftKey: true });
      await settle();
      expect(tabIds()).toEqual(['b', 'a', 'c']);
      key({ key: 'PageDown', ctrlKey: true, shiftKey: true });
      key({ key: 'PageDown', ctrlKey: true, shiftKey: true });
      await settle();
      expect(tabIds()).toEqual(['a', 'c', 'b']);
      expect(activeTab()).toBe('b');
      key({ key: 'PageUp', ctrlKey: true });
      await settle();
      expect(activeTab()).toBe('c');
    });

    it('a plain Tab keeps moving focus', async () => {
      await start();
      ws.open(tab('a'));
      await settle();
      expect(key({ key: 'Tab' }).defaultPrevented).toBe(false);
    });
  });

  describe('sidebar width', () => {
    const width = () => getComputedStyle(el).getPropertyValue('--sidebar-width');
    const splitter = () => must(el.querySelector<HTMLElement>('[data-testid="splitter"]'));
    const pointer = (type: string, clientX: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, button: 0 });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      splitter().dispatchEvent(event);
    };

    it('applies the width stored in the settings', async () => {
      await start();
      await settle();
      expect(width()).toBe('300px');
      expect(splitter().getAttribute('aria-valuenow')).toBe('300');
    });

    it('drags the splitter: previews while moving, saves once on release', async () => {
      await start();
      await settle();
      pointer('pointerdown', 500);
      pointer('pointermove', 540);
      await settle();
      expect(width()).toBe('340px');
      expect(fake.requestsFor('app.settings.set')).toHaveLength(0);
      pointer('pointermove', 420);
      pointer('pointerup', 420);
      await settle();
      expect(width()).toBe('220px');
      expect(fake.requestsFor('app.settings.set').map((r) => r.params)).toEqual([
        { settings: { sidebarWidth: 220 } },
      ]);
      expect(stored.sidebarWidth).toBe(220);
    });

    it('keeps the width within the allowed range', async () => {
      await start();
      pointer('pointerdown', 500);
      pointer('pointermove', 0);
      pointer('pointerup', 0);
      await settle();
      expect(stored.sidebarWidth).toBe(180);
      pointer('pointerdown', 0);
      pointer('pointermove', 5000);
      pointer('pointerup', 5000);
      await settle();
      expect(stored.sidebarWidth).toBe(560);
    });

    it('resizes with the arrow keys, Home and End, and resets on double click', async () => {
      await start();
      await settle();
      splitter().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await settle();
      expect(stored.sidebarWidth).toBe(300 + SIDEBAR_KEY_STEP);
      splitter().dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
      await settle();
      expect(stored.sidebarWidth).toBe(180);
      splitter().dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
      await settle();
      expect(stored.sidebarWidth).toBe(560);
      splitter().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      await settle();
      expect(stored.sidebarWidth).toBe(560 - SIDEBAR_KEY_STEP);
      splitter().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await settle();
      expect(stored.sidebarWidth).toBe(260);
      expect(width()).toBe('260px');
    });

    it('persists across a new window: a fresh shell reads the saved width', async () => {
      await start();
      await TestBed.inject(SidebarWidthService).commit(410);
      expect(stored.sidebarWidth).toBe(410);

      TestBed.resetTestingModule();
      const fresh = new FakeThicketBridge();
      fresh.respond('app.settings.get', { settings: { ...stored } });
      TestBed.configureTestingModule({
        providers: [provideFakeThicket(fresh), provideRouter(routes, withHashLocation())],
      });
      await start();
      await settle();
      expect(width()).toBe('410px');
    });

    it('follows width changes broadcast from main', async () => {
      await start();
      await settle();
      fake.emit({
        stream: BROADCAST_STREAMS.settingsChanged,
        kind: 'data',
        payload: { settings: { ...stored, sidebarWidth: 444 } },
      });
      await settle();
      expect(width()).toBe('444px');
    });
  });

  describe('status bar', () => {
    it('shows no connection, then the connection and running operations', async () => {
      await start();
      const status = TestBed.inject(StatusService);
      const conn = () => el.querySelector('[data-testid="status-connection"]')?.textContent ?? '';
      const ops = () => el.querySelector('[data-testid="status-operations"]')?.textContent ?? '';
      expect(conn()).toContain('No connection');
      status.setConnection({ name: 'prod-eu', state: 'connected', production: true });
      const first = status.begin('Loading orders');
      const second = status.begin('Counting documents', 0.25);
      await settle();
      expect(conn()).toContain('prod-eu');
      expect(conn()).toContain('Connected');
      expect(conn()).toContain('Production');
      expect(ops()).toContain('Counting documents');
      expect(ops()).toContain('+1 more');
      expect(el.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('25');
      second.done();
      await settle();
      expect(ops()).toContain('Loading orders');
      expect(el.querySelector('[role="progressbar"]')?.hasAttribute('aria-valuenow')).toBe(false);
      first.done();
      await settle();
      expect(ops().trim()).toBe('');
    });
  });

  it('is the layout component of the root route', async () => {
    await start();
    expect(harness.routeDebugElement?.componentInstance).toBeInstanceOf(AppShell);
  });
});
