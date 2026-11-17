import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../../api/testing';
import type { WorkspaceTab } from '../../layout/workspace.service';
import { UsersRolesView, usersTabId } from './users-roles-view';

const TAB: WorkspaceTab = {
  id: usersTabId('p1', 'shop'),
  kind: 'users',
  title: 'shop users',
  data: { profileId: 'p1', db: 'shop' },
};

const ALICE = JSON.stringify({
  _id: 'shop.alice',
  user: 'alice',
  db: 'shop',
  mechanisms: ['SCRAM-SHA-256'],
  customData: { team: 'sales', level: { $numberInt: '3' } },
  roles: [
    { role: 'clerk', db: 'shop' },
    { role: 'read', db: 'reports' },
  ],
  inheritedRoles: [
    { role: 'clerk', db: 'shop' },
    { role: 'reader', db: 'shop' },
    { role: 'read', db: 'reports' },
  ],
  inheritedPrivileges: [
    { resource: { db: 'shop', collection: 'orders' }, actions: ['update', 'find', 'insert'] },
    { resource: { db: 'reports', collection: '' }, actions: ['find'] },
  ],
});
const BOB = JSON.stringify({
  user: 'bob',
  db: 'shop',
  roles: [{ role: 'reader', db: 'shop' }],
  inheritedRoles: [{ role: 'reader', db: 'shop' }],
  inheritedPrivileges: [],
});

const CLERK = JSON.stringify({
  role: 'clerk',
  db: 'shop',
  isBuiltin: false,
  roles: [
    { role: 'reader', db: 'shop' },
    { role: 'read', db: 'shop' },
  ],
  inheritedRoles: [
    { role: 'reader', db: 'shop' },
    { role: 'read', db: 'shop' },
  ],
  privileges: [{ resource: { db: 'shop', collection: 'orders' }, actions: ['insert', 'update'] }],
  inheritedPrivileges: [
    { resource: { db: 'shop', collection: 'orders' }, actions: ['find', 'insert', 'update'] },
    { resource: { db: 'shop', collection: '' }, actions: ['listCollections'] },
  ],
});
const READER = JSON.stringify({
  role: 'reader',
  db: 'shop',
  isBuiltin: false,
  roles: [],
  inheritedRoles: [],
  privileges: [{ resource: { db: 'shop', collection: 'orders' }, actions: ['find'] }],
  inheritedPrivileges: [{ resource: { db: 'shop', collection: 'orders' }, actions: ['find'] }],
});
const READ = JSON.stringify({
  role: 'read',
  db: 'shop',
  isBuiltin: true,
  roles: [],
  inheritedRoles: [],
  privileges: [{ resource: { db: 'shop', collection: '' }, actions: ['find', 'listCollections'] }],
  inheritedPrivileges: [],
});

