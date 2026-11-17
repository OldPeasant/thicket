import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withHashLocation } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { BROADCAST_STREAMS, type Profile, type Settings } from '@thicket/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import { routes } from '../app.routes';
import { ConfirmService } from '../safety/confirm.service';
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

    it('shows the production accent while the active view is production', async () => {
      await start();
      const shell = () => (el.tagName === 'APP-SHELL' ? el : el.querySelector('app-shell'));
      expect(shell()?.hasAttribute('data-production')).toBe(false);
      TestBed.inject(StatusService).setConnection({
        name: 'prod',
        state: 'connected',
        production: true,
      });
      await settle();
      // Start page: the status bar's connection decides.
      expect(shell()?.classList).toContain('production');
      expect(el.querySelector('app-status-bar')?.classList).toContain('production');
      ws.open(tab('dev'));
      await settle();
      expect(shell()?.classList).not.toContain('production');
      ws.open(tab('p', { production: true }));
      await settle();
      expect(shell()?.hasAttribute('data-production')).toBe(true);
    });

    it('hosts the confirm dialog', async () => {
      await start();
      expect(el.querySelector('app-confirm-dialog')).not.toBeNull();
    });

    it('while the confirm dialog is open, the rest of the window is inert and shortcuts do nothing', async () => {
      await start();
      ['a', 'b', 'c'].forEach((id) => ws.open(tab(id)));
      await settle();
      const behind = () =>
        ['[data-testid="sidebar"]', '[data-testid="splitter"]', '.work', 'app-status-bar'].map(
          (selector) => must(el.querySelector(selector)).hasAttribute('inert'),
        );
      expect(behind()).toEqual([false, false, false, false]);

      const confirm = TestBed.inject(ConfirmService);
      const answer = confirm.confirm({ title: 'Delete', operation: 'op', confirmLabel: 'Delete' });
      await settle();
      expect(behind()).toEqual([true, true, true, true]);
      const dialog = must(el.querySelector<HTMLElement>('[data-testid="confirm-dialog"]'));
      expect(dialog.closest('[inert]')).toBeNull();

      // Shortcuts pressed inside the dialog are consumed but leave the tabs alone.
      const inDialog = (init: KeyboardEventInit) => {
        const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
        must(dialog.querySelector('[data-testid="confirm-cancel"]')).dispatchEvent(event);
        return event;
      };
      expect(inDialog({ key: 'w', ctrlKey: true }).defaultPrevented).toBe(true);
      inDialog({ key: 'w', metaKey: true });
      inDialog({ key: 'Tab', ctrlKey: true });
      inDialog({ key: 'PageUp', ctrlKey: true });
      inDialog({ key: 'PageUp', ctrlKey: true, shiftKey: true });
      expect(key({ key: 'w', ctrlKey: true }).defaultPrevented).toBe(true);
      await settle();
      expect(tabIds()).toEqual(['a', 'b', 'c']);
      expect(activeTab()).toBe('c');
      expect(confirm.current()).not.toBeNull();

      confirm.answer(false);
      await expect(answer).resolves.toBe(false);
      await settle();
      expect(behind()).toEqual([false, false, false, false]);
      key({ key: 'w', ctrlKey: true });
      await settle();
      expect(tabIds()).toEqual(['a', 'b']);
    });

    it('while the SSH host key dialog is open, the rest of the window is inert and shortcuts do nothing', async () => {
      fake.respond('conn.trustHostKey', {});
      await start();
      ['a', 'b'].forEach((id) => ws.open(tab(id)));
      await settle();
      expect(el.querySelector('app-host-key-dialog')).not.toBeNull();
      const behind = () =>
        ['[data-testid="sidebar"]', '[data-testid="splitter"]', '.work', 'app-status-bar'].map(
          (selector) => must(el.querySelector(selector)).hasAttribute('inert'),
        );
      expect(behind()).toEqual([false, false, false, false]);

      fake.emit({
        stream: BROADCAST_STREAMS.sshHostKey,
        kind: 'data',
        payload: {
          promptId: 'hk1',
          host: 'bastion.example',
          port: 22,
          keyType: 'ssh-ed25519',
          fingerprint: 'SHA256:fictitiousFingerprint',
          timeoutMS: 300_000,
        },
      });
      await settle();
      const dialog = must(el.querySelector<HTMLElement>('[data-testid="host-key-dialog"]'));
      expect(behind()).toEqual([true, true, true, true]);
      expect(dialog.closest('[inert]')).toBeNull();
      expect(key({ key: 'w', ctrlKey: true }).defaultPrevented).toBe(true);
      await settle();
      expect(tabIds()).toEqual(['a', 'b']);

      must(dialog.querySelector<HTMLElement>('[data-testid="host-key-reject"]')).click();
      await settle();
      await settle();
      expect(el.querySelector('[data-testid="host-key-dialog"]')).toBeNull();
      expect(behind()).toEqual([false, false, false, false]);
      expect(fake.requestsFor('conn.trustHostKey').map((r) => r.params)).toEqual([
        { promptId: 'hk1', trust: false },
      ]);
    });

    it('hosts the OIDC sign-in panel: not modal, inert only behind a modal dialog (test-writer)', async () => {
      fake.respond('conn.trustHostKey', {});
      await start();
      ['a', 'b'].forEach((id) => ws.open(tab(id)));
      await settle();
      const host = must(el.querySelector<HTMLElement>('app-oidc-sign-in'));
      fake.emit({
        stream: BROADCAST_STREAMS.oidcPrompt,
        kind: 'data',
        payload: {
          kind: 'device',
          promptId: 'o1',
          profileName: 'Fictitious Cluster',
          verificationUri: 'https://idp.example.test/device',
          userCode: 'WDJB-MJHT',
          expiresInSeconds: 600,
        },
      });
      await settle();
      expect(el.querySelector('[data-testid="oidc-sign-in"]')).not.toBeNull();
      // The sign-in panel does not block the window: nothing is inert, shortcuts work.
      expect(host.hasAttribute('inert')).toBe(false);
      expect(must(el.querySelector('.work')).hasAttribute('inert')).toBe(false);
      key({ key: 'w', ctrlKey: true });
      await settle();
      expect(tabIds()).toEqual(['a']);

      // A modal dialog on top makes the panel inert like the rest of the window.
      fake.emit({
        stream: BROADCAST_STREAMS.sshHostKey,
        kind: 'data',
        payload: {
          promptId: 'hk1',
          host: 'bastion.example',
          port: 22,
          keyType: 'ssh-ed25519',
          fingerprint: 'SHA256:fictitiousFingerprint',
          timeoutMS: 300_000,
        },
      });
      await settle();
      expect(host.hasAttribute('inert')).toBe(true);
      must(el.querySelector<HTMLElement>('[data-testid="host-key-reject"]')).click();
      await settle();
      await settle();
      expect(host.hasAttribute('inert')).toBe(false);
    });

    it('while the sidebar prompt is open, the work area is inert and shortcuts do nothing', async () => {
      fake.handle('profiles.list', () => ({
        profiles: [
          {
            id: 'p1',
            name: 'Asks',
            connectionString: 'mongodb://localhost:27017',
            readOnly: false,
            production: false,
            auth: { mechanism: 'SCRAM-SHA-256', username: 'u', secretMode: 'ask' },
          },
        ],
      }));
      fake.respond('conn.status', { connections: [] });
      await start();
      ['a', 'b', 'c'].forEach((id) => ws.open(tab(id)));
      await settle();
      const behind = () =>
        ['[data-testid="sidebar"]', '[data-testid="splitter"]', '.work', 'app-status-bar'].map(
          (selector) => must(el.querySelector(selector)).hasAttribute('inert'),
        );

      // Expanding the ask-each-time connection opens the sidebar's password prompt.
      must(el.querySelector<HTMLElement>('[data-testid="tree-conn"]')).click();
      await settle();
      const prompt = must(el.querySelector<HTMLElement>('[data-testid="tree-prompt"]'));
      // The sidebar (holding the prompt) stays usable; everything else is inert.
      expect(behind()).toEqual([false, true, true, true]);

      const password = must(prompt.querySelector<HTMLElement>('[data-testid="prompt-password"]'));
      const inPrompt = (init: KeyboardEventInit) => {
        const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
        password.dispatchEvent(event);
        return event;
      };
      expect(inPrompt({ key: 'w', ctrlKey: true }).defaultPrevented).toBe(true);
      expect(inPrompt({ key: 'Tab', ctrlKey: true }).defaultPrevented).toBe(true);
      inPrompt({ key: 'PageUp', ctrlKey: true });
      inPrompt({ key: 'PageUp', ctrlKey: true, shiftKey: true });
      await settle();
      expect(tabIds()).toEqual(['a', 'b', 'c']);
      expect(activeTab()).toBe('c');

      must(prompt.querySelector<HTMLElement>('[data-testid="prompt-cancel"]')).click();
      await settle();
      expect(el.querySelector('[data-testid="tree-prompt"]')).toBeNull();
      expect(behind()).toEqual([false, false, false, false]);
      key({ key: 'w', ctrlKey: true });
      await settle();
      expect(tabIds()).toEqual(['a', 'b']);
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

    it('Ctrl+W on the focused last tab moves focus to the Start tab', async () => {
      await start();
      ws.open(tab('a'));
      await settle();
      const only = must(
        el.querySelector<HTMLElement>('[data-testid="tab"][data-tab-id="a"] [role="tab"]'),
      );
      only.focus();
      only.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true, cancelable: true }),
      );
      await settle();
      expect(tabIds()).toEqual([]);
      expect(document.activeElement?.id).toBe('ws-start-tab');
    });

    it('Ctrl+W on the focused Start tab with no tab open keeps focus on Start', async () => {
      await start();
      const startTab = must(el.querySelector<HTMLElement>('#ws-start-tab'));
      startTab.focus();
      const event = new KeyboardEvent('keydown', {
        key: 'w',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      startTab.dispatchEvent(event);
      await settle();
      expect(event.defaultPrevented).toBe(true);
      expect(tabIds()).toEqual([]);
      expect(document.activeElement).toBe(startTab);
    });

    it('Ctrl+W with focus outside the tab strip leaves focus where it is', async () => {
      await start();
      ['a', 'b'].forEach((id) => ws.open(tab(id)));
      await settle();
      const splitter = must(el.querySelector<HTMLElement>('[data-testid="splitter"]'));
      splitter.focus();
      splitter.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true, cancelable: true }),
      );
      await settle();
      expect(tabIds()).toEqual(['a']);
      expect(document.activeElement).toBe(splitter);
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
      el.querySelector<HTMLElement>('[data-testid="sidebar-add"]')?.click();
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
      el.querySelector<HTMLElement>('[data-testid="sidebar-add"]')?.click();
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

    it("shows the active collection tab's connection and follows its state", async () => {
      const shop: Profile = {
        id: 'p1',
        name: 'Shop',
        connectionString: 'mongodb://localhost:27017',
        readOnly: true,
        production: true,
      };
      fake.respond('profiles.list', { profiles: [shop] });
      fake.respond('conn.status', { connections: [{ profileId: 'p1', state: 'connected' }] });
      await start();
      await settle();
      const conn = () => el.querySelector('[data-testid="status-connection"]')?.textContent ?? '';
      const bar = () => must(el.querySelector<HTMLElement>('app-status-bar'));
      expect(conn()).toContain('No connection');

      ws.open(
        tab('collection:p1:shop.orders', {
          production: true,
          data: { profileId: 'p1', db: 'shop', coll: 'orders', type: 'collection' },
        }),
      );
      await settle();
      expect(conn()).toContain('Shop');
      expect(conn()).toContain('Connected');
      expect(conn()).toContain('Production');
      expect(conn()).toContain('Read-only');
      expect(conn()).not.toContain('No connection');
      expect(bar().classList).toContain('production');

      fake.emit({
        stream: BROADCAST_STREAMS.connStatus,
        kind: 'data',
        payload: { profileId: 'p1', state: 'disconnected' },
      });
      await settle();
      expect(conn()).toContain('Shop');
      expect(conn()).toContain('Disconnected');

      // A tab without a known profile and the start page show the status service's connection.
      ws.open(tab('plain'));
      await settle();
      expect(conn()).toContain('No connection');
      ws.activate('collection:p1:shop.orders');
      await settle();
      expect(conn()).toContain('Shop');
      ws.showHome();
      await settle();
      expect(conn()).toContain('No connection');
      expect(bar().classList).not.toContain('production');
    });
  });

  it('is the layout component of the root route', async () => {
    await start();
    expect(harness.routeDebugElement?.componentInstance).toBeInstanceOf(AppShell);
  });
});
