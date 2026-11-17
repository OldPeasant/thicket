import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../../../api/testing';
import { ConfirmService } from '../../../safety/confirm.service';
import { ProfileSafetyService } from '../../../safety/profile-safety.service';
import { toRoleEntry, toUserEntry } from '../users-roles.model';
import { PrincipalEditor, type EditorSubject } from './principal-editor';

// Fictitious users, roles and passwords: never real data.
const PW = 'fictitious-Pw-5d0f';

const ALICE = toUserEntry(
  JSON.stringify({
    user: 'alice',
    db: 'shop',
    customData: { team: 'sales', level: { $numberInt: '3' } },
    roles: [
      { role: 'clerk', db: 'shop' },
      { role: 'read', db: 'reports' },
    ],
  }),
);
const BOB = toUserEntry(
  JSON.stringify({ user: 'bob', db: 'shop', roles: [{ role: 'reader', db: 'shop' }] }),
);
const CLERK = toRoleEntry(
  JSON.stringify({
    role: 'clerk',
    db: 'shop',
    isBuiltin: false,
    roles: [{ role: 'reader', db: 'shop' }],
    privileges: [
      { resource: { db: 'shop', collection: 'orders' }, actions: ['insert', 'update'] },
      { resource: { cluster: true }, actions: ['serverStatus'] },
    ],
  }),
);