describe('UsersRolesView', () => {
  let fake: FakeThicketBridge;
  let fixture: ComponentFixture<UsersRolesView>;
  let view: UsersRolesView;

  const el = () => fixture.nativeElement as HTMLElement;
  const all = (id: string) => [...el().querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
  const get = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const found = el().querySelector<T>(`[data-testid="${id}"]`);
    if (found === null) throw new Error(`no element ${id}`);
    return found;
  };
  const texts = (root: Element, selector: string) =>
    [...root.querySelectorAll(selector)].map((e) => e.textContent?.replace(/\s+/g, ' ').trim());
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
  };
  const rolesParams = () =>
    fake.requestsFor('admin.roles').map((r) => r.params as Record<string, unknown>);

  async function create(tab: WorkspaceTab = TAB) {
    fixture = TestBed.createComponent(UsersRolesView);
    fixture.componentRef.setInput('tab', tab);
    view = fixture.componentInstance;
    await settle();
  }

  beforeEach(() => {
    fake = new FakeThicketBridge();
    fake.respond('admin.users', { users: [ALICE, BOB] });
    fake.handle('admin.roles', (p) => ({
      roles: p.builtin ? [CLERK, READ, READER] : [CLERK, READER],
    }));
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideFakeThicket(fake)],
    });
  });

  it('loads the users and roles of the tab database', async () => {
    await create();
    expect(fake.requestsFor('admin.users').map((r) => r.params)).toEqual([
      { profileId: 'p1', db: 'shop' },
    ]);
    expect(rolesParams()).toEqual([{ profileId: 'p1', db: 'shop', builtin: false }]);
    expect(texts(el(), '[data-testid="user-item"] .name')).toEqual(['alice', 'bob']);
    expect(el().textContent).toContain('db.getUsers()');
  });

  it('shows the first user: direct roles, roles held through them, privileges and custom data', async () => {
    await create();
    const detail = get('user-detail');
    expect(detail.querySelector('.title')?.textContent).toContain('alice');
    expect(detail.textContent).toContain('Signs in with SCRAM-SHA-256');
    expect(texts(get('direct-roles'), '.role')).toEqual(['clerk@shop', 'read@reports']);
    expect(texts(get('inherited-roles'), '.role')).toEqual(['reader@shop']);
    const rows = [...get('privileges').querySelectorAll('tbody tr')];
    expect(rows.map((r) => texts(r, 'th')[0])).toEqual(['reports.*', 'shop.orders']);
    expect(texts(rows[1] as Element, '.action')).toEqual(['find', 'insert', 'update']);
    expect(detail.querySelector('pre')?.textContent).toContain('team: "sales"');
    expect(detail.querySelector('pre')?.textContent).toContain('level: 3');
  });

  it('only roles of this database are links', async () => {
    await create();
    expect(texts(get('direct-roles'), '[data-testid="role-link"]')).toEqual(['clerk@shop']);
  });

  it('selects another user', async () => {
    await create();
    (all('user-item')[1] as HTMLElement).click();
    await settle();
    expect(get('user-detail').querySelector('.title')?.textContent).toContain('bob');
    expect(all('user-item')[1]?.getAttribute('aria-current')).toBe('true');
    expect(el().querySelector('[data-testid="inherited-roles"]')).toBeNull();
  });

  it('switches to roles: own privileges, inherited roles and all privileges', async () => {
    await create();
    get('mode-roles').click();
    await settle();
    expect(el().textContent).toContain('db.getRoles()');
    expect(texts(el(), '[data-testid="role-item"] .name')).toEqual(['clerk', 'reader']);
    const detail = get('role-detail');
    expect(texts(get('direct-roles'), '.role')).toEqual(['read@shop', 'reader@shop']);
    const tables = detail.querySelectorAll('[data-testid="privileges"]');
    expect(tables).toHaveLength(2);
    expect(texts(tables[0] as Element, '.action')).toEqual(['insert', 'update']);
    expect(texts(tables[1] as Element, 'tbody th')).toEqual(['shop.*', 'shop.orders']);
  });

  it('a role without parents shows "None." and no "All privileges" table', async () => {
    await create();
    get('mode-roles').click();
    await settle();
    (all('role-item')[1] as HTMLElement).click();
    await settle();
    const detail = get('role-detail');
    expect(detail.querySelector('.none')?.textContent).toBe('None.');
    expect(detail.querySelectorAll('[data-testid="privileges"]')).toHaveLength(1);
  });

  it('the built-in toggle reloads the roles with built-in roles', async () => {
    await create();
    get('mode-roles').click();
    await settle();
    const box = get<HTMLInputElement>('builtin');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await settle();
    expect(rolesParams().at(-1)).toEqual({ profileId: 'p1', db: 'shop', builtin: true });
    expect(texts(el(), '[data-testid="role-item"] .name')).toEqual(['clerk', 'read', 'reader']);
    expect(el().querySelector('[data-testid="role-item"].builtin .tag')?.textContent).toBe(
      'built-in',
    );
    expect(el().textContent).toContain('db.getRoles({ showBuiltinRoles: true })');
  });

  it('a role link opens that role in the roles list', async () => {
    await create();
    (get('direct-roles').querySelector('[data-testid="role-link"]') as HTMLElement).click();
    await settle();
    expect(view.mode()).toBe('roles');
    expect(get('role-detail').querySelector('.title')?.textContent).toContain('clerk');
  });

  it('a link to a built-in role turns on the built-in roles to show it', async () => {
    await create();
    get('mode-roles').click();
    await settle();
    // clerk inherits from the built-in read@shop, which isn't listed yet.
    const read = [
      ...get('direct-roles').querySelectorAll<HTMLElement>('[data-testid="role-link"]'),
    ].find((b) => b.textContent?.includes('read@'));
    read?.click();
    await settle();
    expect(view.builtin()).toBe(true);
    expect(rolesParams().at(-1)).toMatchObject({ builtin: true });
    expect(get('role-detail').querySelector('.title')?.textContent).toContain('read');
    expect(get('role-detail').querySelector('.tag')?.textContent).toBe('built-in');
  });

  it('shows empty states', async () => {
    fake.respond('admin.users', { users: [] });
    fake.respond('admin.roles', { roles: [] });
    await create();
    expect(get('empty').textContent).toContain('No users are defined in shop.');
    get('mode-roles').click();
    await settle();
    expect(get('empty').textContent).toContain('No custom roles are defined in shop.');
  });

  it('shows a server refusal as an alert', async () => {
    fake.fail('admin.users', {
      code: 'SERVER_ERROR',
      message: 'The server refused the command: not authorized on shop to execute command',
    });
    await create();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain('not authorized on shop');
  });

  it('shows loading while a request is pending and Refresh reads both again', async () => {
    let release!: () => void;
    fake.handle(
      'admin.users',
      () => new Promise((resolve) => (release = () => resolve({ users: [BOB] }))),
    );
    await create();
    expect(el().querySelector('[role="status"]')?.textContent).toContain('Loading users');
    release();
    await settle();
    expect(texts(el(), '[data-testid="user-item"] .name')).toEqual(['bob']);
    fake.respond('admin.users', { users: [ALICE] });
    get('refresh').click();
    await settle();
    expect(fake.requestsFor('admin.users')).toHaveLength(2);
    expect(rolesParams()).toHaveLength(2);
    expect(texts(el(), '[data-testid="user-item"] .name')).toEqual(['alice']);
  });

  it('cancels pending requests when the tab is destroyed', async () => {
    fake.handle('admin.users', () => new Promise(() => undefined));
    await create();
    const id = fake.requestsFor('admin.users')[0]?.id;
    fixture.destroy();
    expect(fake.cancels).toContain(id);
  });
});
