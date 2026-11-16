import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withHashLocation } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { BROADCAST_STREAMS, type Settings } from '@thicket/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

    it('Ctrl+W on the physical W key of a non-Latin layout closes the tab too', async () => {
      await start();
      ['a', 'b'].forEach((id) => ws.open(tab(id)));
      await settle();
      expect(key({ key: 'ц', code: 'KeyW', ctrlKey: true }).defaultPrevented).toBe(true);
      await settle();
      expect(tabIds()).toEqual(['a']);
      expect(key({ key: 'ς', code: 'KeyW', metaKey: true }).defaultPrevented).toBe(true);
      await settle();
      expect(tabIds()).toEqual([]);
    });

    it('the physical W key with Shift or Alt is left alone, like Latin W', async () => {
      await start();
      ws.open(tab('a'));
      await settle();
      expect(key({ key: 'Ц', code: 'KeyW', ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(
        false,
      );
      expect(key({ key: 'ц', code: 'KeyW', ctrlKey: true, altKey: true }).defaultPrevented).toBe(
        false,
      );
      expect(key({ key: 'ц', code: 'KeyW' }).defaultPrevented).toBe(false);
      await settle();
      expect(tabIds()).toEqual(['a']);
    });

    it('a Latin W typed on another physical key still closes the tab (Dvorak)', async () => {
      await start();
      ws.open(tab('a'));
      await settle();
      expect(key({ key: 'w', code: 'Comma', ctrlKey: true }).defaultPrevented).toBe(true);
      await settle();
      expect(tabIds()).toEqual([]);
    });

    it('Ctrl+W with focus on the closed tab moves focus to the newly selected tab', async () => {
      await start();
      ['a', 'b'].forEach((id) => ws.open(tab(id)));
      await settle();
      const selectOf = (id: string) =>
        must(
          el.querySelector<HTMLElement>(`[data-testid="tab"][data-tab-id="${id}"] [role="tab"]`),
        );
      selectOf('b').focus();
      expect(document.activeElement).toBe(selectOf('b'));
      selectOf('b').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true, cancelable: true }),
      );
      await settle();
      expect(tabIds()).toEqual(['a']);
      // Focus must not fall back to <body> with the removed tab (as for Delete and the × button).
      expect(document.activeElement).toBe(selectOf('a'));
    });

    it('a Latin letter on the W key (AZERTY Ctrl+Z) is not taken for Ctrl+W', async () => {
      await start();
      ws.open(tab('a'));
      await settle();
      expect(key({ key: 'z', code: 'KeyW', ctrlKey: true }).defaultPrevented).toBe(false);
      await settle();
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

    it('quick arrow presses with saves in flight all count, despite earlier broadcasts', async () => {
      stored = { ...stored, sidebarWidth: 260 };
      // Main answers each save later and then broadcasts the saved settings.
      const answers: (() => void)[] = [];
      fake.handle(
        'app.settings.set',
        (params) =>
          new Promise<{ settings: Settings }>((resolve) =>
            answers.push(() => {
              stored = { ...stored, ...params.settings };
              resolve({ settings: { ...stored } });
              fake.emit({
                stream: BROADCAST_STREAMS.settingsChanged,
                kind: 'data',
                payload: { settings: { ...stored } },
              });
            }),
          ),
      );
      await start();
      await settle();
      expect(width()).toBe('260px');
      const arrowRight = () =>
        splitter().dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
        );
      arrowRight();
      arrowRight();
      await vi.waitFor(() => expect(answers).toHaveLength(2));
      answers[0]?.();
      await settle();
      expect(width()).toBe('292px');
      arrowRight();
      await vi.waitFor(() => expect(answers).toHaveLength(3));
      answers[1]?.();
      await settle();
      expect(width()).toBe('308px');
      answers[2]?.();
      await settle();
      expect(width()).toBe('308px');
      expect(splitter().getAttribute('aria-valuenow')).toBe('308');
      expect(stored.sidebarWidth).toBe(308);
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

  describe('sidebar width edge cases', () => {
    const width = () => getComputedStyle(el).getPropertyValue('--sidebar-width');
    const splitter = () => must(el.querySelector<HTMLElement>('[data-testid="splitter"]'));
    const pointer = (
      type: string,
      clientX: number,
      init: { button?: number; id?: number } = {},
    ) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX,
        button: init.button ?? 0,
      });
      Object.defineProperty(event, 'pointerId', { value: init.id ?? 1 });
      splitter().dispatchEvent(event);
      return event;
    };

    afterEach(() => vi.restoreAllMocks());

    it('exposes the range on the separator', async () => {
      await start();
      expect(splitter().getAttribute('role')).toBe('separator');
      expect(splitter().getAttribute('aria-valuemin')).toBe('180');
      expect(splitter().getAttribute('aria-valuemax')).toBe('560');
    });

    it('ignores other keys on the splitter', async () => {
      await start();
      const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
      splitter().dispatchEvent(event);
      await settle();
      expect(event.defaultPrevented).toBe(false);
      expect(fake.requestsFor('app.settings.set')).toHaveLength(0);
    });

    it('ignores drags with a button other than the primary one', async () => {
      await start();
      expect(pointer('pointerdown', 500, { button: 2 }).defaultPrevented).toBe(false);
      pointer('pointermove', 600);
      pointer('pointerup', 600);
      await settle();
      expect(width()).toBe('300px');
      expect(fake.requestsFor('app.settings.set')).toHaveLength(0);
    });

    it('ignores moves without a drag and pointers other than the dragging one', async () => {
      await start();
      pointer('pointermove', 900);
      await settle();
      expect(width()).toBe('300px');
      pointer('pointerdown', 500);
      pointer('pointermove', 600, { id: 2 });
      pointer('pointerup', 600, { id: 2 });
      await settle();
      expect(width()).toBe('300px');
      expect(fake.requestsFor('app.settings.set')).toHaveLength(0);
      pointer('pointermove', 520);
      pointer('pointerup', 520);
      await settle();
      expect(stored.sidebarWidth).toBe(320);
    });

    it('a cancelled pointer saves the width reached so far', async () => {
      await start();
      pointer('pointerdown', 500);
      pointer('pointermove', 450);
      pointer('pointercancel', 450);
      await settle();
      expect(stored.sidebarWidth).toBe(250);
    });

    it('a click on the splitter without moving saves nothing', async () => {
      await start();
      pointer('pointerdown', 500);
      pointer('pointerup', 500);
      await settle();
      expect(fake.requestsFor('app.settings.set')).toHaveLength(0);
    });

    it('a failed save is logged and the stored width is shown again', async () => {
      await start();
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      fake.fail('app.settings.set', { code: 'INTERNAL', message: 'settings locked' });
      pointer('pointerdown', 500);
      pointer('pointermove', 600);
      await settle();
      expect(width()).toBe('400px');
      pointer('pointerup', 600);
      await settle();
      await vi.waitFor(() => expect(log).toHaveBeenCalled());
      await settle();
      expect(width()).toBe('300px');
      expect(stored.sidebarWidth).toBe(300);
    });
  });

  describe('keyboard edge cases', () => {
    it('Ctrl+Shift+PageUp/PageDown on the start page moves nothing', async () => {
      await start();
      ['a', 'b'].forEach((id) => ws.open(tab(id)));
      ws.showHome();
      await settle();
      expect(key({ key: 'PageUp', ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
      key({ key: 'PageDown', ctrlKey: true, shiftKey: true });
      await settle();
      expect(tabIds()).toEqual(['a', 'b']);
      expect(ws.activeId()).toBeNull();
    });

    it('moving the first tab further left or the last further right keeps the order', async () => {
      await start();
      ['a', 'b'].forEach((id) => ws.open(tab(id)));
      key({ key: 'PageDown', ctrlKey: true, shiftKey: true });
      ws.activate('a');
      key({ key: 'PageUp', ctrlKey: true, shiftKey: true });
      await settle();
      expect(tabIds()).toEqual(['a', 'b']);
    });

    it('Cmd+PageDown (no Ctrl) is left to the system', async () => {
      await start();
      ['a', 'b'].forEach((id) => ws.open(tab(id)));
      ws.activate('a');
      await settle();
      expect(key({ key: 'PageDown', metaKey: true }).defaultPrevented).toBe(false);
      expect(ws.activeId()).toBe('a');
    });

    it('Ctrl+Tab with no tab open stays on the start page', async () => {
      await start();
      key({ key: 'Tab', ctrlKey: true });
      await settle();
      expect(ws.activeId()).toBeNull();
      expect(el.querySelector('app-welcome')?.closest<HTMLElement>('.pane')?.hidden).toBe(false);
    });

    it('Ctrl+W on the start page with tabs open closes none of them', async () => {
      await start();
      ['a', 'b'].forEach((id) => ws.open(tab(id)));
      ws.showHome();
      await settle();
      expect(key({ key: 'w', ctrlKey: true }).defaultPrevented).toBe(true);
      await settle();
      expect(tabIds()).toEqual(['a', 'b']);
    });

    it('closing the last tab with Ctrl+W shows the welcome screen again', async () => {
      await start();
      ws.open(tab('a'));
      await settle();
      key({ key: 'w', ctrlKey: true });
      await settle();
      expect(el.querySelector('app-welcome')?.closest<HTMLElement>('.pane')?.hidden).toBe(false);
      expect(el.querySelector('[data-testid="tab-home"]')?.getAttribute('aria-selected')).toBe(
        'true',
      );
    });
  });

  describe('tab views', () => {
    it('the placeholder shows the detail of a tab without a registered view', async () => {
      await start();
      ws.open(tab('s', { kind: 'admin', title: 'Current operations', detail: 'local / admin' }));
      await settle();
      const panel = el.querySelector('[data-testid="tab-panel"][data-tab-id="s"]');
      expect(panel?.getAttribute('role')).toBe('tabpanel');
      // The panel is named by its tab, which controls it.
      const labelledBy = must(panel?.getAttribute('aria-labelledby'));
      const owner = must(el.ownerDocument.getElementById(labelledBy));
      expect(owner.getAttribute('role')).toBe('tab');
      expect(owner.textContent).toContain('Current operations');
      expect(owner.getAttribute('aria-controls')).toBe(panel?.id);
      expect(panel?.querySelector('app-tab-placeholder .detail')?.textContent).toBe(
        'local / admin',
      );
    });

    it('tab and panel point at each other also for ids that need encoding', async () => {
      await start();
      const id = 'local / shop "orders"';
      ws.open(tab(id));
      await settle();
      const doc = el.ownerDocument;
      const select = must(
        el.querySelector<HTMLElement>('[data-testid="tab"] [role="tab"][aria-controls]'),
      );
      const panel = must(doc.getElementById(must(select.getAttribute('aria-controls'))));
      expect(panel.getAttribute('role')).toBe('tabpanel');
      expect(panel.dataset['tabId']).toBe(id);
      expect(doc.getElementById(must(panel.getAttribute('aria-labelledby')))).toBe(select);
      // DOM ids are unique across the strip and the panes.
      const ids = [...el.querySelectorAll('[id]')].map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('the routed start page is the tab panel of the Start tab', async () => {
      await start();
      ws.open(tab('a'));
      await settle();
      const home = must(el.querySelector<HTMLElement>('[data-testid="tab-home"]'));
      const pane = must(el.querySelector('app-welcome')?.closest<HTMLElement>('.pane'));
      expect(pane.getAttribute('role')).toBe('tabpanel');
      expect(home.getAttribute('aria-controls')).toBe(pane.id);
      expect(pane.getAttribute('aria-labelledby')).toBe(home.id);
    });

    it('keeps the views of background tabs alive while switching', async () => {
      await start();
      ['a', 'b'].forEach((id) => ws.open(tab(id)));
      await settle();
      const viewA = el.querySelector('[data-tab-id="a"] .test-view');
      ws.activate('a');
      await settle();
      expect(el.querySelector('[data-tab-id="a"] .test-view')).toBe(viewA);
    });

    it('the sidebar "New connection" link opens the connection editor page', async () => {
      await start();
      ws.open(tab('a'));
      await settle();
      el.querySelector<HTMLElement>('[data-testid="sidebar-new"]')?.click();
      await settle();
      expect(TestBed.inject(Router).url).toBe(NAV.newConnection);
      expect(ws.activeId()).toBeNull();
      expect(el.querySelector('[data-testid="page-heading"]')?.textContent).toBe('New connection');
    });

    it('the sidebar link shows its page again when its URL is already the current one', async () => {
      await start(NAV.newConnection);
      ws.open(tab('a'));
      await settle();
      expect(ws.activeId()).toBe('a');
      el.querySelector<HTMLElement>('[data-testid="sidebar-new"]')?.click();
      await settle();
      expect(TestBed.inject(Router).url).toBe(NAV.newConnection);
      expect(ws.activeId()).toBeNull();
      const heading = must(el.querySelector<HTMLElement>('[data-testid="page-heading"]'));
      expect(heading.textContent).toBe('New connection');
      expect(heading.closest<HTMLElement>('.pane')?.hidden).toBe(false);
      expect(tabIds()).toEqual(['a']);
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
