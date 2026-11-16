import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { START_PANEL_DOM_ID, START_TAB_DOM_ID, TabBar, tabDomId, tabPanelDomId } from './tab-bar';
import { WorkspaceService, type WorkspaceTab } from './workspace.service';

const tab = (id: string, extra: Partial<WorkspaceTab> = {}): WorkspaceTab => ({
  id,
  kind: 'collection',
  title: `title-${id}`,
  ...extra,
});

/** `value`, failing the test when the element is missing. */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('element not found');
  return value;
}

describe('TabBar', () => {
  let fixture: ComponentFixture<TabBar>;
  let ws: WorkspaceService;
  let el: HTMLElement;

  const render = () => fixture.whenStable();
  const ids = () =>
    [...el.querySelectorAll<HTMLElement>('[data-testid="tab"]')].map((t) => t.dataset['tabId']);
  const tabEl = (id: string) =>
    must(el.querySelector<HTMLElement>(`[data-testid="tab"][data-tab-id="${id}"]`));
  /** Drag events; jsdom has no DragEvent, so `dataTransfer` can be supplied explicitly. */
  const fire = (target: Element, type: string, clientX = 0, dataTransfer?: object) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX });
    if (dataTransfer) Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
    target.dispatchEvent(event);
    return event;
  };
  /** Gives every tab a 100px wide box at `left` (jsdom has no layout). */
  const layout = () =>
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 100,
      top: 0,
      height: 20,
      right: 100,
      bottom: 20,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

  beforeEach(async () => {
    fixture = TestBed.createComponent(TabBar);
    ws = TestBed.inject(WorkspaceService);
    el = fixture.nativeElement as HTMLElement;
    ['a', 'b', 'c'].forEach((id) => ws.open(tab(id)));
    await render();
  });

  afterEach(() => vi.restoreAllMocks());

  it('marks the selected tab for assistive technology; the home tab when none is shown', async () => {
    const selected = () =>
      [...el.querySelectorAll('[role="tab"][aria-selected="true"]')].map(
        (t) => t.closest<HTMLElement>('[data-testid="tab"]')?.dataset['tabId'] ?? 'home',
      );
    expect(selected()).toEqual(['c']);
    ws.showHome();
    await render();
    expect(selected()).toEqual(['home']);
  });

  it('shows the detail and uses title and detail as tooltip', async () => {
    ws.open(tab('d', { title: 'orders', detail: 'local / shop' }));
    await render();
    const select = tabEl('d').querySelector('button.select');
    expect(select?.querySelector('.detail')?.textContent).toBe('local / shop');
    expect(select?.getAttribute('title')).toBe('orders — local / shop');
    expect(tabEl('a').querySelector('.detail')).toBeNull();
    expect(tabEl('a').querySelector('button.select')?.getAttribute('title')).toBe('title-a');
  });

  it('the close button is pointer only: no Tab stop, hidden from assistive technology', () => {
    const close = must(tabEl('b').querySelector<HTMLElement>('[data-testid="tab-close"]'));
    expect(close.getAttribute('title')).toBe('Close title-b');
    expect(close.getAttribute('tabindex')).toBe('-1');
    expect(close.getAttribute('aria-hidden')).toBe('true');
  });

  describe('ARIA tabs pattern', () => {
    const tabs = () => [...el.querySelectorAll<HTMLElement>('[role="tab"]')];
    const homeTab = () => must(el.querySelector<HTMLElement>('[data-testid="tab-home"]'));
    const selectEl = (id: string) => must(tabEl(id).querySelector<HTMLElement>('[role="tab"]'));
    const press = (target: HTMLElement, key: string, init: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(event);
      return event;
    };
    /** The tab (by workspace id, `home` for Start) that has focus. */
    const focused = () => {
      const active = document.activeElement as HTMLElement | null;
      if (active === homeTab()) return 'home';
      return active?.closest<HTMLElement>('[data-testid="tab"]')?.dataset['tabId'] ?? null;
    };

    it('the tablist owns only tabs: tab wrappers are presentational, close buttons hidden', () => {
      const list = must(el.querySelector('[role="tablist"]'));
      expect(list.getAttribute('aria-label')).toBe('Open tabs');
      for (const child of list.children) {
        expect(['tab', 'presentation']).toContain(child.getAttribute('role'));
      }
      // Everything inside a wrapper that is not hidden from assistive technology is the tab.
      for (const wrapper of el.querySelectorAll('[data-testid="tab"]')) {
        expect(wrapper.getAttribute('role')).toBe('presentation');
        const exposed = [...wrapper.children].filter(
          (c) => c.getAttribute('aria-hidden') !== 'true',
        );
        expect(exposed.map((c) => c.getAttribute('role'))).toEqual(['tab']);
      }
      expect(tabs()).toHaveLength(4);
    });

    it('every tab has an id and controls its panel', () => {
      expect(homeTab().id).toBe(START_TAB_DOM_ID);
      expect(homeTab().getAttribute('aria-controls')).toBe(START_PANEL_DOM_ID);
      expect(selectEl('b').id).toBe(tabDomId('b'));
      expect(selectEl('b').getAttribute('aria-controls')).toBe(tabPanelDomId('b'));
      expect(new Set(tabs().map((t) => t.id)).size).toBe(4);
    });

    it('tab ids with spaces or quotes still give valid IDREFs', () => {
      expect(tabDomId('local / shop "orders"')).not.toMatch(/\s|"/);
      expect(tabPanelDomId('a b')).not.toBe(tabPanelDomId('a  b'));
    });

    it('roving tabindex: only the selected tab is a Tab stop', async () => {
      expect(tabs().map((t) => t.getAttribute('tabindex'))).toEqual(['-1', '-1', '-1', '0']);
      ws.showHome();
      await render();
      expect(tabs().map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1']);
    });

    it('ArrowLeft/ArrowRight select and focus the neighbour, wrapping over Start', async () => {
      selectEl('c').focus();
      expect(press(selectEl('c'), 'ArrowRight').defaultPrevented).toBe(true);
      await render();
      expect(ws.activeId()).toBeNull();
      expect(focused()).toBe('home');
      press(homeTab(), 'ArrowRight');
      await render();
      expect(ws.activeId()).toBe('a');
      expect(focused()).toBe('a');
      press(selectEl('a'), 'ArrowLeft');
      press(homeTab(), 'ArrowLeft');
      await render();
      expect(ws.activeId()).toBe('c');
      expect(focused()).toBe('c');
      expect(selectEl('c').getAttribute('tabindex')).toBe('0');
    });

    it('Home and End select and focus the first and the last tab', async () => {
      press(selectEl('b'), 'Home');
      await render();
      expect(ws.activeId()).toBeNull();
      expect(focused()).toBe('home');
      press(homeTab(), 'End');
      await render();
      expect(ws.activeId()).toBe('c');
      expect(focused()).toBe('c');
    });

    it('ignores other keys, modified keys and keys on the close button', async () => {
      expect(press(selectEl('c'), 'a').defaultPrevented).toBe(false);
      expect(press(selectEl('c'), 'ArrowLeft', { ctrlKey: true }).defaultPrevented).toBe(false);
      const close = must(tabEl('c').querySelector<HTMLElement>('[data-testid="tab-close"]'));
      expect(press(close, 'Delete').defaultPrevented).toBe(false);
      await render();
      expect(ws.activeId()).toBe('c');
      expect(ids()).toEqual(['a', 'b', 'c']);
    });

    it('Delete closes the focused tab and focuses the newly selected one', async () => {
      ws.activate('b');
      await render();
      selectEl('b').focus();
      expect(press(selectEl('b'), 'Delete').defaultPrevented).toBe(true);
      await render();
      expect(ids()).toEqual(['a', 'c']);
      expect(ws.activeId()).toBe('c');
      expect(focused()).toBe('c');
      press(selectEl('c'), 'Delete');
      press(selectEl('a'), 'Delete');
      await render();
      expect(ids()).toEqual([]);
      expect(focused()).toBe('home');
    });

    it('Delete on the Start tab closes nothing', async () => {
      ws.showHome();
      await render();
      expect(press(homeTab(), 'Delete').defaultPrevented).toBe(false);
      expect(ids()).toEqual(['a', 'b', 'c']);
    });

    it('closing the active tab with its button focuses the newly selected tab', async () => {
      must(tabEl('c').querySelector<HTMLElement>('[data-testid="tab-close"]')).click();
      await render();
      expect(ids()).toEqual(['a', 'b']);
      expect(focused()).toBe('b');
    });

    it('closing a background tab keeps focus outside the strip where it was', async () => {
      const outside = document.createElement('input');
      document.body.append(outside);
      outside.focus();
      must(tabEl('a').querySelector<HTMLElement>('[data-testid="tab-close"]')).click();
      await render();
      expect(ids()).toEqual(['b', 'c']);
      expect(document.activeElement).toBe(outside);
      outside.remove();
    });

    it('closing a background tab whose button had focus focuses the selected tab', async () => {
      const close = must(tabEl('a').querySelector<HTMLElement>('[data-testid="tab-close"]'));
      close.focus();
      close.click();
      await render();
      expect(ids()).toEqual(['b', 'c']);
      expect(focused()).toBe('c');
    });

    it('a middle click on the active tab focuses the newly selected tab', async () => {
      tabEl('c').dispatchEvent(
        new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }),
      );
      await render();
      expect(ids()).toEqual(['a', 'b']);
      expect(focused()).toBe('b');
    });
  });

  it('a non-middle auxclick does not close the tab', async () => {
    const event = new MouseEvent('auxclick', { button: 2, bubbles: true, cancelable: true });
    tabEl('a').dispatchEvent(event);
    await render();
    expect(ids()).toEqual(['a', 'b', 'c']);
    expect(event.defaultPrevented).toBe(false);
  });

  it('dragstart offers a move with the tab title as text', () => {
    const data = { effectAllowed: '', setData: vi.fn() };
    fire(tabEl('b'), 'dragstart', 0, data);
    expect(data.effectAllowed).toBe('move');
    expect(data.setData).toHaveBeenCalledWith('text/plain', 'title-b');
  });

  it('dropping on the right half of a tab places it after that tab', async () => {
    layout();
    fire(tabEl('a'), 'dragstart');
    const transfer = { dropEffect: '' };
    fire(tabEl('b'), 'dragover', 80, transfer);
    expect(transfer.dropEffect).toBe('move');
    fire(tabEl('b'), 'drop');
    await render();
    expect(ids()).toEqual(['b', 'a', 'c']);
  });

  it('shows the drop marker after the last tab and drops there', async () => {
    layout();
    fire(tabEl('a'), 'dragstart');
    fire(tabEl('c'), 'dragover', 80);
    await render();
    expect(tabEl('c').classList).toContain('drop-after');
    expect(tabEl('a').classList).toContain('dragging');
    fire(tabEl('c'), 'drop');
    await render();
    expect(ids()).toEqual(['b', 'c', 'a']);
    expect(el.querySelector('.drop-after, .dragging')).toBeNull();
  });

  it('dropping a tab onto itself keeps the order', async () => {
    layout();
    fire(tabEl('b'), 'dragstart');
    fire(tabEl('b'), 'dragover', 80);
    fire(tabEl('b'), 'drop');
    fire(tabEl('b'), 'dragstart');
    fire(tabEl('b'), 'dragover', 10);
    fire(tabEl('b'), 'drop');
    await render();
    expect(ids()).toEqual(['a', 'b', 'c']);
  });

  it('a drag cancelled with dragend clears the markers and moves nothing', async () => {
    fire(tabEl('a'), 'dragstart');
    fire(tabEl('c'), 'dragover');
    await render();
    expect(tabEl('c').classList).toContain('drop-before');
    fire(tabEl('a'), 'dragend');
    await render();
    expect(el.querySelector('.drop-before, .drop-after, .dragging')).toBeNull();
    // A later stray drop (no drag running) changes nothing.
    fire(tabEl('c'), 'drop');
    await render();
    expect(ids()).toEqual(['a', 'b', 'c']);
  });

  it('a drop without a dragover changes nothing', async () => {
    fire(tabEl('a'), 'dragstart');
    const drop = fire(tabEl('c'), 'drop');
    await render();
    expect(drop.defaultPrevented).toBe(false);
    expect(ids()).toEqual(['a', 'b', 'c']);
  });

  it('closing the active tab with its button keeps the strip in sync', async () => {
    tabEl('c').querySelector<HTMLElement>('[data-testid="tab-close"]')?.click();
    await render();
    expect(ids()).toEqual(['a', 'b']);
    expect(el.querySelector('.tab.active[data-testid="tab"]')?.getAttribute('data-tab-id')).toBe(
      'b',
    );
  });
});
