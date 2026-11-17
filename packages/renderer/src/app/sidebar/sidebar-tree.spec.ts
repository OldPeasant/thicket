import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { CollectionInfo, Profile } from '@thicket/contract';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import { WorkspaceService } from '../layout/workspace.service';
import { ConfirmDialog } from '../safety/confirm-dialog';
import { ConfirmService } from '../safety/confirm.service';
import { READ_ONLY_HINT } from '../safety/write-control.directive';
import { SidebarTree } from './sidebar-tree';
import { SidebarTreeService, collectionTabId } from './sidebar-tree.service';

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

    it('reloads the collections of a database expanded before a disconnect broadcast', async () => {
      await start();
      await openShop();
      expect(nodes('coll')).toHaveLength(3);
      fake.emit({
        stream: 'conn.status',
        kind: 'data',
        payload: { profileId: 'p1', state: 'disconnected' },
      });
      await settle();
      await click(must('tree-retry'));
      expect(node('conn', 'Profile p1').dataset['state']).toBe('connected');
      // The database collapsed with the forgotten lists instead of waiting for its collections.
      expect(node('db', 'shop').getAttribute('aria-expanded')).toBe('false');
      expect(el.textContent).not.toContain('Loading collections');
      await click(node('db', 'shop'));
      expect(fake.requestsFor('coll.list')).toHaveLength(2);
      expect(nodes('coll')).toEqual(['big_orders', 'orders', 'ticks']);
    });

    it('reloads the collections of an expanded database after Disconnect and Connect', async () => {
      await start();
      await openShop();
      await menu(node('conn', 'Profile p1'));
      await click(must('menu-disconnect'));
      await menu(node('conn', 'Profile p1'));
      await click(must('menu-connect'));
      expect(nodes('db')).toEqual(['admin', 'shop']);
      expect(el.textContent).not.toContain('Loading collections');
      await click(node('db', 'shop'));
      expect(nodes('coll')).toEqual(['big_orders', 'orders', 'ticks']);
    });

    it('reloads the collections of an expanded database after a backend restart', async () => {
      await start();
      await openShop();
      fake.emit({
        stream: 'backend.restarted',
        kind: 'data',
        payload: { restarts: 1, reason: 'exit code 1' },
      });
      await settle();
      await click(must('tree-retry'));
      expect(nodes('db')).toEqual(['admin', 'shop']);
      expect(el.textContent).not.toContain('Loading collections');
      await click(node('db', 'shop'));
      expect(nodes('coll')).toEqual(['big_orders', 'orders', 'ticks']);
    });

    it('status lines are non-focusable treeitems with their level', async () => {
      fake.fail('coll.list', { code: 'SERVER_ERROR', message: 'not authorized on shop' });
      await start();
      await openShop();
      const tree = must('sidebar-tree');
      for (const child of Array.from(tree.children)) {
        expect(child.getAttribute('role')).toBe('treeitem');
      }
      const line = must('tree-status');
      expect(line.getAttribute('aria-level')).toBe('3');
      expect(line.hasAttribute('tabindex')).toBe(false);
      expect(must('tree-retry').closest('[role="treeitem"]')).toBe(line);
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

    it('opens the users and roles tab of a database from its context menu', async () => {
      await start();
      await click(node('conn', 'Profile p1'));
      await menu(node('db', 'shop'));
      const item = must('menu-users') as HTMLButtonElement;
      expect(item.textContent).toContain('Users and roles');
      await click(item);
      expect(byTestId('tree-menu')).toBeNull();
      expect(TestBed.inject(WorkspaceService).active()).toMatchObject({
        id: 'users:p1:shop',
        kind: 'users',
        data: { profileId: 'p1', db: 'shop' },
      });
    });

    it('offers both Open shell and Users and roles on a database; each opens its own tab', async () => {
      await start();
      await click(node('conn', 'Profile p1'));
      await menu(node('db', 'shop'));
      const ids = [...must('tree-menu').querySelectorAll<HTMLElement>('[role="menuitem"]')].map(
        (item) => item.dataset['testid'],
      );
      expect(ids.filter((id) => id === 'menu-open-shell')).toHaveLength(1);
      expect(ids.filter((id) => id === 'menu-users')).toHaveLength(1);
      expect(ids.indexOf('menu-open-shell')).toBeLessThan(ids.indexOf('menu-users'));

      await click(must('menu-open-shell'));
      await menu(node('db', 'shop'));
      await click(must('menu-users'));
      const ws = TestBed.inject(WorkspaceService);
      expect(ws.tabs().map((t) => [t.id, t.kind])).toEqual([
        ['shell:p1', 'shell'],
        ['users:p1:shop', 'users'],
      ]);
      expect(ws.active()?.id).toBe('users:p1:shop');
    });

    it('disconnects from the context menu', async () => {
      await start();
      await click(node('conn', 'Profile p1'));
      await menu(node('conn', 'Profile p1'));
      await click(must('menu-disconnect'));
      expect(fake.requestsFor('conn.close')[0]?.params).toEqual({ profileId: 'p1' });
      expect(node('conn', 'Profile p1').dataset['state']).toBe('disconnected');
    });

    it('opens the connection editor from the context menu, also on a read-only profile', async () => {
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
      await start();
      await menu(node('conn', 'Reader'));
      const edit = must('menu-edit-conn') as HTMLButtonElement;
      expect(edit.textContent).toContain('Edit connection…');
      expect(edit.disabled).toBe(false);
      await click(edit);
      expect(navigate).toHaveBeenCalledWith('/connections/p2');
      expect(byTestId('tree-menu')).toBeNull();
      expect(fake.requestsFor('conn.open')).toHaveLength(0);
    });

    it('encodes the profile id in the editor URL', async () => {
      profiles = [profile('a/b c')];
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
      await start();
      await menu(node('conn', 'Profile a/b c'));
      await click(must('menu-edit-conn'));
      expect(navigate).toHaveBeenCalledWith('/connections/a%2Fb%20c');
    });

    it('links to the connection manager', async () => {
      await start();
      expect(must('sidebar-manage').getAttribute('href')).toBe('/connections');
      expect(must('sidebar-manage').getAttribute('aria-label')).toBe('Manage connections');
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

  describe('open shell', () => {
    it('is offered on a connection only while it is connected', async () => {
      await start();
      await menu(node('conn', 'Profile p1'));
      const item = must('menu-open-shell') as HTMLButtonElement;
      expect(item.textContent?.trim()).toBe('Open shell');
      expect(item.disabled).toBe(true);
      await click(item);
      expect(TestBed.inject(WorkspaceService).tabs()).toHaveLength(0);
    });

    it('opens the connection shell from the connection menu', async () => {
      await start();
      await click(node('conn', 'Profile p1'));
      await menu(node('conn', 'Profile p1'));
      await click(must('menu-open-shell'));
      const ws = TestBed.inject(WorkspaceService);
      expect(ws.active()).toMatchObject({
        id: 'shell:p1',
        kind: 'shell',
        detail: 'Profile p1',
        data: { profileId: 'p1' },
      });
      expect(byTestId('tree-menu')).toBeNull();
    });

    it('starts the shell in the database from the database menu', async () => {
      await start();
      await click(node('conn', 'Profile p1'));
      await menu(node('db', 'shop'));
      await click(must('menu-open-shell'));
      expect(TestBed.inject(WorkspaceService).active()).toMatchObject({
        id: 'shell:p1',
        data: { profileId: 'p1', db: 'shop' },
      });
    });

    it('stays available on read-only profiles (it is not a write action)', async () => {
      await start();
      await click(node('conn', 'Reader'));
      await menu(node('conn', 'Reader'));
      expect((must('menu-open-shell') as HTMLButtonElement).disabled).toBe(false);
      await menu(node('db', 'shop'));
      expect((must('menu-open-shell') as HTMLButtonElement).disabled).toBe(false);
    });
  });

  describe('current operations', () => {
    it('is offered on a connection only while it is connected', async () => {
      await start();
      await menu(node('conn', 'Profile p1'));
      const item = must('menu-current-ops') as HTMLButtonElement;
      expect(item.textContent?.trim()).toBe('Current operations');
      expect(item.disabled).toBe(true);
      await click(item);
      expect(TestBed.inject(WorkspaceService).tabs()).toHaveLength(0);
    });

    it('opens the current operations tab from the connection menu', async () => {
      await start();
      await click(node('conn', 'Profile p1'));
      await menu(node('conn', 'Profile p1'));
      await click(must('menu-current-ops'));
      expect(TestBed.inject(WorkspaceService).active()).toMatchObject({
        id: 'currentop:p1',
        kind: 'currentop',
        title: 'Current operations',
        detail: 'Profile p1',
        data: { profileId: 'p1' },
      });
      expect(byTestId('tree-menu')).toBeNull();
    });

    it('stays available on read-only profiles (listing is a read)', async () => {
      await start();
      await click(node('conn', 'Reader'));
      await menu(node('conn', 'Reader'));
      expect((must('menu-current-ops') as HTMLButtonElement).disabled).toBe(false);
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

      await menu(node('db', 'shop'));
      expect((must('menu-create-coll') as HTMLButtonElement).disabled).toBe(true);
      expect((must('menu-drop-db') as HTMLButtonElement).disabled).toBe(true);
      expect((must('menu-refresh') as HTMLButtonElement).disabled).toBe(false);
      expect((must('menu-stats') as HTMLButtonElement).disabled).toBe(false);
      // Viewing users and roles is a read: allowed on a read-only profile.
      expect((must('menu-users') as HTMLButtonElement).disabled).toBe(false);

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

  describe('menu details', () => {
    async function key(target: Element, k: string, init: KeyboardEventInit = {}): Promise<void> {
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }),
      );
      await settle();
    }

    it('moves through the menu with the arrows (wrapping), Home and End', async () => {
      await start();
      await openShop();
      await menu(node('coll', 'orders'));
      expect(document.activeElement).toBe(must('menu-open'));
      await key(document.activeElement as Element, 'ArrowDown');
      expect(document.activeElement).toBe(must('menu-stats'));
      await key(document.activeElement as Element, 'End');
      expect(document.activeElement).toBe(must('menu-drop-coll'));
      await key(document.activeElement as Element, 'ArrowDown');
      expect(document.activeElement).toBe(must('menu-open'));
      await key(document.activeElement as Element, 'ArrowUp');
      expect(document.activeElement).toBe(must('menu-drop-coll'));
      await key(document.activeElement as Element, 'Home');
      expect(document.activeElement).toBe(must('menu-open'));
    });

    it('skips disabled items when moving through the menu', async () => {
      await start();
      await openShop();
      await menu(node('coll', 'big_orders'));
      // Open, (stats disabled), (rename disabled), Drop view.
      expect(document.activeElement).toBe(must('menu-open'));
      await key(document.activeElement as Element, 'ArrowDown');
      expect(document.activeElement).toBe(must('menu-drop-coll'));
    });

    it('closes with Tab and returns focus to the node', async () => {
      await start();
      await openShop();
      await menu(node('coll', 'orders'));
      await key(must('menu-open'), 'Tab');
      expect(byTestId('tree-menu')).toBeNull();
      expect(document.activeElement).toBe(node('coll', 'orders'));
    });

    it('closes on a mousedown outside the menu but not inside it', async () => {
      await start();
      await openShop();
      await menu(node('coll', 'orders'));
      must('menu-stats').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await settle();
      expect(byTestId('tree-menu')).not.toBeNull();
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await settle();
      expect(byTestId('tree-menu')).toBeNull();
    });

    it('keeps the menu inside the window near the bottom right corner', async () => {
      const real = HTMLElement.prototype.getBoundingClientRect;
      const spy = vi
        .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
        .mockImplementation(function (this: HTMLElement) {
          return this.classList.contains('menu')
            ? DOMRect.fromRect({ x: 0, y: 0, width: 200, height: 120 })
            : real.call(this);
        });
      try {
        await start();
        node('conn', 'Profile p1').dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: window.innerWidth - 10,
            clientY: window.innerHeight - 10,
          }),
        );
        await settle();
        const m = must('tree-menu');
        const left = parseFloat(m.style.left);
        const top = parseFloat(m.style.top);
        expect(left + 200).toBeLessThanOrEqual(window.innerWidth);
        expect(left).toBeGreaterThanOrEqual(0);
        // No room below the pointer: the menu opens above it.
        expect(top).toBe(window.innerHeight - 10 - 120);
        expect(document.activeElement).toBe(must('menu-connect'));
      } finally {
        spy.mockRestore();
      }
    });

    it('leaves a menu that fits at the pointer', async () => {
      await start();
      await menu(node('conn', 'Profile p1'));
      expect(must('tree-menu').style.left).toBe('20px');
      expect(must('tree-menu').style.top).toBe('30px');
    });

    it('opens with the ContextMenu key', async () => {
      await start();
      await key(node('conn', 'Profile p1'), 'ContextMenu');
      expect(byTestId('tree-menu')).not.toBeNull();
      expect(must('menu-connect').textContent).toContain('Connect');
    });

    it('offers only Connect on a disconnected connection', async () => {
      await start();
      await menu(node('conn', 'Profile p1'));
      expect((must('menu-connect') as HTMLButtonElement).disabled).toBe(false);
      expect((must('menu-refresh') as HTMLButtonElement).disabled).toBe(true);
      expect((must('menu-sizes') as HTMLButtonElement).disabled).toBe(true);
      expect((must('menu-create-db') as HTMLButtonElement).disabled).toBe(true);
      await click(must('menu-connect'));
      expect(fake.requestsFor('conn.open')).toHaveLength(1);
      expect(nodes('db')).toEqual(['admin', 'shop']);
    });

    it('a view has no stats or rename and is dropped as a view', async () => {
      await start();
      await openShop();
      await menu(node('coll', 'big_orders'));
      expect((must('menu-stats') as HTMLButtonElement).disabled).toBe(true);
      expect((must('menu-rename') as HTMLButtonElement).disabled).toBe(true);
      expect(must('menu-drop-coll').textContent?.trim()).toBe('Drop view…');
      await click(must('menu-rename'));
      expect(byTestId('tree-prompt')).toBeNull();
    });

    it('refreshes the databases and collections from the menu', async () => {
      await start();
      await openShop();
      await menu(node('conn', 'Profile p1'));
      await click(must('menu-refresh'));
      expect(fake.requestsFor('db.listDatabases')).toHaveLength(2);
      await menu(node('db', 'shop'));
      await click(must('menu-refresh'));
      expect(fake.requestsFor('coll.list')).toHaveLength(2);
    });

    it('shows a failed stats request on the node with the error as tooltip', async () => {
      fake.fail('coll.stats', { code: 'SERVER_ERROR', message: 'stats not allowed' });
      await start();
      await openShop();
      await menu(node('coll', 'orders'));
      await click(must('menu-stats'));
      const stats = node('coll', 'orders').querySelector<HTMLElement>('[data-testid="node-stats"]');
      expect(stats?.textContent).toBe('stats failed');
      expect(stats?.title).toContain('stats not allowed');
    });

    it('shows a failed database stats request on the database node', async () => {
      fake.fail('db.stats', { code: 'SERVER_ERROR', message: 'dbStats not allowed' });
      await start();
      await click(node('conn', 'Profile p1'));
      await menu(node('db', 'shop'));
      await click(must('menu-stats'));
      const stats = node('db', 'shop').querySelector<HTMLElement>('[data-testid="node-stats"]');
      expect(stats?.textContent).toBe('stats failed');
      expect(stats?.title).toContain('dbStats not allowed');
    });

    it('dismisses a notice', async () => {
      fake.fail('db.drop', { code: 'SERVER_ERROR', message: 'not authorized to drop' });
      await start();
      await click(node('conn', 'Profile p1'));
      await menu(node('db', 'shop'));
      await click(must('menu-drop-db'));
      await type('confirm-type', 'shop');
      await click(must('confirm-ok'));
      await click(must('sidebar-notice').querySelector('button') as HTMLElement);
      expect(byTestId('sidebar-notice')).toBeNull();
    });
  });

  describe('prompt details', () => {
    async function key(target: Element, k: string, init: KeyboardEventInit = {}): Promise<void> {
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }),
      );
      await settle();
    }

    async function openCreateCollection(): Promise<void> {
      await click(node('conn', 'Profile p1'));
      await menu(node('db', 'shop'));
      await click(must('menu-create-coll'));
    }

    it('focuses the first field of a prompt opened from the context menu', async () => {
      // The prompt is a modal dialog (aria-modal, focus trap): keyboard users must land in it.
      await start();
      await openCreateCollection();
      expect(document.activeElement).toBe(must('prompt-coll'));
    });

    it('focuses the password field of the connect prompt', async () => {
      profiles = [
        profile('p1', { auth: { mechanism: 'SCRAM-SHA-256', username: 'u', secretMode: 'ask' } }),
      ];
      await start();
      await click(node('conn', 'Profile p1'));
      expect(document.activeElement).toBe(must('prompt-password'));
    });

    it('closes with Escape and returns focus to the node', async () => {
      await start();
      await openCreateCollection();
      await key(must('prompt-coll'), 'Escape');
      expect(byTestId('tree-prompt')).toBeNull();
      expect(fake.requestsFor('coll.create')).toHaveLength(0);
      expect(document.activeElement).toBe(node('db', 'shop'));
    });

    it('keeps the focus inside the prompt with Tab and Shift+Tab', async () => {
      await start();
      await openCreateCollection();
      const input = must('prompt-coll');
      const ok = must('prompt-ok');
      ok.focus();
      await key(ok, 'Tab');
      expect(document.activeElement).toBe(input);
      await key(input, 'Tab', { shiftKey: true });
      expect(document.activeElement).toBe(ok);
    });

    it('does not close with Escape while the request is running', async () => {
      let release!: () => void;
      fake.handle(
        'coll.create',
        () =>
          new Promise((resolve) => {
            release = () => resolve({});
          }),
      );
      await start();
      await openCreateCollection();
      await type('prompt-coll', 'fresh');
      await click(must('prompt-ok'));
      expect((must('prompt-ok') as HTMLButtonElement).disabled).toBe(true);
      await key(must('tree-prompt'), 'Escape');
      expect(byTestId('tree-prompt')).not.toBeNull();
      release();
      await settle();
      expect(byTestId('tree-prompt')).toBeNull();
    });

    it('refuses renaming to the same name', async () => {
      await start();
      await openShop();
      await menu(node('coll', 'orders'));
      await click(must('menu-rename'));
      await click(must('prompt-ok'));
      expect(must('prompt-problem').textContent).toBe('Enter a different name.');
      expect(fake.requestsFor('coll.rename')).toHaveLength(0);
    });

    it('refuses an invalid collection name before sending', async () => {
      await start();
      await openCreateCollection();
      await type('prompt-coll', 'system.users');
      await click(must('prompt-ok'));
      expect(must('prompt-problem').textContent).toContain('reserved');
      expect((must('prompt-coll') as HTMLInputElement).getAttribute('aria-invalid')).toBe('true');
      expect(fake.requestsFor('coll.create')).toHaveLength(0);
    });

    it('keeps the password prompt open with the error when the connection fails', async () => {
      profiles = [
        profile('p1', { auth: { mechanism: 'SCRAM-SHA-256', username: 'u', secretMode: 'ask' } }),
      ];
      fake.fail('conn.open', { code: 'AUTH_FAILED', message: 'Authentication failed' });
      await start();
      await click(node('conn', 'Profile p1'));
      await type('prompt-password', 'wrong-fictitious');
      await click(must('prompt-ok'));
      expect(byTestId('tree-prompt')).not.toBeNull();
      expect(must('prompt-error').textContent).toContain('Authentication failed');
    });

    it('a cancelled production confirm keeps the prompt open without an error', async () => {
      profiles = [profile('p1', { production: true })];
      await start();
      await openCreateCollection();
      await type('prompt-coll', 'fresh');
      await click(must('prompt-ok'));
      expect(byTestId('confirm-dialog')).not.toBeNull();
      await click(must('confirm-cancel'));
      expect(byTestId('tree-prompt')).not.toBeNull();
      expect(byTestId('prompt-error')).toBeNull();
      expect(fake.requestsFor('coll.create')).toHaveLength(0);
    });
  });

  describe('tree details', () => {
    it('shows empty database and collection lists', async () => {
      databases = { p1: ['empty'] };
      await start();
      await click(node('conn', 'Profile p1'));
      await click(node('db', 'empty'));
      expect(byTestId('tree-status')?.textContent).toContain('No collections.');
      databases = { p1: [] };
      await menu(node('conn', 'Profile p1'));
      await click(must('menu-refresh'));
      expect(byTestId('tree-status')?.textContent).toContain('No databases.');
    });

    it('collapses a connection on a second click without disconnecting', async () => {
      await start();
      await click(node('conn', 'Profile p1'));
      await click(node('conn', 'Profile p1'));
      expect(nodes('db')).toEqual([]);
      expect(node('conn', 'Profile p1').dataset['state']).toBe('connected');
      expect(fake.requestsFor('conn.close')).toHaveLength(0);
    });

    it('moves to the first and last node with Home and End, opens with Space', async () => {
      await start();
      await openShop();
      const press = async (target: HTMLElement, k: string) => {
        target.dispatchEvent(
          new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }),
        );
        await settle();
      };
      await press(node('conn', 'Profile p1'), 'End');
      expect(document.activeElement).toBe(node('conn', 'Reader'));
      await press(node('conn', 'Reader'), 'Home');
      expect(document.activeElement).toBe(node('conn', 'Profile p1'));
      await press(node('coll', 'orders'), ' ');
      expect(TestBed.inject(WorkspaceService).activeId()).toBe(
        collectionTabId('p1', 'shop', 'orders'),
      );
    });

    it('shows a connecting line while conn.open is pending', async () => {
      let release!: () => void;
      fake.handle(
        'conn.open',
        ({ profileId }) =>
          new Promise((resolve) => {
            release = () => resolve({ profileId, state: 'connected' });
          }),
      );
      await start();
      await click(node('conn', 'Profile p1'));
      expect(node('conn', 'Profile p1').dataset['state']).toBe('connecting');
      expect(must('tree-status').textContent).toContain('Connecting');
      release();
      await settle();
      expect(nodes('db')).toEqual(['admin', 'shop']);
    });

    it('Disconnect while connecting shows the node not connected, without an error', async () => {
      let cancel!: () => void;
      fake.handle(
        'conn.open',
        () =>
          new Promise((resolve) => {
            cancel = () =>
              resolve({ error: { code: 'CANCELLED', message: 'The operation was cancelled.' } });
          }) as never,
      );
      await start();
      await click(node('conn', 'Profile p1'));
      expect(node('conn', 'Profile p1').dataset['state']).toBe('connecting');
      await menu(node('conn', 'Profile p1'));
      await click(must('menu-disconnect'));
      cancel();
      await settle();
      expect(node('conn', 'Profile p1').dataset['state']).toBe('disconnected');
      expect(el.textContent).not.toContain('cancelled');
      expect(fake.requestsFor('db.listDatabases')).toHaveLength(0);
    });

    it('shows a failed database list with a retry', async () => {
      fake.fail('db.listDatabases', { code: 'SERVER_ERROR', message: 'listDatabases refused' });
      await start();
      await click(node('conn', 'Profile p1'));
      const line = must('tree-status');
      expect(line.dataset['tone']).toBe('error');
      expect(line.textContent).toContain('listDatabases refused');
      fake.handle('db.listDatabases', () => ({ databases: [{ name: 'shop' }] }));
      await click(must('tree-retry'));
      expect(nodes('db')).toEqual(['shop']);
    });

    it('reconnects from the Connect link of a disconnected connection', async () => {
      await start();
      await click(node('conn', 'Profile p1'));
      fake.emit({
        stream: 'conn.status',
        kind: 'data',
        payload: { profileId: 'p1', state: 'disconnected' },
      });
      await settle();
      expect(must('tree-retry').textContent?.trim()).toBe('Connect');
      await click(must('tree-retry'));
      expect(fake.requestsFor('conn.open')).toHaveLength(2);
      expect(nodes('db')).toEqual(['admin', 'shop']);
    });

    it('expanding a connection that is already open loads its databases without conn.open', async () => {
      fake.respond('conn.status', { connections: [{ profileId: 'p1', state: 'connected' }] });
      await start();
      expect(node('conn', 'Profile p1').dataset['state']).toBe('connected');
      await click(node('conn', 'Profile p1'));
      expect(fake.requestsFor('conn.open')).toHaveLength(0);
      expect(nodes('db')).toEqual(['admin', 'shop']);
    });

    it('opens a collection from the Open menu item', async () => {
      await start();
      await openShop();
      await menu(node('coll', 'ticks'));
      await click(must('menu-open'));
      expect(TestBed.inject(WorkspaceService).active()).toMatchObject({
        id: collectionTabId('p1', 'shop', 'ticks'),
        data: { type: 'timeseries' },
      });
    });

    it('shows a placeholder while stats load', async () => {
      let release!: () => void;
      fake.handle(
        'db.stats',
        () =>
          new Promise((resolve) => {
            release = () =>
              resolve({
                collections: 1,
                views: 0,
                objects: 1,
                dataSize: 1,
                storageSize: 1,
                indexSize: 1,
                raw: '{}',
              });
          }),
      );
      await start();
      await click(node('conn', 'Profile p1'));
      await menu(node('db', 'shop'));
      await click(must('menu-stats'));
      expect(node('db', 'shop').querySelector('[data-testid="node-stats"]')?.textContent).toBe('…');
      release();
      await settle();
      expect(node('db', 'shop').textContent).toContain('1 coll., 1 doc, 1 B');
    });

    it('sends a prompt only once when it is submitted twice', async () => {
      let release!: () => void;
      fake.handle(
        'coll.create',
        () =>
          new Promise((resolve) => {
            release = () => resolve({});
          }),
      );
      await start();
      await click(node('conn', 'Profile p1'));
      await menu(node('db', 'shop'));
      await click(must('menu-create-coll'));
      await type('prompt-coll', 'fresh');
      const form = must('tree-prompt');
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await settle();
      expect(fake.requestsFor('coll.create')).toHaveLength(1);
      release();
      await settle();
      expect(byTestId('tree-prompt')).toBeNull();
    });

    it('ArrowRight on an open node moves to its first child, ArrowUp moves back', async () => {
      await start();
      await click(node('conn', 'Profile p1'));
      const press = async (target: HTMLElement, k: string) => {
        target.dispatchEvent(
          new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }),
        );
        await settle();
      };
      await press(node('conn', 'Profile p1'), 'ArrowRight');
      expect(document.activeElement).toBe(node('db', 'admin'));
      await press(node('db', 'admin'), 'ArrowUp');
      expect(document.activeElement).toBe(node('conn', 'Profile p1'));
      // F10 without Shift does not open the menu.
      await press(node('conn', 'Profile p1'), 'F10');
      expect(byTestId('tree-menu')).toBeNull();
    });

    it('reloads the profiles with the refresh button', async () => {
      await start();
      profiles = [...profiles, profile('p3')];
      await click(must('sidebar-refresh'));
      expect(nodes('conn')).toEqual(['Profile p1', 'Reader', 'Profile p3']);
    });

    it('resets the tree when the backend restarts', async () => {
      await start();
      await openShop();
      fake.emit({
        stream: 'backend.restarted',
        kind: 'data',
        payload: { restarts: 1, reason: 'exit code 1' },
      });
      await settle();
      expect(node('conn', 'Profile p1').dataset['state']).toBe('disconnected');
      expect(nodes('db')).toEqual([]);
      expect(byTestId('tree-status')?.textContent).toContain('Not connected');
    });
  });

  describe('round 2 fixes', () => {
    async function key(target: Element, k: string, init: KeyboardEventInit = {}): Promise<void> {
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }),
      );
      await settle();
    }

    it('a disconnect collapses only the databases of that connection', async () => {
      databases = { p1: ['shop'], p2: ['archive'] };
      collections['archive'] = [coll('logs')];
      await start();
      await openShop();
      await click(node('conn', 'Reader'));
      await click(node('db', 'archive'));
      expect(nodes('coll')).toEqual(['big_orders', 'orders', 'ticks', 'logs']);
      fake.emit({
        stream: 'conn.status',
        kind: 'data',
        payload: { profileId: 'p1', state: 'disconnected' },
      });
      await settle();
      expect(node('db', 'archive').getAttribute('aria-expanded')).toBe('true');
      expect(nodes('coll')).toEqual(['logs']);
      expect(fake.requestsFor('coll.list')).toHaveLength(2);
    });

    it('tells the shell while the prompt is open, through submit and Escape', async () => {
      const service = TestBed.inject(SidebarTreeService);
      fake.respond('coll.create', {});
      await start();
      expect(service.promptOpen()).toBe(false);
      await click(node('conn', 'Profile p1'));
      await menu(node('db', 'shop'));
      await click(must('menu-create-coll'));
      expect(service.promptOpen()).toBe(true);
      await type('prompt-coll', 'fresh');
      await click(must('prompt-ok'));
      expect(byTestId('tree-prompt')).toBeNull();
      expect(service.promptOpen()).toBe(false);

      await menu(node('db', 'shop'));
      await click(must('menu-create-coll'));
      expect(service.promptOpen()).toBe(true);
      await key(must('prompt-coll'), 'Escape');
      expect(service.promptOpen()).toBe(false);
    });

    it('cancelling Create collection… on a collapsed database leaves its collections loaded', async () => {
      await start();
      await click(node('conn', 'Profile p1'));
      expect(fake.requestsFor('coll.list')).toHaveLength(0);
      await menu(node('db', 'shop'));
      await click(must('menu-create-coll'));
      await click(must('prompt-cancel'));
      expect(byTestId('tree-prompt')).toBeNull();
      expect(node('db', 'shop').getAttribute('aria-expanded')).toBe('true');
      expect(fake.requestsFor('coll.list')).toHaveLength(1);
      expect(nodes('coll')).toEqual(['big_orders', 'orders', 'ticks']);
      expect(el.textContent).not.toContain('Loading collections…');

      // Opening the prompt again on the loaded database does not reload the list.
      await menu(node('db', 'shop'));
      await click(must('menu-create-coll'));
      await key(must('prompt-coll'), 'Escape');
      expect(fake.requestsFor('coll.list')).toHaveLength(1);
    });

    it('cancelling Create database… on an open connection never listed loads its databases', async () => {
      fake.respond('conn.status', { connections: [{ profileId: 'p1', state: 'connected' }] });
      await start();
      expect(node('conn', 'Profile p1').dataset['state']).toBe('connected');
      expect(fake.requestsFor('db.listDatabases')).toHaveLength(0);
      await menu(node('conn', 'Profile p1'));
      await click(must('menu-create-db'));
      await key(must('prompt-db'), 'Escape');
      expect(byTestId('tree-prompt')).toBeNull();
      expect(node('conn', 'Profile p1').getAttribute('aria-expanded')).toBe('true');
      expect(fake.requestsFor('conn.open')).toHaveLength(0);
      expect(fake.requestsFor('db.listDatabases')).toHaveLength(1);
      expect(nodes('db')).toEqual(['admin', 'shop']);
      expect(el.textContent).not.toContain('Loading databases…');

      await menu(node('conn', 'Profile p1'));
      await click(must('menu-create-db'));
      await key(must('prompt-db'), 'Escape');
      expect(fake.requestsFor('db.listDatabases')).toHaveLength(1);
    });

    it('clears the prompt flag when the sidebar is destroyed with the prompt open', async () => {
      const service = TestBed.inject(SidebarTreeService);
      await start();
      await click(node('conn', 'Profile p1'));
      await menu(node('db', 'shop'));
      await click(must('menu-create-coll'));
      expect(service.promptOpen()).toBe(true);
      fixture.destroy();
      expect(service.promptOpen()).toBe(false);
    });

    it('a menu item that opens no prompt returns the focus to its node', async () => {
      await start();
      await openShop();
      await menu(node('conn', 'Profile p1'));
      await click(must('menu-refresh'));
      expect(byTestId('tree-menu')).toBeNull();
      expect(document.activeElement).toBe(node('conn', 'Profile p1'));
    });

    it('keeps a menu larger than the room around the pointer at the window margin', async () => {
      const real = HTMLElement.prototype.getBoundingClientRect;
      const width = window.innerWidth + 50;
      const height = window.innerHeight - 20;
      const spy = vi
        .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
        .mockImplementation(function (this: HTMLElement) {
          return this.classList.contains('menu')
            ? DOMRect.fromRect({ x: 0, y: 0, width, height })
            : real.call(this);
        });
      try {
        await start();
        node('conn', 'Profile p1').dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: 40,
            clientY: 100,
          }),
        );
        await settle();
        const m = must('tree-menu');
        // Neither fits: the menu sits at the 4px margin instead of leaving the window.
        expect(m.style.left).toBe('4px');
        expect(m.style.top).toBe('4px');
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('create prompts on lists not loaded yet (round 3)', () => {
    async function key(target: Element, k: string): Promise<void> {
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }),
      );
      await settle();
    }

    it('does not request the collections again while the list from the prompt still loads', async () => {
      let release!: () => void;
      fake.handle(
        'coll.list',
        ({ db }) =>
          new Promise((resolve) => {
            release = () => resolve({ collections: collections[db] ?? [] });
          }),
      );
      await start();
      await click(node('conn', 'Profile p1'));
      await menu(node('db', 'shop'));
      await click(must('menu-create-coll'));
      await key(must('prompt-coll'), 'Escape');
      expect(el.textContent).toContain('Loading collections…');
      await menu(node('db', 'shop'));
      await click(must('menu-create-coll'));
      await key(must('prompt-coll'), 'Escape');
      expect(fake.requestsFor('coll.list')).toHaveLength(1);

      release();
      await settle();
      expect(nodes('coll')).toEqual(['big_orders', 'orders', 'ticks']);
      expect(el.textContent).not.toContain('Loading collections…');
    });

    it('keeps the created collection when the list started by the prompt answers last', async () => {
      const pending: (() => void)[] = [];
      fake.handle('coll.list', ({ db }) => {
        const snapshot = [...(collections[db] ?? [])];
        // The first answer (started when the prompt opened) is held back; later ones answer at once.
        if (fake.requestsFor('coll.list').length > 1) return { collections: snapshot };
        return new Promise((resolve) => pending.push(() => resolve({ collections: snapshot })));
      });
      fake.handle('coll.create', ({ db, coll: name }) => {
        collections[db] = [...(collections[db] ?? []), coll(name)];
        return {};
      });
      await start();
      await click(node('conn', 'Profile p1'));
      await menu(node('db', 'shop'));
      await click(must('menu-create-coll'));
      await type('prompt-coll', 'fresh');
      await click(must('prompt-ok'));
      expect(byTestId('tree-prompt')).toBeNull();
      expect(fake.requestsFor('coll.list')).toHaveLength(2);
      expect(nodes('coll')).toEqual(['big_orders', 'fresh', 'orders', 'ticks']);

      // The older list (without "fresh") answers now and must not replace the newer one.
      pending.forEach((answer) => answer());
      await settle();
      expect(nodes('coll')).toEqual(['big_orders', 'fresh', 'orders', 'ticks']);
    });

    it('keeps the created database when the list started by the prompt answers last', async () => {
      fake.respond('conn.status', { connections: [{ profileId: 'p1', state: 'connected' }] });
      const pending: (() => void)[] = [];
      fake.handle('db.listDatabases', ({ profileId }) => {
        const snapshot = (databases[profileId] ?? []).map((name) => ({ name }));
        if (fake.requestsFor('db.listDatabases').length > 1) return { databases: snapshot };
        return new Promise((resolve) => pending.push(() => resolve({ databases: snapshot })));
      });
      fake.handle('db.create', ({ db }) => {
        databases['p1']?.push(db);
        collections[db] = [coll('first')];
        return {};
      });
      await start();
      await menu(node('conn', 'Profile p1'));
      await click(must('menu-create-db'));
      expect(el.textContent).toContain('Loading databases…');
      await type('prompt-db', 'newdb');
      await type('prompt-coll', 'first');
      await click(must('prompt-ok'));
      expect(byTestId('tree-prompt')).toBeNull();
      expect(fake.requestsFor('conn.open')).toHaveLength(0);
      expect(fake.requestsFor('db.listDatabases')).toHaveLength(2);
      expect(nodes('db')).toEqual(['admin', 'newdb', 'shop']);

      pending.forEach((answer) => answer());
      await settle();
      expect(nodes('db')).toEqual(['admin', 'newdb', 'shop']);
      expect(el.textContent).not.toContain('Loading databases…');
    });

    it('a failed list started by the prompt shows the error with a retry after cancelling', async () => {
      fake.fail('coll.list', { code: 'INTERNAL', message: 'listCollections failed' });
      await start();
      await click(node('conn', 'Profile p1'));
      await menu(node('db', 'shop'));
      await click(must('menu-create-coll'));
      await click(must('prompt-cancel'));
      expect(el.textContent).not.toContain('Loading collections…');
      expect(el.textContent).toContain('listCollections failed');
    });
  });
});
