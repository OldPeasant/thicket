import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../../api/testing';
import type { WorkspaceTab } from '../../layout/workspace.service';
import replSetStatus from './fixtures/repl-set-status-8.2.json';
import status1 from './fixtures/server-status-1-8.2.json';
import status2 from './fixtures/server-status-2-8.2.json';
import statusRs from './fixtures/server-status-rs-8.2.json';
import { ServerStatsView, serverStatsTabId } from './server-stats-view';
import { StatsChart } from './stats-chart';

// Recorded from mongo:8.2 by fixtures/capture.mjs: two standalone samples 2.034 s apart (40
// inserts, 40 queries, 10 updates, 4 deletes, 2 commands in between), a one-member replica set.
const S1 = JSON.stringify(status1);
const S2 = JSON.stringify(status2);
const SRS = JSON.stringify(statusRs);
const RS = JSON.stringify(replSetStatus);

/** The recorded replica set with two more members: a lagging secondary and an unreachable one. */
function threeMembers(): string {
  const doc = structuredClone(replSetStatus) as unknown as {
    members: Record<string, unknown>[];
  };
  const primary = doc.members[0] as Record<string, unknown>;
  const optime = Number(
    (primary['optimeDate'] as { $date: { $numberLong: string } }).$date.$numberLong,
  );
  doc.members.push(
    {
      ...primary,
      _id: { $numberInt: '1' },
      name: 'db2:27017',
      stateStr: 'SECONDARY',
      self: false,
      optimeDate: { $date: { $numberLong: String(optime - 42_000) } },
      pingMs: { $numberLong: '3' },
      syncSourceHost: 'localhost:27017',
    },
    {
      _id: { $numberInt: '2' },
      name: 'db3:27017',
      health: { $numberDouble: '0.0' },
      stateStr: '(not reachable/healthy)',
      lastHeartbeatMessage: 'Error connecting to db3:27017',
    },
  );
  return JSON.stringify(doc);
}

const TAB: WorkspaceTab = {
  id: serverStatsTabId('p1'),
  kind: 'serverstats',
  title: 'Server stats',
  data: { profileId: 'p1' },
};

