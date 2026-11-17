import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../../api/testing';
import type { WorkspaceTab } from '../../layout/workspace.service';
import { ConfirmService } from '../../safety/confirm.service';
import { ProfileSafetyService } from '../../safety/profile-safety.service';
import { CurrentOpView, currentOpTabId } from './currentop-view';

const TAB: WorkspaceTab = {
  id: currentOpTabId('p1'),
  kind: 'currentop',
  title: 'Current operations',
  data: { profileId: 'p1' },
};

const SLOW = JSON.stringify({
  opid: { $numberInt: '42' },
  op: 'query',
  ns: 'shop.orders',
  active: true,
  microsecs_running: { $numberLong: '75000000' },
  client: '10.0.0.5:51234',
  appName: 'reporter',
  desc: 'conn12',
  command: { find: 'orders', filter: { $where: 'sleep(100)' } },
  planSummary: 'COLLSCAN',
});
const FAST = JSON.stringify({
  opid: { $numberInt: '43' },
  op: 'insert',
  ns: 'shop.orders',
  active: true,
  microsecs_running: { $numberLong: '1500' },
  desc: 'conn13',
});
const IDLE = JSON.stringify({ opid: { $numberInt: '7' }, op: 'none', ns: '', active: false });

describe('CurrentOpView', () => {
  let fake: FakeThicketBridge;
  let fixture: ComponentFixture<CurrentOpView>;
  let view: CurrentOpView;
  let confirm: ConfirmService;
  let ops: string[];

  const el = () => fixture.nativeElement as HTMLElement;
  const all = <T extends HTMLElement = HTMLElement>(id: string, root: ParentNode = el()) => [
    ...root.querySelectorAll<T>(`[data-testid="${id}"]`),
  ];
  const get = <T extends HTMLElement = HTMLElement>(id: string, root: ParentNode = el()): T => {
    const found = root.querySelector<T>(`[data-testid="${id}"]`);
    if (found === null) throw new Error(`no element ${id}`);
    return found;
  };
  const row = (opid: string): HTMLElement => {
    const found = el().querySelector<HTMLElement>(
      `[data-testid="currentop-row"][data-opid="${opid}"]`,
    );
    if (found === null) throw new Error(`no row ${opid}`);
    return found;
  };
  const text = (e: Element | null) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const settle = async () => {
    for (let i = 0; i < 6; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
  };
  const sent = (method: 'admin.currentOp' | 'admin.killOp') =>
    fake.requestsFor(method).map((r) => r.params as Record<string, unknown>);
  const setProfile = (readOnly: boolean) =>
    TestBed.inject(ProfileSafetyService).set({
      id: 'p1',
      name: 'Local',
      readOnly,
      production: false,
    });
  const create = async () => {
    fixture = TestBed.createComponent(CurrentOpView);
    view = fixture.componentInstance;
    fixture.componentRef.setInput('tab', TAB);
    await settle();
  };

  beforeEach(() => {
    fake = new FakeThicketBridge();
    ops = [SLOW, FAST];
    fake.handle('admin.currentOp', () => ({ ops }));
    fake.respond('admin.killOp', {});
    TestBed.configureTestingModule({
      imports: [CurrentOpView],
      providers: [provideZonelessChangeDetection(), provideFakeThicket(fake)],
    });
    setProfile(false);
    confirm = TestBed.inject(ConfirmService);
  });

  afterEach(() => {
    fixture?.destroy();
    vi.useRealTimers();
  });

  it('lists the operations of the connection with type, namespace, time and command', async () => {
    await create();
    expect(sent('admin.currentOp')).toEqual([{ profileId: 'p1' }]);
    expect(all('currentop-row').map((r) => r.dataset['opid'])).toEqual(['42', '43']);
    const slow = row('42');
    expect(text(slow)).toContain('query');
    expect(text(slow)).toContain('shop.orders');
    expect(text(slow)).toContain('1 min 15 s');
    expect(text(slow)).toContain('reporter');
    expect(text(slow)).toContain('COLLSCAN');
    expect(text(slow)).toContain('$where');
    expect(slow.querySelector('.time')?.getAttribute('data-level')).toBe('long');
    expect(text(row('43'))).toContain('2 ms');
    expect(text(get('currentop-call'))).toBe('db.currentOp()');
  });

  it('sends the filters and shows them as the mongosh call', async () => {
    await create();
    const ns = get<HTMLInputElement>('currentop-ns');
    ns.value = ' shop ';
    ns.dispatchEvent(new Event('change'));
    await settle();
    const secs = get<HTMLInputElement>('currentop-secs');
    secs.value = '3';
    secs.dispatchEvent(new Event('change'));
    await settle();
    const type = get<HTMLSelectElement>('currentop-type');
    type.value = 'query';
    type.dispatchEvent(new Event('change'));
    await settle();
    const allBox = get<HTMLInputElement>('currentop-all');
    allBox.click();
    await settle();
    expect(sent('admin.currentOp').at(-1)).toEqual({
      profileId: 'p1',
      ns: 'shop',
      minSecsRunning: 3,
      opType: 'query',
      all: true,
    });
    expect(text(get('currentop-call'))).toBe(
      'db.currentOp({ $all: true, ns: /^shop(\\.|$)/, secs_running: { $gte: 3 }, op: "query" })',
    );
  });

  it('says so when nothing matches, and shows errors', async () => {
    ops = [];
    await create();
    expect(text(get('currentop-empty'))).toContain('No operations match');
    fake.fail('admin.currentOp', { code: 'SERVER_ERROR', message: 'not authorized' });
    await view.refresh();
    await settle();
    expect(text(get('currentop-error'))).toContain('not authorized');
  });

  it('kills an operation only after the confirm dialog, then reads the list again', async () => {
    await create();
    get<HTMLButtonElement>('currentop-kill', row('42')).click();
    await settle();
    const request = confirm.current();
    expect(request?.confirmLabel).toBe('Kill operation');
    expect(request?.destructive).toBe(true);
    expect(request?.operation).toContain('db.killOp(42)');
    expect(sent('admin.killOp')).toEqual([]);

    ops = [FAST];
    confirm.answer(true);
    await settle();
    expect(sent('admin.killOp')).toEqual([
      { profileId: 'p1', opId: '{"$numberInt":"42"}', confirmed: true },
    ]);
    expect(text(get('currentop-notice'))).toContain('kill operation 42');
    expect(all('currentop-row').map((r) => r.dataset['opid'])).toEqual(['43']);
  });

  it('sends nothing when the kill is cancelled', async () => {
    await create();
    get<HTMLButtonElement>('currentop-kill', row('42')).click();
    await settle();
    confirm.answer(false);
    await settle();
    expect(sent('admin.killOp')).toEqual([]);
    expect(view.killing()).toBeNull();
  });

  it('offers no kill for idle operations and disables it on read-only profiles', async () => {
    ops = [SLOW, IDLE];
    setProfile(true);
    await create();
    expect(row('7').querySelector('[data-testid="currentop-kill"]')).toBeNull();
    expect(get<HTMLButtonElement>('currentop-kill', row('42')).disabled).toBe(true);
  });

  it('refreshes automatically at the chosen interval, and not when switched off', async () => {
    vi.useFakeTimers();
    fixture = TestBed.createComponent(CurrentOpView);
    view = fixture.componentInstance;
    fixture.componentRef.setInput('tab', TAB);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(10);
    expect(sent('admin.currentOp')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sent('admin.currentOp')).toHaveLength(2);
    view.setRefresh('2');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sent('admin.currentOp')).toHaveLength(3);
    view.setRefresh('0');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sent('admin.currentOp')).toHaveLength(3);
  });
});