describe('PrincipalEditor', () => {
  let fake: FakeThicketBridge;
  let fixture: ComponentFixture<PrincipalEditor>;
  let savedNames: string[];
  let closed: number;

  const el = () => fixture.nativeElement as HTMLElement;
  const query = (id: string) => el().querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const get = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const found = el().querySelector<T>(`[data-testid="${id}"]`);
    if (found === null) throw new Error(`no element ${id}`);
    return found;
  };
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
  };
  const type = async (id: string, value: string) => {
    const field = get<HTMLInputElement | HTMLTextAreaElement>(id);
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
  const removeRole = async (label: string) => {
    const button = el().querySelector<HTMLElement>(`[aria-label="Remove ${label}"]`);
    if (button === null) throw new Error(`no role ${label}`);
    button.click();
    await settle();
  };
  const addRole = async (text: string) => {
    await type('role-input', text);
    await click('role-add');
  };
  const chips = () =>
    [...el().querySelectorAll('[data-testid="editor-roles"] .chip .mono')].map((e) =>
      e.textContent?.trim(),
    );

  async function create(subject: EditorSubject, db = 'shop', profileId = 'p1') {
    fixture = TestBed.createComponent(PrincipalEditor);
    fixture.componentRef.setInput('profileId', profileId);
    fixture.componentRef.setInput('db', db);
    fixture.componentRef.setInput('subject', subject);
    fixture.componentRef.setInput('known', ['clerk', 'reader']);
    fixture.componentInstance.saved.subscribe((name) => savedNames.push(name));
    fixture.componentInstance.closed.subscribe(() => (closed += 1));
    await settle();
  }

  beforeEach(() => {
    savedNames = [];
    closed = 0;
    fake = new FakeThicketBridge();
    for (const method of [
      'admin.createUser',
      'admin.updateUser',
      'admin.createRole',
      'admin.updateRole',
    ] as const) {
      fake.respond(method, {});
    }
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideFakeThicket(fake)],
    });
  });

  describe('change a user', () => {
    it('shows the current roles and custom data, and no name field', async () => {
      await create({ kind: 'user', entry: ALICE });
      expect(el().querySelector('.title')?.textContent).toContain('Change user alice');
      expect(query('editor-name')).toBeNull();
      expect(chips()).toEqual(['clerk', 'read@reports']);
      expect(get<HTMLTextAreaElement>('editor-custom-data').value).toBe(ALICE.customData);
      expect(get('editor-save').textContent).toContain('Save changes');
    });

    it('saving without a change sends nothing and closes', async () => {
      await create({ kind: 'user', entry: ALICE });
      await click('editor-save');
      expect(fake.requests).toHaveLength(0);
      expect(closed).toBe(1);
      expect(savedNames).toEqual([]);
    });

    it('removing and adding the same role again is no change', async () => {
      await create({ kind: 'user', entry: ALICE });
      await removeRole('clerk');
      expect(chips()).toEqual(['read@reports']);
      await addRole('clerk');
      expect(chips()).toEqual(['read@reports', 'clerk']);
      await click('editor-save');
      expect(fake.requests).toHaveLength(0);
      expect(closed).toBe(1);
    });

    it('only custom data changed: sends only customData', async () => {
      await create({ kind: 'user', entry: ALICE });
      await type('editor-custom-data', '{ team: "ops" }');
      await click('editor-save');
      expect(sent('admin.updateUser')).toEqual([
        { profileId: 'p1', db: 'shop', user: 'alice', customData: '{"team":"ops"}' },
      ]);
      expect(savedNames).toEqual(['alice']);
    });

    it('custom data reformatted with surrounding blanks only is no change', async () => {
      await create({ kind: 'user', entry: ALICE });
      await type('editor-custom-data', `\n${ALICE.customData ?? ''}\n  `);
      await click('editor-save');
      expect(fake.requests).toHaveLength(0);
    });

    it('emptying custom data sends {}', async () => {
      await create({ kind: 'user', entry: ALICE });
      await type('editor-custom-data', '');
      await click('editor-save');
      expect(sent('admin.updateUser')).toEqual([
        { profileId: 'p1', db: 'shop', user: 'alice', customData: '{}' },
      ]);
    });

    it('only roles changed: sends the whole new role list, not custom data or a password', async () => {
      await create({ kind: 'user', entry: ALICE });
      await removeRole('read@reports');
      await addRole('readAnyDatabase@admin');
      await click('editor-save');
      expect(sent('admin.updateUser')).toEqual([
        {
          profileId: 'p1',
          db: 'shop',
          user: 'alice',
          roles: [
            { role: 'clerk', db: 'shop' },
            { role: 'readAnyDatabase', db: 'admin' },
          ],
        },
      ]);
    });

    it('a new password typed twice sends only the password', async () => {
      await create({ kind: 'user', entry: BOB });
      expect(get<HTMLInputElement>('editor-password').placeholder).toContain('Leave empty');
      await type('editor-password', PW);
      await type('editor-repeat', PW);
      await click('editor-save');
      expect(sent('admin.updateUser')).toEqual([
        { profileId: 'p1', db: 'shop', user: 'bob', password: PW },
      ]);
    });

    it('a new password that differs from the repeat is not saved', async () => {
      await create({ kind: 'user', entry: BOB });
      await type('editor-password', PW);
      expect(get('editor-problem').textContent).toContain('The passwords differ.');
      expect(get<HTMLButtonElement>('editor-save').disabled).toBe(true);
      await fixture.componentInstance.save();
      expect(fake.requests).toHaveLength(0);
    });

    it('invalid custom data blocks saving with the reason', async () => {
      await create({ kind: 'user', entry: ALICE });
      await type('editor-custom-data', '[1, 2]');
      expect(get('editor-problem').textContent).toContain('Custom data: Custom data is a document');
      expect(get<HTMLButtonElement>('editor-save').disabled).toBe(true);
      await type('editor-custom-data', '{ team: ');
      expect(get('editor-problem').textContent).toMatch(/^\s*Custom data: /);
    });

    it('a $external user has no password fields; roles can change', async () => {
      const external = toUserEntry(JSON.stringify({ user: 'CN=carl', db: '$external', roles: [] }));
      await create({ kind: 'user', entry: external }, '$external');
      expect(query('editor-password')).toBeNull();
      expect(query('editor-repeat')).toBeNull();
      expect(el().textContent).toContain('they have no password here');
      await addRole('read@shop');
      await click('editor-save');
      expect(sent('admin.updateUser')).toEqual([
        {
          profileId: 'p1',
          db: '$external',
          user: 'CN=carl',
          roles: [{ role: 'read', db: 'shop' }],
        },
      ]);
    });
  });

  describe('new user', () => {
    it('needs a name and a password before it can be saved', async () => {
      await create({ kind: 'user', entry: null });
      expect(el().querySelector('.title')?.textContent).toContain('New user in shop');
      expect(get('editor-problem').textContent).toContain('Name the user.');
      await type('editor-name', '  ');
      expect(get('editor-problem').textContent).toContain('Name the user.');
      await type('editor-name', 'carl');
      expect(get('editor-problem').textContent).toContain('Type a password.');
      expect(get<HTMLButtonElement>('editor-save').disabled).toBe(true);
    });

    it('sends the trimmed name, password, roles and custom data', async () => {
      await create({ kind: 'user', entry: null });
      await type('editor-name', '  carl ');
      await type('editor-password', PW);
      await type('editor-repeat', PW);
      await addRole('clerk');
      await type('editor-custom-data', '{ team: "sales" }');
      expect(get('editor-save').textContent).toContain('Create user');
      await click('editor-save');
      expect(sent('admin.createUser')).toEqual([
        {
          profileId: 'p1',
          db: 'shop',
          user: 'carl',
          password: PW,
          roles: [{ role: 'clerk', db: 'shop' }],
          customData: '{"team":"sales"}',
        },
      ]);
      expect(savedNames).toEqual(['carl']);
    });

    it('a new user without roles or custom data sends an empty role list and no customData', async () => {
      await create({ kind: 'user', entry: null });
      await type('editor-name', 'carl');
      await type('editor-password', PW);
      await type('editor-repeat', PW);
      await click('editor-save');
      expect(sent('admin.createUser')).toEqual([
        { profileId: 'p1', db: 'shop', user: 'carl', password: PW, roles: [] },
      ]);
    });

    it('a new $external user needs no password and sends none', async () => {
      await create({ kind: 'user', entry: null }, '$external');
      await type('editor-name', 'CN=dana');
      expect(query('editor-problem')).toBeNull();
      await click('editor-save');
      expect(sent('admin.createUser')).toEqual([
        { profileId: 'p1', db: '$external', user: 'CN=dana', roles: [] },
      ]);
    });

    it('a role typed wrongly shows why and adds nothing', async () => {
      await create({ kind: 'user', entry: null });
      await addRole('@admin');
      expect(el().querySelector('.role-input [role="alert"]')?.textContent).toContain(
        'The role name is missing before "@"',
      );
      expect(chips()).toEqual([]);
      await type('role-input', 'clerk');
      expect(el().querySelector('.role-input [role="alert"]')).toBeNull();
    });

    it('suggests admin roles for a user; a role outside admin gets only its own database roles', async () => {
      const suggestions = () =>
        [...el().querySelectorAll('datalist option')].map((o) => o.getAttribute('value'));
      await create({ kind: 'user', entry: null });
      expect(suggestions()).toContain('readAnyDatabase@admin');
      fixture.destroy();
      await create({ kind: 'role', entry: null });
      expect(suggestions()).toContain('clerk');
      expect(suggestions().some((s) => s?.includes('@'))).toBe(false);
      fixture.destroy();
      await create({ kind: 'role', entry: null }, 'admin');
      expect(suggestions()).toContain('readAnyDatabase');
    });

    it('a role added twice is listed once', async () => {
      await create({ kind: 'user', entry: null });
      await addRole('clerk');
      await addRole('clerk@shop');
      expect(chips()).toEqual(['clerk']);
    });

    it('Enter in the role field adds the role and does not submit the form', async () => {
      await create({ kind: 'user', entry: null });
      await type('editor-name', 'carl');
      await type('editor-password', PW);
      await type('editor-repeat', PW);
      await type('role-input', 'readAnyDatabase@admin');
      get('role-input').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
      await settle();
      expect(chips()).toEqual(['readAnyDatabase@admin']);
      expect(get<HTMLInputElement>('role-input').value).toBe('');
      expect(fake.requests).toHaveLength(0);
    });

    it('the password is hidden in the confirm dialog on a production connection', async () => {
      TestBed.inject(ProfileSafetyService).set({
        id: 'p1',
        name: 'Production',
        readOnly: false,
        production: true,
      });
      const confirm = TestBed.inject(ConfirmService);
      await create({ kind: 'user', entry: null });
      await type('editor-name', 'carl');
      await type('editor-password', PW);
      await type('editor-repeat', PW);
      get('editor-save').click();
      await settle();
      const operation = confirm.current()?.operation ?? '';
      expect(operation).toContain('pwd: "<hidden>"');
      expect(operation).not.toContain(PW);
      expect(fake.requests).toHaveLength(0);
      confirm.answer(true);
      await settle();
      expect(sent('admin.createUser')[0]).toMatchObject({ password: PW, confirmed: true });
    });

    it('a cancelled confirm dialog sends nothing, shows no error and keeps the form', async () => {
      TestBed.inject(ProfileSafetyService).set({
        id: 'p1',
        name: 'Production',
        readOnly: false,
        production: true,
      });
      const confirm = TestBed.inject(ConfirmService);
      await create({ kind: 'user', entry: null });
      await type('editor-name', 'carl');
      await type('editor-password', PW);
      await type('editor-repeat', PW);
      get('editor-save').click();
      await settle();
      confirm.answer(false);
      await settle();
      expect(fake.requests).toHaveLength(0);
      expect(query('editor-error')).toBeNull();
      expect(savedNames).toEqual([]);
      expect(closed).toBe(0);
      expect(get('editor-save').textContent).toContain('Create user');
    });

    it('a server refusal is shown; the form stays open and can be saved again', async () => {
      fake.fail('admin.createUser', {
        code: 'SERVER_ERROR',
        message: 'The server refused the command: User "carl@shop" already exists',
      });
      await create({ kind: 'user', entry: null });
      await type('editor-name', 'carl');
      await type('editor-password', PW);
      await type('editor-repeat', PW);
      await click('editor-save');
      expect(get('editor-error').textContent).toContain('already exists');
      expect(get<HTMLButtonElement>('editor-save').disabled).toBe(false);
      fake.respond('admin.createUser', {});
      await click('editor-save');
      expect(query('editor-error')).toBeNull();
      expect(savedNames).toEqual(['carl']);
    });

    it('a second save while the first is pending sends once', async () => {
      let release!: () => void;
      fake.handle(
        'admin.createUser',
        () => new Promise((resolve) => (release = () => resolve({}))),
      );
      await create({ kind: 'user', entry: null });
      await type('editor-name', 'carl');
      await type('editor-password', PW);
      await type('editor-repeat', PW);
      get('editor-save').click();
      await settle();
      expect(get('editor-save').textContent).toContain('Saving…');
      await fixture.componentInstance.save();
      expect(sent('admin.createUser')).toHaveLength(1);
      release();
      await settle();
      expect(savedNames).toEqual(['carl']);
    });

    it('is turned off on a read-only connection', async () => {
      TestBed.inject(ProfileSafetyService).set({
        id: 'p1',
        name: 'Reporting',
        readOnly: true,
        production: false,
      });
      await create({ kind: 'user', entry: null });
      await type('editor-name', 'carl');
      await type('editor-password', PW);
      await type('editor-repeat', PW);
      expect(get<HTMLButtonElement>('editor-save').disabled).toBe(true);
    });
  });

  describe('roles', () => {
    it('a new role sends its name, privileges as EJSON and parent roles', async () => {
      await create({ kind: 'role', entry: null });
      expect(el().querySelector('.title')?.textContent).toContain('New role in shop');
      expect(query('editor-password')).toBeNull();
      expect(query('editor-custom-data')).toBeNull();
      expect(get('editor-problem').textContent).toContain('Name the role.');
      await type('editor-name', 'auditor');
      await type(
        'editor-privileges',
        '[{ resource: { db: "shop", collection: "" }, actions: ["find"] }]',
      );
      await addRole('reader');
      await click('editor-save');
      const [params] = sent('admin.createRole');
      expect(params).toMatchObject({
        profileId: 'p1',
        db: 'shop',
        role: 'auditor',
        roles: [{ role: 'reader', db: 'shop' }],
      });
      expect(JSON.parse(params?.['privileges'] as string)).toEqual([
        { resource: { db: 'shop', collection: '' }, actions: ['find'] },
      ]);
      expect(savedNames).toEqual(['auditor']);
    });

    it('a new role with empty privileges sends []', async () => {
      await create({ kind: 'role', entry: null });
      await type('editor-name', 'empty');
      await type('editor-privileges', '');
      await click('editor-save');
      expect(sent('admin.createRole')).toEqual([
        { profileId: 'p1', db: 'shop', role: 'empty', privileges: '[]', roles: [] },
      ]);
    });

    it('invalid privileges block saving with the reason', async () => {
      await create({ kind: 'role', entry: null });
      await type('editor-name', 'auditor');
      await type('editor-privileges', '[{ actions: ["find"] }]');
      expect(get('editor-problem').textContent).toContain(
        'Privileges: Privilege 1 needs a resource',
      );
      expect(get<HTMLButtonElement>('editor-save').disabled).toBe(true);
    });

    it('changing a role shows its privileges; unchanged privileges send nothing', async () => {
      await create({ kind: 'role', entry: CLERK });
      expect(el().querySelector('.title')?.textContent).toContain('Change role clerk');
      expect(get<HTMLTextAreaElement>('editor-privileges').value).toBe(CLERK.privilegesSource);
      expect(chips()).toEqual(['reader']);
      await click('editor-save');
      expect(fake.requests).toHaveLength(0);
      expect(closed).toBe(1);
    });

    it('the same privileges typed differently (one line) are no change', async () => {
      await create({ kind: 'role', entry: CLERK });
      await type(
        'editor-privileges',
        '[{resource:{db:"shop",collection:"orders"},actions:["insert","update"]},' +
          '{resource:{cluster:true},actions:["serverStatus"]}]',
      );
      await click('editor-save');
      expect(fake.requests).toHaveLength(0);
    });

    it('only roles changed: sends roles, not privileges', async () => {
      await create({ kind: 'role', entry: CLERK });
      await removeRole('reader');
      await click('editor-save');
      expect(sent('admin.updateRole')).toEqual([
        { profileId: 'p1', db: 'shop', role: 'clerk', roles: [] },
      ]);
    });

    it('only privileges changed: sends privileges, not roles', async () => {
      await create({ kind: 'role', entry: CLERK });
      await type('editor-privileges', '[]');
      await click('editor-save');
      expect(sent('admin.updateRole')).toEqual([
        { profileId: 'p1', db: 'shop', role: 'clerk', privileges: '[]' },
      ]);
      expect(savedNames).toEqual(['clerk']);
    });
  });

  it('Cancel emits closed and sends nothing', async () => {
    await create({ kind: 'user', entry: ALICE });
    await type('editor-custom-data', '{ team: "ops" }');
    await click('editor-cancel');
    expect(closed).toBe(1);
    expect(fake.requests).toHaveLength(0);
  });

  it('a new subject resets the form', async () => {
    await create({ kind: 'user', entry: null });
    await type('editor-name', 'carl');
    await type('editor-password', PW);
    await addRole('clerk');
    fixture.componentRef.setInput('subject', { kind: 'user', entry: BOB });
    await settle();
    expect(query('editor-name')).toBeNull();
    expect(get<HTMLInputElement>('editor-password').value).toBe('');
    expect(chips()).toEqual(['reader']);
    expect(get<HTMLTextAreaElement>('editor-custom-data').value).toBe('');
    fixture.componentRef.setInput('subject', { kind: 'role', entry: CLERK });
    await settle();
    expect(get<HTMLTextAreaElement>('editor-privileges').value).toBe(CLERK.privilegesSource);
  });
});