describe('ServerStatsView', () => {
  let fake: FakeThicketBridge;
  let fixture: ComponentFixture<ServerStatsView>;
  let view: ServerStatsView;
  let statuses: string[];
  let repl: string | null;

  const el = () => fixture.nativeElement as HTMLElement;
  const all = <T extends HTMLElement = HTMLElement>(id: string, root: ParentNode = el()) => [
    ...root.querySelectorAll<T>(`[data-testid="${id}"]`),
  ];
  const get = <T extends HTMLElement = HTMLElement>(id: string, root: ParentNode = el()): T => {
    const found = root.querySelector<T>(`[data-testid="${id}"]`);
    if (found === null) throw new Error(`no element ${id}`);
    return found;
  };
  const text = (e: Element | null) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  /** Text of the cells/spans inside `e`, one space between elements (legend, rows). */
  const words = (e: Element | null | undefined): string => {
    if (!e) return '';
    const parts: string[] = [];
    const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const part = node.textContent?.replace(/\s+/g, ' ').trim();
      if (part) parts.push(part);
    }
    return parts.join(' ');
  };
  /** The value of a headline tile. */
  const tile = (id: string) => text(get(id).querySelector('dd'));
  const settle = async () => {
    for (let i = 0; i < 6; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
  };
  const create = async () => {
    fixture = TestBed.createComponent(ServerStatsView);
    view = fixture.componentInstance;
    view.refreshSecs.set(0);
    fixture.componentRef.setInput('tab', TAB);
    await settle();
  };
  /** Reads the next recorded sample. */
  const sampleAgain = async () => {
    await view.refresh();
    await settle();
  };

  beforeEach(() => {
    fake = new FakeThicketBridge();
    statuses = [S1, S2];
    repl = null;
    fake.handle('admin.serverStatus', () => ({ status: statuses.shift() ?? S2 }));
    fake.handle('admin.replSetStatus', () => ({ status: repl }));
    fake.respond('db.listDatabases', {
      databases: [{ name: 'admin' }, { name: 'shop' }],
    });
    fake.handle('db.stats', ({ db }) =>
      db === 'shop'
        ? {
            collections: 3,
            views: 1,
            objects: 12_345,
            dataSize: 5 * 1024 * 1024,
            storageSize: 2 * 1024 * 1024,
            indexSize: 300 * 1024,
            raw: '{}',
          }
        : { error: { code: 'SERVER_ERROR', message: 'not authorized on admin' } },
    );
    TestBed.configureTestingModule({
      imports: [ServerStatsView],
      providers: [provideZonelessChangeDetection(), provideFakeThicket(fake)],
    });
  });

  afterEach(() => {
    fixture?.destroy();
    vi.useRealTimers();
  });

  it('shows who the server is from the first sample, the charts wait for a second', async () => {
    await create();
    expect(fake.requestsFor('admin.serverStatus').map((r) => r.params)).toEqual([
      { profileId: 'p1' },
    ]);
    expect(fake.requestsFor('admin.replSetStatus').map((r) => r.params)).toEqual([
      { profileId: 'p1' },
    ]);
    const server = text(get('stats-server'));
    expect(server).toContain('e64ac6ac4426');
    expect(server).toContain('mongod 8.2.12');
    expect(server).toContain('wiredTiger');
    expect(server).toContain('up 20 s');
    expect(text(get('stats-role'))).toBe('standalone');
    expect(tile('tile-connections')).toBe('2 of 209.7k');
    expect(tile('tile-memory')).toBe('217 MB 3.61 GB virtual');
    expect(tile('tile-ops')).toBe('–/s');
    expect(all('waiting-ops')).toHaveLength(1);
  });

  it('draws operations per second, connections and memory from two recorded samples', async () => {
    await create();
    await sampleAgain();
    expect(all('waiting-ops')).toHaveLength(0);
    // 2.034 s between the samples (uptimeMillis 20573 → 22607).
    expect(words(get('legend-ops-insert'))).toBe('insert 19.7');
    expect(words(get('legend-ops-query'))).toBe('query 19.7');
    expect(words(get('legend-ops-update'))).toBe('update 4.92');
    expect(words(get('legend-ops-delete'))).toBe('delete 1.97');
    expect(words(get('legend-ops-getmore'))).toBe('getmore 0');
    expect(words(get('legend-ops-command'))).toBe('command 0.98');
    expect(tile('tile-ops')).toBe('47.2/s');
    expect(words(get('legend-connections-current'))).toBe('current 2');
    expect(words(get('legend-memory-resident'))).toBe('resident 217 MB');
    expect(tile('tile-network')).toBe('7.08 KB/s in 61.2 KB/s out');
    for (const id of ['line-ops-insert', 'line-connections-current', 'line-memory-resident']) {
      expect(get(id).getAttribute('d')).toMatch(/^M\d/);
    }
    expect(get('chart-ops').querySelector('svg')?.getAttribute('aria-label')).toContain(
      'insert 19.7',
    );
    expect(text(get('stats-updated'))).toMatch(/^Updated /);
  });

  it('shows the values of a point in the hover tooltip', async () => {
    await create();
    await sampleAgain();
    const chart = fixture.debugElement.queryAll(By.directive(StatsChart))[0]
      ?.componentInstance as StatsChart;
    chart.showPoint(0);
    await settle();
    const tip = words(get('tip-ops'));
    expect(tip).toContain('insert 19.7');
    expect(tip).toContain('delete 1.97');
    expect(tip).toContain(new Date(Date.parse('2026-11-17T06:45:00.965Z')).toLocaleTimeString());
    chart.showPoint(null);
    await settle();
    expect(all('tip-ops')).toHaveLength(0);
  });

  it('starts the charts over when the server restarted (counters went back)', async () => {
    statuses = [S1, S2, S1];
    await create();
    await sampleAgain();
    expect(tile('tile-ops')).toBe('47.2/s');
    await sampleAgain();
    expect(tile('tile-ops')).toBe('–/s');
    expect(all('waiting-ops')).toHaveLength(1);
  });

  it('says when the server is not a replica set member', async () => {
    await create();
    expect(text(get('stats-repl-none'))).toContain('Not a replica set member');
    expect(all('repl-member')).toHaveLength(0);
  });

  it('lists the members of the recorded replica set', async () => {
    statuses = [SRS];
    repl = RS;
    await create();
    expect(text(get('stats-role'))).toBe('primary of rs0');
    expect(text(get('stats-repl'))).toContain('Replica set rs0');
    const members = all('repl-member');
    expect(members.map((m) => m.dataset['member'])).toEqual(['localhost:27017']);
    const primary = members[0] as HTMLElement;
    expect(text(primary)).toContain('this server');
    expect(text(primary)).toContain('PRIMARY');
    expect(primary.querySelector('.state')?.getAttribute('data-level')).toBe('good');
    expect(text(get('repl-lag', primary))).toBe('–');
  });

  it('shows lag and health of the other members', async () => {
    statuses = [SRS];
    repl = threeMembers();
    await create();
    const [, secondary, down] = all('repl-member');
    expect(text(secondary ?? null)).toContain('SECONDARY');
    expect(text(get('repl-lag', secondary))).toBe('42 s');
    expect(secondary?.querySelector('.state')?.getAttribute('data-level')).toBe('warn');
    expect(text(down ?? null)).toContain('unreachable');
    expect(down?.querySelector('.state')?.getAttribute('data-level')).toBe('bad');
    expect(down?.querySelector('.state')?.getAttribute('title')).toBe(
      'Error connecting to db3:27017',
    );
  });

  it('shows a refused replica set status in its section only', async () => {
    fake.fail('admin.replSetStatus', { code: 'SERVER_ERROR', message: 'not authorized' });
    await create();
    expect(text(get('stats-repl-error'))).toContain('not authorized');
    expect(all('stats-error')).toHaveLength(0);
    expect(text(get('stats-role'))).toBe('standalone');
  });

  it('keeps the charts and shows the error when serverStatus fails', async () => {
    await create();
    await sampleAgain();
    fake.fail('admin.serverStatus', { code: 'SERVER_ERROR', message: 'serverStatus refused' });
    await sampleAgain();
    expect(text(get('stats-error'))).toContain('serverStatus refused');
    expect(words(get('legend-ops-insert'))).toBe('insert 19.7');
  });

  it('lists dbStats of every database, with a refused one as its error', async () => {
    await create();
    expect(fake.requestsFor('db.stats').map((r) => r.params)).toEqual([
      { profileId: 'p1', db: 'admin' },
      { profileId: 'p1', db: 'shop' },
    ]);
    const rows = all('db-row');
    expect(rows.map((r) => r.dataset['db'])).toEqual(['admin', 'shop']);
    expect(words(rows[0])).toContain('not authorized on admin');
    expect(words(rows[1])).toBe('shop 3 1 12.3k 5 MB 2 MB 300 KB');
  });

  it('reads the databases again on Reload, not on every sample', async () => {
    await create();
    await sampleAgain();
    expect(fake.requestsFor('db.listDatabases')).toHaveLength(1);
    get('stats-dbs-reload').click();
    await settle();
    expect(fake.requestsFor('db.listDatabases')).toHaveLength(2);
  });

  it('shows a failed database listing', async () => {
    fake.fail('db.listDatabases', { code: 'SERVER_ERROR', message: 'listDatabases refused' });
    await create();
    expect(text(get('stats-dbs-error'))).toContain('listDatabases refused');
  });

  it('samples again on its own at the chosen interval, and stops when set to never', async () => {
    vi.useFakeTimers();
    fixture = TestBed.createComponent(ServerStatsView);
    view = fixture.componentInstance;
    fixture.componentRef.setInput('tab', TAB);
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.requestsFor('admin.serverStatus')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fake.requestsFor('admin.serverStatus')).toHaveLength(2);
    view.setRefresh('0');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fake.requestsFor('admin.serverStatus')).toHaveLength(2);
    view.setRefresh('5');
    await vi.advanceTimersByTimeAsync(5000);
    expect(fake.requestsFor('admin.serverStatus')).toHaveLength(3);
  });

  it('stops sampling when the tab closes', async () => {
    vi.useFakeTimers();
    fixture = TestBed.createComponent(ServerStatsView);
    fixture.componentRef.setInput('tab', TAB);
    await vi.advanceTimersByTimeAsync(0);
    fixture.destroy();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fake.requestsFor('admin.serverStatus')).toHaveLength(1);
  });
});
