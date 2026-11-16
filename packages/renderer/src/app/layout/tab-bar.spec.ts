import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TabBar } from './tab-bar';
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

  it('labels the close button with the tab title', () => {
    expect(tabEl('b').querySelector('[data-testid="tab-close"]')?.getAttribute('aria-label')).toBe(
      'Close title-b',
    );
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
