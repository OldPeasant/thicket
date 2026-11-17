import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../../api/testing';
import { ConfirmService } from '../../safety/confirm.service';
import { ProfileSafetyService } from '../../safety/profile-safety.service';
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

  it('shows a roles failure as an alert in roles mode, users still listed', async () => {
    fake.fail('admin.roles', { code: 'SERVER_ERROR', message: 'not authorized to view roles' });
    await create();
    expect(texts(el(), '[data-testid="user-item"] .name')).toEqual(['alice', 'bob']);
    get('mode-roles').click();
    await settle();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain(
      'not authorized to view roles',
    );
    expect(all('role-item')).toHaveLength(0);
  });

  it('Refresh after a failure ends the error and shows the list', async () => {
    fake.fail('admin.users', { code: 'SERVER_ERROR', message: 'not authorized on shop' });
    await create();
    expect(el().querySelector('[role="alert"]')).not.toBeNull();
    fake.respond('admin.users', { users: [BOB] });
    get('refresh').click();
    await settle();
    expect(el().querySelector('[role="alert"]')).toBeNull();
    expect(el().querySelector('[role="status"]')).toBeNull();
    expect(texts(el(), '[data-testid="user-item"] .name')).toEqual(['bob']);
  });

  it('shows the number of authentication restrictions', async () => {
    const restricted = JSON.stringify({
      user: 'dave',
      db: 'shop',
      roles: [],
      authenticationRestrictions: [{ clientSource: ['192.0.2.10'] }],
    });
    fake.respond('admin.users', { users: [restricted] });
    await create();
    const detail = get('user-detail');
    expect(detail.textContent).toContain('1 authentication restriction');
    expect(detail.textContent).not.toContain('Signs in with');
    expect(detail.querySelector('pre')).toBeNull();
  });

  it('an older roles answer arriving last does not replace the newer one', async () => {
    const pending: { builtin: boolean; resolve: (roles: string[]) => void }[] = [];
    fake.handle(
      'admin.roles',
      (p) =>
        new Promise((resolve) =>
          pending.push({ builtin: p.builtin === true, resolve: (roles) => resolve({ roles }) }),
        ),
    );
    await create();
    get('mode-roles').click();
    await settle();
    const box = get<HTMLInputElement>('builtin');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await settle();
    expect(pending.map((p) => p.builtin)).toEqual([false, true]);
    // The newer (built-in) answer first, then the stale one.
    pending[1]?.resolve([CLERK, READ, READER]);
    await settle();
    pending[0]?.resolve([CLERK]);
    await settle();
    expect(texts(el(), '[data-testid="role-item"] .name')).toEqual(['clerk', 'read', 'reader']);
  });

  it('an older failing answer arriving last shows no error', async () => {
    let calls = 0;
    let failFirst!: () => void;
    fake.handle('admin.users', () => {
      calls += 1;
      if (calls === 1) {
        return new Promise((resolve) => {
          failFirst = () => resolve({ error: { code: 'SERVER_ERROR', message: 'stale failure' } });
        });
      }
      return { users: [BOB] };
    });
    await create();
    get('refresh').click();
    await settle();
    expect(texts(el(), '[data-testid="user-item"] .name')).toEqual(['bob']);
    failFirst();
    await settle();
    expect(el().querySelector('[role="alert"]')).toBeNull();
    expect(texts(el(), '[data-testid="user-item"] .name')).toEqual(['bob']);
  });

  it('turning the built-in toggle off again reloads without built-in roles; same value does nothing', async () => {
    await create();
    view.setBuiltin(false);
    await settle();
    expect(rolesParams()).toHaveLength(1);
    view.setBuiltin(true);
    await settle();
    view.setBuiltin(false);
    await settle();
    expect(rolesParams().map((p) => p['builtin'])).toEqual([false, true, false]);
    get('mode-roles').click();
    await settle();
    expect(texts(el(), '[data-testid="role-item"] .name')).toEqual(['clerk', 'reader']);
  });

  it('openRole ignores a role of another database', async () => {
    await create();
    await view.openRole({ role: 'read', db: 'reports' });
    await settle();
    expect(view.mode()).toBe('users');
    expect(view.builtin()).toBe(false);
    expect(rolesParams()).toHaveLength(1);
  });

  it('a link to a listed custom role does not reload the roles', async () => {
    await create();
    await view.openRole({ role: 'reader', db: 'shop' });
    await settle();
    expect(view.builtin()).toBe(false);
    expect(rolesParams()).toHaveLength(1);
    expect(get('role-detail').querySelector('.title')?.textContent).toContain('reader');
  });

  it('a selection that disappears after a refresh falls back to the first entry', async () => {
    await create();
    view.selectUser('bob');
    await settle();
    fake.respond('admin.users', { users: [ALICE] });
    get('refresh').click();
    await settle();
    expect(get('user-detail').querySelector('.title')?.textContent).toContain('alice');
  });

  it('a tab pointing at another database loads it and resets the selection', async () => {
    await create();
    view.selectUser('bob');
    await settle();
    fixture.componentRef.setInput('tab', {
      ...TAB,
      id: usersTabId('p1', 'archive'),
      data: { profileId: 'p1', db: 'archive' },
    });
    await settle();
    expect(fake.requestsFor('admin.users').map((r) => r.params)).toEqual([
      { profileId: 'p1', db: 'shop' },
      { profileId: 'p1', db: 'archive' },
    ]);
    expect(get('user-detail').querySelector('.title')?.textContent).toContain('alice');
  });

  it('reopening the same tab (a new, equal tab object) sends nothing and keeps the selection', async () => {
    await create();
    view.selectUser('bob');
    get('mode-roles').click();
    await settle();
    view.selectRole('reader');
    await settle();
    fixture.componentRef.setInput('tab', { ...TAB, data: { profileId: 'p1', db: 'shop' } });
    await settle();
    expect(fake.requestsFor('admin.users')).toHaveLength(1);
    expect(rolesParams()).toHaveLength(1);
    expect(get('role-detail').querySelector('.title')?.textContent).toContain('reader');
    get('mode-users').click();
    await settle();
    expect(get('user-detail').querySelector('.title')?.textContent).toContain('bob');
  });

  it('a tab pointing at the same database of another profile loads it again', async () => {
    await create();
    fixture.componentRef.setInput('tab', {
      ...TAB,
      id: usersTabId('p2', 'shop'),
      data: { profileId: 'p2', db: 'shop' },
    });
    await settle();
    expect(fake.requestsFor('admin.users').map((r) => r.params)).toEqual([
      { profileId: 'p1', db: 'shop' },
      { profileId: 'p2', db: 'shop' },
    ]);
    expect(rolesParams().map((p) => p['profileId'])).toEqual(['p1', 'p2']);
  });

  it('sends nothing for a tab without a profile or database', async () => {
    await create({ ...TAB, data: { profileId: 'p1' } });
    await create({ ...TAB, data: undefined });
    expect(fake.requestsFor('admin.users')).toHaveLength(0);
    expect(fake.requestsFor('admin.roles')).toHaveLength(0);
  });

  it('cancels pending requests when the tab is destroyed', async () => {
    fake.handle('admin.users', () => new Promise(() => undefined));
    await create();
    const id = fake.requestsFor('admin.users')[0]?.id;
    fixture.destroy();
    expect(fake.cancels).toContain(id);
  });

  describe('changes', () => {
    const type = async (id: string, value: string) => {
      const field = get<HTMLInputElement>(id);
      field.value = value;
      field.dispatchEvent(new Event('input'));
      await settle();
    };
    const click = async (id: string) => {
      get(id).click();
      await settle();
    };
    const sent = (method: Parameters<FakeThicketBridge['requestsFor']>[0]) =>
      fake.requestsFor(method).map((r) => r.params as Record<string, unknown>);

    it('creates a user with a password and roles, then reads the lists again', async () => {
      fake.respond('admin.createUser', {});
      await create();
      await click('create');
      await type('editor-name', 'carl');
      await type('editor-password', 's3cret');
      await type('editor-repeat', 's3cret');
      await type('role-input', 'clerk');
      await click('role-add');
      await type('role-input', 'readAnyDatabase@admin');
      await click('role-add');
      await click('editor-save');
      expect(sent('admin.createUser')).toEqual([
        {
          profileId: 'p1',
          db: 'shop',
          user: 'carl',
          password: 's3cret',
          roles: [
            { role: 'clerk', db: 'shop' },
            { role: 'readAnyDatabase', db: 'admin' },
          ],
        },
      ]);
      expect(fake.requestsFor('admin.users')).toHaveLength(2);
      expect(get('notice').textContent).toContain('User carl created.');
    });

    it('does not save a new user while the passwords differ', async () => {
      await create();
      await click('create');
      await type('editor-name', 'carl');
      await type('editor-password', 'one');
      await type('editor-repeat', 'two');
      await settle();
      expect(get<HTMLButtonElement>('editor-save').disabled).toBe(true);
      expect(get('editor-problem').textContent).toContain('The passwords differ.');
    });

    it('changes a role: privileges in shell syntax replace the old ones', async () => {
      fake.respond('admin.updateRole', {});
      await create();
      await click('mode-roles');
      await click('edit');
      await type(
        'editor-privileges',
        '[{ resource: { db: "shop", collection: "" }, actions: ["find"] }]',
      );
      await click('editor-save');
      const [params] = sent('admin.updateRole');
      expect(params).toMatchObject({ profileId: 'p1', db: 'shop', role: 'clerk' });
      expect(JSON.parse(params?.['privileges'] as string)).toEqual([
        { resource: { db: 'shop', collection: '' }, actions: ['find'] },
      ]);
      expect(params).not.toHaveProperty('roles');
    });

    it('grants and revokes a role of the selected user', async () => {
      fake.respond('admin.grantRoles', {});
      fake.respond('admin.revokeRoles', {});
      await create();
      await type('role-input', 'reader');
      await click('role-add');
      expect(sent('admin.grantRoles')).toEqual([
        {
          profileId: 'p1',
          db: 'shop',
          kind: 'user',
          name: 'alice',
          roles: [{ role: 'reader', db: 'shop' }],
        },
      ]);
      await click('revoke');
      expect(sent('admin.revokeRoles')).toEqual([
        {
          profileId: 'p1',
          db: 'shop',
          kind: 'user',
          name: 'alice',
          roles: [{ role: 'clerk', db: 'shop' }],
        },
      ]);
    });

    it('drops a user only after the confirm dialog', async () => {
      fake.respond('admin.dropUser', {});
      await create();
      const confirm = TestBed.inject(ConfirmService);
      get('drop').click();
      await settle();
      expect(confirm.current()?.operation).toBe('db.getSiblingDB("shop").dropUser("alice")');
      expect(sent('admin.dropUser')).toEqual([]);
      confirm.answer(true);
      await settle();
      expect(sent('admin.dropUser')).toEqual([
        { profileId: 'p1', db: 'shop', user: 'alice', confirmed: true },
      ]);
    });

    it('turns every change off on a read-only connection', async () => {
      TestBed.inject(ProfileSafetyService).set({
        id: 'p1',
        name: 'Local',
        readOnly: true,
        production: false,
      });
      await create();
      expect(get<HTMLButtonElement>('create').disabled).toBe(true);
      expect(get<HTMLButtonElement>('drop').disabled).toBe(true);
      expect(all('grant')).toEqual([]);
      expect(el().textContent).toContain('Read-only');
    });

    it('shows a server refusal and keeps the form open', async () => {
      fake.fail('admin.createUser', {
        code: 'SERVER_ERROR',
        message: 'User "carl@shop" already exists',
      });
      await create();
      await click('create');
      await type('editor-name', 'carl');
      await type('editor-password', 'pw');
      await type('editor-repeat', 'pw');
      await click('editor-save');
      expect(get('editor-error').textContent).toContain('already exists');
      expect(all('principal-editor')).toHaveLength(1);
    });

    it('changing a user selects it after the save and reads both lists again', async () => {
      fake.respond('admin.updateUser', {});
      await create();
      view.selectUser('bob');
      await settle();
      await click('edit');
      expect(el().querySelector('[data-testid="principal-editor"] .title')?.textContent).toContain(
        'Change user bob',
      );
      await type('editor-custom-data', '{ team: "ops" }');
      await click('editor-save');
      expect(sent('admin.updateUser')).toEqual([
        { profileId: 'p1', db: 'shop', user: 'bob', customData: '{"team":"ops"}' },
      ]);
      expect(all('principal-editor')).toHaveLength(0);
      expect(get('notice').textContent).toContain('User bob changed.');
      expect(fake.requestsFor('admin.users')).toHaveLength(2);
      expect(rolesParams()).toHaveLength(2);
      expect(get('user-detail').querySelector('.title')?.textContent).toContain('bob');
    });

    it('Cancel closes the form; switching mode closes it too', async () => {
      await create();
      await click('create');
      expect(get<HTMLButtonElement>('create').disabled).toBe(true);
      await click('editor-cancel');
      expect(all('principal-editor')).toHaveLength(0);
      await click('create');
      await click('mode-roles');
      expect(all('principal-editor')).toHaveLength(0);
      await click('create');
      expect(el().querySelector('[data-testid="principal-editor"] .title')?.textContent).toContain(
        'New role in shop',
      );
    });

    it('built-in roles cannot be changed, dropped or granted to', async () => {
      await create();
      await click('mode-roles');
      view.setBuiltin(true);
      await settle();
      view.selectRole('read');
      await settle();
      const detail = get('role-detail');
      expect(detail.querySelector('[data-testid="edit"]')).toBeNull();
      expect(detail.querySelector('[data-testid="drop"]')).toBeNull();
      expect(detail.querySelector('[data-testid="grant"]')).toBeNull();
      view.edit();
      await view.drop();
      await settle();
      expect(all('principal-editor')).toHaveLength(0);
      expect(fake.requestsFor('admin.dropRole')).toHaveLength(0);
      expect(TestBed.inject(ConfirmService).current()).toBeNull();
    });

    it('grants to and revokes from the selected role with kind "role"', async () => {
      fake.respond('admin.grantRoles', {});
      fake.respond('admin.revokeRoles', {});
      await create();
      await click('mode-roles');
      await type('role-input', 'readAnyDatabase@admin');
      await click('role-add');
      expect(sent('admin.grantRoles')).toEqual([
        {
          profileId: 'p1',
          db: 'shop',
          kind: 'role',
          name: 'clerk',
          roles: [{ role: 'readAnyDatabase', db: 'admin' }],
        },
      ]);
      expect(get('notice').textContent).toContain('Granted readAnyDatabase@admin to clerk.');
      (all('revoke')[0] as HTMLElement).click();
      await settle();
      expect(sent('admin.revokeRoles')[0]).toMatchObject({ kind: 'role', name: 'clerk' });
      expect(get('notice').textContent).toContain('Revoked');
    });

    it('drops a role only after the confirm dialog, also on a non-production connection', async () => {
      fake.respond('admin.dropRole', {});
      await create();
      await click('mode-roles');
      const confirm = TestBed.inject(ConfirmService);
      get('drop').click();
      await settle();
      expect(confirm.current()).toMatchObject({
        operation: 'db.getSiblingDB("shop").dropRole("clerk")',
        destructive: true,
      });
      expect(sent('admin.dropRole')).toEqual([]);
      confirm.answer(true);
      await settle();
      expect(sent('admin.dropRole')).toEqual([
        { profileId: 'p1', db: 'shop', role: 'clerk', confirmed: true },
      ]);
      expect(get('notice').textContent).toContain('Role clerk dropped.');
      expect(rolesParams()).toHaveLength(2);
    });

    it('a cancelled drop sends nothing, shows nothing and reads nothing again', async () => {
      await create();
      const confirm = TestBed.inject(ConfirmService);
      get('drop').click();
      await settle();
      confirm.answer(false);
      await settle();
      expect(fake.requestsFor('admin.dropUser')).toHaveLength(0);
      expect(el().querySelector('[data-testid="notice"]')).toBeNull();
      expect(fake.requestsFor('admin.users')).toHaveLength(1);
      expect(view.busy()).toBe(false);
    });

    it('a failed grant shows the error as an alert and the buttons work again', async () => {
      fake.fail('admin.grantRoles', {
        code: 'SERVER_ERROR',
        message: 'The server refused the command: Could not find role: nope@shop',
      });
      await create();
      await type('role-input', 'nope');
      await click('role-add');
      const notice = get('notice');
      expect(notice.getAttribute('role')).toBe('alert');
      expect(notice.textContent).toContain('Could not find role: nope@shop');
      expect(view.busy()).toBe(false);
      expect(get<HTMLButtonElement>('drop').disabled).toBe(false);
      expect(fake.requestsFor('admin.users')).toHaveLength(1);
    });

    it('a second change while one is pending is ignored', async () => {
      let release!: () => void;
      fake.handle(
        'admin.revokeRoles',
        () => new Promise((resolve) => (release = () => resolve({}))),
      );
      await create();
      const first = view.revoke({ role: 'clerk', db: 'shop' });
      await settle();
      expect(view.busy()).toBe(true);
      expect(get<HTMLButtonElement>('drop').disabled).toBe(true);
      await view.revoke({ role: 'read', db: 'reports' });
      expect(sent('admin.revokeRoles')).toHaveLength(1);
      release();
      await first;
      await settle();
      expect(view.busy()).toBe(false);
    });
  });
});
