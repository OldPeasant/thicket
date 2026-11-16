import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CollectionInfo, Profile } from '@thicket/contract';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import { WorkspaceService } from '../layout/workspace.service';
import { ConfirmDialog } from '../safety/confirm-dialog';
import { ConfirmService } from '../safety/confirm.service';
import { READ_ONLY_HINT } from '../safety/write-control.directive';
import { SidebarTree } from './sidebar-tree';
import { collectionTabId } from './sidebar-tree.service';

@Component({
  selector: 'app-test-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SidebarTree, ConfirmDialog],
  template: `<app-sidebar-tree /><app-confirm-dialog />`,
})
class Host {}

const profile = (id: string, extra: Partial<Profile> = {}): Profile => ({
  id,
  name: `Profile ${id}`,
  connectionString: 'mongodb://localhost:27017',
  readOnly: false,
  production: false,
  ...extra,
});

const coll = (name: string, type: CollectionInfo['type'] = 'collection'): CollectionInfo => ({
  name,
  type,
  raw: '{}',
});

describe('SidebarTree', () => {
  let fake: FakeThicketBridge;
  let fixture: ComponentFixture<Host>;
  let el: HTMLElement;
  let profiles: Profile[];
  let databases: Record<string, string[]>;
  let collections: Record<string, CollectionInfo[]>;

  beforeEach(() => {
    fake = new FakeThicketBridge();
    profiles = [profile('p1'), profile('p2', { readOnly: true, name: 'Reader' })];
    databases = { p1: ['shop', 'admin'], p2: ['shop'] };
    collections = {
      shop: [coll('orders'), coll('big_orders', 'view'), coll('ticks', 'timeseries')],
    };
    fake.handle('profiles.list', () => ({ profiles }));
    fake.respond('conn.status', { connections: [] });
    fake.handle('conn.open', ({ profileId }) => ({ profileId, state: 'connected' }));
    fake.respond('conn.close', {});
    fake.handle('db.listDatabases', ({ profileId }) => ({
      databases: (databases[profileId] ?? []).map((name) => ({ name })),
    }));
    fake.handle('coll.list', ({ db }) => ({ collections: collections[db] ?? [] }));
    TestBed.configureTestingModule({ providers: [provideFakeThicket(fake), provideRouter([])] });
  });

  async function start(): Promise<void> {
    fixture = TestBed.createComponent(Host);
    el = fixture.nativeElement as HTMLElement;
    await settle();
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await fixture.whenStable();
      await new Promise((r) => setTimeout(r));
    }
  }

  const nodes = (kind: 'conn' | 'db' | 'coll') =>
    [...el.querySelectorAll<HTMLElement>(`[data-testid="tree-${kind}"]`)].map(
      (n) => n.dataset['name'],
    );
  const node = (kind: 'conn' | 'db' | 'coll', name: string): HTMLElement => {
    const found = [...el.querySelectorAll<HTMLElement>(`[data-testid="tree-${kind}"]`)].find(
      (n) => n.dataset['name'] === name,
    );
    if (!found) throw new Error(`no ${kind} ${name}`);
    return found;
  };
  const byTestId = (id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const must = (id: string): HTMLElement => {
    const found = byTestId(id);
    if (!found) throw new Error(`no ${id}`);
    return found;
  };
  async function click(target: HTMLElement): Promise<void> {
    target.click();
    await settle();
  }
  async function menu(target: HTMLElement): Promise<void> {
    target.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 30 }),
    );
    await settle();
  }
  async function type(testId: string, value: string): Promise<void> {
    const input = must(testId) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
  }
  async function openShop(): Promise<void> {
    await click(node('conn', 'Profile p1'));
    await click(node('db', 'shop'));
  }

  describe('lazy loading', () => {
    it('lists the profiles without connecting', async () => {
      await start();
      expect(nodes('conn')).toEqual(['Profile p1', 'Reader']);
      expect(fake.requestsFor('conn.open')).toHaveLength(0);
      expect(fake.requestsFor('db.listDatabases')).toHaveLength(0);
    });

    it('shows the empty state with a link to a new connection', async () => {
      profiles = [];
      await start();
      expect(byTestId('sidebar-empty')?.textContent).toContain('No connections yet.');
      expect(byTestId('sidebar-new')).not.toBeNull();
    });

    it('connects and loads databases on expand, collections on database expand', async () => {
      await start();
      await click(node('conn', 'Profile p1'));
      expect(fake.requestsFor('conn.open')[0]?.params).toEqual({ profileId: 'p1' });
      expect(nodes('db')).toEqual(['admin', 'shop']);
      expect(node('conn', 'Profile p1').dataset['state']).toBe('connected');
      expect(fake.requestsFor('coll.list')).toHaveLength(0);

      await click(node('db', 'shop'));
      expect(fake.requestsFor('coll.list')[0]?.params).toEqual({ profileId: 'p1', db: 'shop' });
      expect(nodes('coll')).toEqual(['big_orders', 'orders', 'ticks']);
      expect(node('coll', 'big_orders').dataset['type']).toBe('view');
      expect(node('coll', 'ticks').dataset['type']).toBe('timeseries');
    });

    it('does not reload a list when a node is collapsed and expanded again', async () => {
      await start();
      await openShop();
      await click(node('db', 'shop'));
      expect(nodes('coll')).toEqual([]);
      await click(node('db', 'shop'));
      expect(nodes('coll')).toHaveLength(3);
      expect(fake.requestsFor('coll.list')).toHaveLength(1);
    });

    it('shows a loading line while databases load', async () => {
      let release!: () => void;
      fake.handle(
        'db.listDatabases',
        () =>
          new Promise((resolve) => {
            release = () => resolve({ databases: [{ name: 'x' }] });
          }),
      );
      await start();
      await click(node('conn', 'Profile p1'));
      expect(byTestId('tree-status')?.textContent).toContain('Loading databases');
      release();
      await settle();
      expect(nodes('db')).toEqual(['x']);
    });

    it('asks for the password of an ask-each-time profile and passes it to conn.open', async () => {
      profiles = [
        profile('p1', { auth: { mechanism: 'SCRAM-SHA-256', username: 'u', secretMode: 'ask' } }),
      ];
      await start();
      await click(node('conn', 'Profile p1'));
      expect(fake.requestsFor('conn.open')).toHaveLength(0);
      expect((must('prompt-password') as HTMLInputElement).type).toBe('password');
      await type('prompt-password', 's3cret');
      await click(must('prompt-ok'));
      expect(fake.requestsFor('conn.open')[0]?.params).toEqual({
        profileId: 'p1',
        password: 's3cret',
      });
      expect(byTestId('tree-prompt')).toBeNull();
      expect(nodes('db')).toEqual(['admin', 'shop']);
    });

    it('opens a collection tab on click', async () => {
      await start();
      await openShop();
      await click(node('coll', 'orders'));
      const ws = TestBed.inject(WorkspaceService);
      expect(ws.activeId()).toBe(collectionTabId('p1', 'shop', 'orders'));
      expect(ws.active()).toMatchObject({
        kind: 'collection',
        title: 'orders',
        detail: 'Profile p1 / shop',
        data: { profileId: 'p1', db: 'shop', coll: 'orders', type: 'collection' },
      });
    });

    it('follows conn.status broadcasts', async () => {
      await start();
      await click(node('conn', 'Profile p1'));
      fake.emit({
        stream: 'conn.status',
        kind: 'data',
        payload: { profileId: 'p1', state: 'disconnected' },
      });
      await settle();
      expect(node('conn', 'Profile p1').dataset['state']).toBe('disconnected');
      expect(nodes('db')).toEqual([]);
      expect(byTestId('tree-status')?.textContent).toContain('Not connected');
    });
  });

  describe('errors', () => {
    it('shows a failed profile list with a retry', async () => {
      fake.fail('profiles.list', { code: 'INTERNAL', message: 'boom' });
      await start();
      expect(byTestId('sidebar-error')?.textContent).toContain('boom');
      fake.handle('profiles.list', () => ({ profiles }));
      await click(must('sidebar-error').querySelector('button') as HTMLElement);
      expect(nodes('conn')).toHaveLength(2);
    });

    it('shows a connect error on the node and retries', async () => {
      fake.fail('conn.open', {
        code: 'AUTH_FAILED',
        message: 'Authentication failed: bad password',
      });
      await start();
      await click(node('conn', 'Profile p1'));
      expect(node('conn', 'Profile p1').dataset['state']).toBe('error');
      expect(byTestId('tree-status')?.textContent).toContain('bad password');
      fake.handle('conn.open', ({ profileId }) => ({ profileId, state: 'connected' }));
      await click(must('tree-retry'));
      expect(nodes('db')).toEqual(['admin', 'shop']);
    });

    it('shows a connection state error from conn.open', async () => {
      fake.handle('conn.open', ({ profileId }) => ({
        profileId,
        state: 'error',
        error: { code: 'DNS_ERROR', message: 'DNS lookup failed: nohost' },
      }));
      await start();
      await click(node('conn', 'Profile p1'));
      expect(byTestId('tree-status')?.textContent).toContain('nohost');
    });

    it('shows a failed collection list and retries', async () => {
      fake.fail('coll.list', { code: 'SERVER_ERROR', message: 'not authorized on shop' });
      await start();
      await openShop();
      const status = must('tree-status');
      expect(status.dataset['tone']).toBe('error');
      expect(status.textContent).toContain('not authorized on shop');
      fake.handle('coll.list', () => ({ collections: [coll('orders')] }));
      await click(must('tree-retry'));
      expect(nodes('coll')).toEqual(['orders']);
    });

    it('marks the connection disconnected when a list answers NOT_CONNECTED', async () => {
      await start();
      await click(node('conn', 'Profile p1'));
      fake.fail('coll.list', { code: 'NOT_CONNECTED', message: 'not connected' });
      await click(node('db', 'shop'));
      expect(node('conn', 'Profile p1').dataset['state']).toBe('disconnected');
    });
  });

  describe('context actions', () => {
    it('loads counts and sizes of a collection on demand', async () => {
      fake.respond('coll.stats', {
        count: 1204,
        size: 3 * 1024 * 1024,
        storageSize: 1,
        totalIndexSize: 1,
        nindexes: 1,
        raw: '{}',
      });
      await start();
      await openShop();
      expect(node('coll', 'orders').querySelector('[data-testid="node-stats"]')).toBeNull();
      await menu(node('coll', 'orders'));
      await click(must('menu-stats'));
      expect(node('coll', 'orders').querySelector('[data-testid="node-stats"]')?.textContent).toBe(
        '1\u202f204 docs, 3.0 MB',
      );
    });

    it('loads database stats and sizes on demand', async () => {
      fake.respond('db.stats', {
        collections: 2,
        views: 1,
        objects: 10,
        dataSize: 1,
        storageSize: 2048,
        indexSize: 1,
        raw: '{}',
      });
      await start();
      await click(node('conn', 'Profile p1'));
      await menu(node('db', 'shop'));
      await click(must('menu-stats'));
      expect(node('db', 'shop').textContent).toContain('3 coll., 10 docs, 2.0 KB');

      fake.handle('db.listDatabases', () => ({ databases: [{ name: 'admin', sizeOnDisk: 4096 }] }));
      await menu(node('conn', 'Profile p1'));
      await click(must('menu-sizes'));
      expect(fake.requestsFor('db.listDatabases').at(-1)?.params).toEqual({
        profileId: 'p1',
        withSizes: true,
      });
      expect(node('db', 'admin').textContent).toContain('4.0 KB');
    });

    it('creates a database with its first collection', async () => {
      fake.handle('db.create', ({ db }) => {
        databases['p1']?.push(db);
        collections[db] = [coll('first')];
        return {};
      });
      await start();
      await click(node('conn', 'Profile p1'));
      await menu(node('conn', 'Profile p1'));
      await click(must('menu-create-db'));
      await click(must('prompt-ok'));
      expect(byTestId('prompt-problem')?.textContent).toBe('Enter a name.');
      expect(fake.requestsFor('db.create')).toHaveLength(0);
      await type('prompt-db', 'bad.name');
      await type('prompt-coll', 'first');
      await click(must('prompt-ok'));
      expect(byTestId('prompt-problem')?.textContent).toContain('cannot contain');
      await type('prompt-db', 'newdb');
      await click(must('prompt-ok'));
      expect(fake.requestsFor('db.create')[0]?.params).toEqual({
        profileId: 'p1',
        db: 'newdb',
        firstCollection: 'first',
      });
      expect(byTestId('tree-prompt')).toBeNull();
      expect(nodes('db')).toContain('newdb');
      expect(nodes('coll')).toEqual(['first']);
    });

    it('keeps the prompt open with the server error when a create fails', async () => {
      fake.fail('coll.create', { code: 'SERVER_ERROR', message: 'Collection already exists' });
      await start();
      await click(node('conn', 'Profile p1'));
      await menu(node('db', 'shop'));
      await click(must('menu-create-coll'));
      await type('prompt-coll', 'orders');
      await click(must('prompt-ok'));
      expect(byTestId('prompt-error')?.textContent).toContain('already exists');
      await click(must('prompt-cancel'));
      expect(byTestId('tree-prompt')).toBeNull();
    });

    it('renames a collection and closes its open tab', async () => {
      fake.handle('coll.rename', ({ coll: from, newName }) => {
        collections['shop'] = (collections['shop'] ?? []).map((c) =>
          c.name === from ? coll(newName) : c,
        );
        return {};
      });
      await start();
      await openShop();
      await click(node('coll', 'orders'));
      await menu(node('coll', 'orders'));
      await click(must('menu-rename'));
      expect((must('prompt-name') as HTMLInputElement).value).toBe('orders');
      await type('prompt-name', 'orders2');
      await click(must('prompt-ok'));
      expect(fake.requestsFor('coll.rename')[0]?.params).toEqual({
        profileId: 'p1',
        db: 'shop',
        coll: 'orders',
        newName: 'orders2',
      });
      expect(nodes('coll')).toContain('orders2');
      expect(TestBed.inject(WorkspaceService).tabs()).toEqual([]);
    });

    it('drops a collection only after its name is typed', async () => {
      fake.handle('coll.drop', ({ coll: name }) => {
        collections['shop'] = (collections['shop'] ?? []).filter((c) => c.name !== name);
        return {};
      });
      await start();
      await openShop();
      await menu(node('coll', 'orders'));
      await click(must('menu-drop-coll'));
      const dialog = must('confirm-dialog');
      expect(dialog.textContent).toContain('Drop collection');
      expect(must('confirm-operation').textContent).toContain('drop()');
      expect((must('confirm-ok') as HTMLButtonElement).disabled).toBe(true);
      await type('confirm-type', 'order');
      expect((must('confirm-ok') as HTMLButtonElement).disabled).toBe(true);
      await type('confirm-type', 'orders');
      await click(must('confirm-ok'));
      expect(fake.requestsFor('coll.drop')[0]?.params).toEqual({
        profileId: 'p1',
        db: 'shop',
        coll: 'orders',
        confirmed: true,
      });
      expect(nodes('coll')).not.toContain('orders');
    });

    it('sends nothing when a drop is cancelled', async () => {
      await start();
      await click(node('conn', 'Profile p1'));
      await menu(node('db', 'shop'));
      await click(must('menu-drop-db'));
      expect(TestBed.inject(ConfirmService).current()?.typeToConfirm).toBe('shop');
      await click(must('confirm-cancel'));
      expect(fake.requestsFor('db.drop')).toHaveLength(0);
      expect(byTestId('sidebar-notice')).toBeNull();
    });

    it('shows a failed drop as a notice', async () => {
      fake.fail('db.drop', { code: 'SERVER_ERROR', message: 'not authorized to drop' });
      await start();
      await click(node('conn', 'Profile p1'));
      await menu(node('db', 'shop'));
      await click(must('menu-drop-db'));
      await type('confirm-type', 'shop');
      await click(must('confirm-ok'));
      expect(byTestId('sidebar-notice')?.textContent).toContain('not authorized to drop');
    });

    it('disconnects from the context menu', async () => {
      await start();
      await click(node('conn', 'Profile p1'));
      await menu(node('conn', 'Profile p1'));
      await click(must('menu-disconnect'));
      expect(fake.requestsFor('conn.close')[0]?.params).toEqual({ profileId: 'p1' });
      expect(node('conn', 'Profile p1').dataset['state']).toBe('disconnected');
    });

    it('closes the menu with Escape and opens it with Shift+F10', async () => {
      await start();
      const conn = node('conn', 'Profile p1');
      conn.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true }),
      );
      await settle();
      expect(byTestId('tree-menu')).not.toBeNull();
      must('tree-menu').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      await settle();
      expect(byTestId('tree-menu')).toBeNull();
    });
  });

  describe('keyboard', () => {
    it('moves with the arrows, expands with ArrowRight and opens with Enter', async () => {
      await start();
      const key = async (target: HTMLElement, k: string) => {
        target.dispatchEvent(
          new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }),
        );
        await settle();
      };
      await key(node('conn', 'Profile p1'), 'ArrowRight');
      expect(nodes('db')).toEqual(['admin', 'shop']);
      await key(node('conn', 'Profile p1'), 'ArrowDown');
      expect(document.activeElement).toBe(node('db', 'admin'));
      await key(node('db', 'admin'), 'ArrowDown');
      await key(node('db', 'shop'), 'Enter');
      expect(nodes('coll')).toHaveLength(3);
      await key(node('db', 'shop'), 'ArrowLeft');
      expect(nodes('coll')).toHaveLength(0);
      await key(node('db', 'shop'), 'ArrowLeft');
      expect(document.activeElement).toBe(node('conn', 'Profile p1'));
    });
  });

  describe('read-only profiles', () => {
    it('disables every write action and shows the badge', async () => {
      await start();
      const reader = node('conn', 'Reader');
      expect(reader.querySelector('[data-testid="badge-readonly"]')).not.toBeNull();
      await click(reader);
      await menu(node('conn', 'Reader'));
      const createDb = must('menu-create-db') as HTMLButtonElement;
      expect(createDb.disabled).toBe(true);
      expect(createDb.title).toBe(READ_ONLY_HINT);
      await click(createDb);
      expect(byTestId('tree-prompt')).toBeNull();

      await click(document.body);
      await menu(node('db', 'shop'));
      expect((must('menu-create-coll') as HTMLButtonElement).disabled).toBe(true);
      expect((must('menu-drop-db') as HTMLButtonElement).disabled).toBe(true);
      expect((must('menu-refresh') as HTMLButtonElement).disabled).toBe(false);
      expect((must('menu-stats') as HTMLButtonElement).disabled).toBe(false);

      await click(document.body);
      await click(node('db', 'shop'));
      await menu(node('coll', 'orders'));
      expect((must('menu-rename') as HTMLButtonElement).disabled).toBe(true);
      expect((must('menu-drop-coll') as HTMLButtonElement).disabled).toBe(true);
      expect((must('menu-open') as HTMLButtonElement).disabled).toBe(false);
    });

    it('the service refuses writes on read-only profiles without sending them', async () => {
      await start();
      await click(node('conn', 'Reader'));
      const { SidebarTreeService } = await import('./sidebar-tree.service');
      const tree = TestBed.inject(SidebarTreeService);
      await expect(tree.dropDatabase('p2', 'shop')).rejects.toMatchObject({ code: 'READ_ONLY' });
      expect(fake.requestsFor('db.drop')).toHaveLength(0);
    });

    it('enables write actions on a writable profile', async () => {
      await start();
      await click(node('conn', 'Profile p1'));
      await menu(node('conn', 'Profile p1'));
      expect((must('menu-create-db') as HTMLButtonElement).disabled).toBe(false);
    });
  });
});
