import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { ConnStatus, Profile } from '@thicket/contract';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import { WorkspaceService } from '../layout/workspace.service';
import { ConnectionsPage, groupByFolder } from './connections-page';

const profile = (id: string, extra: Partial<Profile> = {}): Profile => ({
  id,
  name: `Profile ${id}`,
  connectionString: 'mongodb://db1.example.test:27017',
  readOnly: false,
  production: false,
  ...extra,
});

describe('groupByFolder', () => {
  it('puts profiles without folder first, then folders by name, profiles by name', () => {
    const groups = groupByFolder([
      profile('1', { name: 'Zulu', folder: 'Zeta' }),
      profile('2', { name: 'Bravo' }),
      profile('3', { name: 'Alpha', folder: 'Zeta' }),
      profile('4', { name: 'Charlie', folder: 'Alpha/EU' }),
      profile('5', { name: 'Alpha' }),
    ]);
    expect(groups.map((g) => [g.folder, g.profiles.map((p) => p.name)])).toEqual([
      ['', ['Alpha', 'Bravo']],
      ['Alpha/EU', ['Charlie']],
      ['Zeta', ['Alpha', 'Zulu']],
    ]);
  });

  it('has no "without folder" group when every profile has a folder', () => {
    const groups = groupByFolder([profile('1', { folder: 'B' }), profile('2', { folder: 'A' })]);
    expect(groups.map((g) => g.folder)).toEqual(['A', 'B']);
  });

  it('is empty for no profiles and does not reorder its input', () => {
    expect(groupByFolder([])).toEqual([]);
    const input = [profile('b', { name: 'B' }), profile('a', { name: 'A' })];
    groupByFolder(input);
    expect(input.map((p) => p.id)).toEqual(['b', 'a']);
  });
});

describe('ConnectionsPage', () => {
  let fake: FakeThicketBridge;
  let fixture: ComponentFixture<ConnectionsPage>;
  let el: HTMLElement;
  let profiles: Profile[];
  let statuses: ConnStatus[];

  beforeEach(() => {
    fake = new FakeThicketBridge();
    profiles = [
      profile('p1', {
        name: 'Orders',
        color: '#1f9d8b',
        connectionString: 'mongodb://alice@db1.example.test:27017,db2.example.test',
        auth: { mechanism: 'SCRAM-SHA-256', username: 'alice', secretMode: 'ask' },
      }),
      profile('p2', {
        name: 'Billing',
        folder: 'Customers/EU',
        connectionString: 'mongodb+srv://cluster0.example.test',
        readOnly: true,
        production: true,
      }),
    ];
    statuses = [];
    fake.handle('profiles.list', () => ({ profiles }));
    fake.handle('conn.status', () => ({ connections: statuses }));
    fake.respond('conn.close', {});
    TestBed.configureTestingModule({
      providers: [
        provideFakeThicket(fake),
        provideRouter([
          { path: 'connections/new', children: [] },
          { path: 'connections/:id', children: [] },
        ]),
      ],
    });
  });

  async function start(): Promise<void> {
    fixture = TestBed.createComponent(ConnectionsPage);
    el = fixture.nativeElement as HTMLElement;
    await settle();
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await fixture.whenStable();
      await new Promise((r) => setTimeout(r));
    }
  }

  const all = (id: string, root: ParentNode = el) => [
    ...root.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`),
  ];
  const item = (name: string): HTMLElement => {
    const found = all('manager-profile').find((n) => n.dataset['name'] === name);
    if (!found) throw new Error(`no profile ${name}`);
    return found;
  };
  const inItem = (name: string, id: string): HTMLButtonElement => {
    const found = item(name).querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
    if (!found) throw new Error(`no ${id} in ${name}`);
    return found;
  };
  async function click(target: HTMLElement): Promise<void> {
    target.click();
    await settle();
  }
  const url = () => TestBed.inject(Router).url;

  it('lists the profiles grouped by folder with address, color and badges', async () => {
    await start();
    expect(all('manager-folder').map((f) => f.dataset['folder'])).toEqual(['', 'Customers/EU']);
    const orders = item('Orders');
    expect(orders.querySelector('.where')?.textContent).toBe(
      'db1.example.test:27017, db2.example.test',
    );
    expect(orders.textContent).not.toContain('alice:');
    expect(orders.classList.contains('has-color')).toBe(true);
    expect(orders.textContent).toContain('asks password');
    const billing = item('Billing');
    expect(billing.querySelector('.where')?.textContent).toBe('cluster0.example.test (SRV)');
    expect(billing.classList.contains('has-color')).toBe(false);
    expect(billing.textContent).toContain('read-only');
    expect(billing.textContent).toContain('production');
    expect(el.querySelector('h2.folder-name')?.textContent).toBe('Customers/EU');
  });

  it('shows the empty state without profiles', async () => {
    profiles = [];
    await start();
    expect(all('manager-empty')).toHaveLength(1);
    expect(all('manager-profile')).toHaveLength(0);
  });

  it('says when the profiles could not be loaded', async () => {
    fake.fail('profiles.list', { code: 'INTERNAL', message: 'store unreadable' });
    await start();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(
      'Connections could not be loaded.',
    );
  });

  it('opens the editor of a profile', async () => {
    await start();
    await click(inItem('Billing', 'manager-edit'));
    expect(url()).toBe('/connections/p2');
  });

  it('duplicates a profile, reloads the list and opens the copy', async () => {
    fake.handle('profiles.duplicate', ({ profileId }) => {
      const copy = profile('p1-copy', { name: 'Orders (copy)' });
      expect(profileId).toBe('p1');
      profiles = [...profiles, copy];
      return { profile: copy };
    });
    await start();
    await click(inItem('Orders', 'manager-duplicate'));
    expect(fake.requestsFor('profiles.duplicate')[0]?.params).toEqual({ profileId: 'p1' });
    expect(url()).toBe('/connections/p1-copy');
    expect(all('manager-profile').map((n) => n.dataset['name'])).toContain('Orders (copy)');
  });

  it('shows a failed duplicate and stays on the page', async () => {
    fake.fail('profiles.duplicate', { code: 'INTERNAL', message: 'disk full (fictitious)' });
    await start();
    await click(inItem('Orders', 'manager-duplicate'));
    expect(all('manager-error')[0]?.textContent).toContain('disk full (fictitious)');
    expect(url()).toBe('/');
    expect(inItem('Orders', 'manager-duplicate').disabled).toBe(false);
  });

  it('asks before deleting; Keep sends nothing', async () => {
    fake.respond('profiles.delete', {});
    await start();
    await click(inItem('Orders', 'manager-delete'));
    expect(item('Orders').textContent).toContain('Delete with its saved password?');
    // Only the asked profile shows the confirmation.
    expect(all('manager-delete-confirm')).toHaveLength(1);
    const keep = [...item('Orders').querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Keep',
    );
    if (!keep) throw new Error('no Keep button');
    await click(keep);
    expect(all('manager-delete-confirm')).toHaveLength(0);
    expect(fake.requestsFor('profiles.delete')).toHaveLength(0);
  });

  it('deletes a disconnected profile without closing a connection', async () => {
    fake.handle('profiles.delete', ({ profileId }) => {
      profiles = profiles.filter((p) => p.id !== profileId);
      return {};
    });
    await start();
    await click(inItem('Orders', 'manager-delete'));
    await click(inItem('Orders', 'manager-delete-confirm'));
    expect(fake.requestsFor('profiles.delete')[0]?.params).toEqual({ profileId: 'p1' });
    expect(fake.requestsFor('conn.close')).toHaveLength(0);
    expect(all('manager-profile').map((n) => n.dataset['name'])).toEqual(['Billing']);
  });

  it('closes the connection and the tabs of a deleted profile, other tabs stay', async () => {
    statuses = [{ profileId: 'p1', state: 'connected' }];
    fake.handle('profiles.delete', ({ profileId }) => {
      profiles = profiles.filter((p) => p.id !== profileId);
      return {};
    });
    const workspace = TestBed.inject(WorkspaceService);
    workspace.open({ id: 't1', kind: 'collection', title: 'orders', data: { profileId: 'p1' } });
    workspace.open({ id: 't2', kind: 'shell', title: 'Shell', data: { profileId: 'p2' } });
    workspace.open({ id: 't3', kind: 'admin', title: 'Ops' });
    await start();
    await click(inItem('Orders', 'manager-delete'));
    await click(inItem('Orders', 'manager-delete-confirm'));
    expect(fake.requestsFor('conn.close')[0]?.params).toEqual({ profileId: 'p1' });
    expect(workspace.tabs().map((t) => t.id)).toEqual(['t2', 't3']);
    expect(all('manager-profile').map((n) => n.dataset['name'])).toEqual(['Billing']);
  });

  it('still deletes when closing the connection fails', async () => {
    statuses = [{ profileId: 'p1', state: 'connected' }];
    fake.fail('conn.close', { code: 'INTERNAL', message: 'already gone' });
    fake.respond('profiles.delete', {});
    await start();
    await click(inItem('Orders', 'manager-delete'));
    await click(inItem('Orders', 'manager-delete-confirm'));
    expect(fake.requestsFor('profiles.delete')).toHaveLength(1);
    expect(all('manager-error')).toHaveLength(0);
  });

  it('shows a failed delete, keeps the profile and its tabs', async () => {
    fake.fail('profiles.delete', { code: 'INTERNAL', message: 'locked (fictitious)' });
    const workspace = TestBed.inject(WorkspaceService);
    workspace.open({ id: 't1', kind: 'collection', title: 'orders', data: { profileId: 'p1' } });
    await start();
    await click(inItem('Orders', 'manager-delete'));
    await click(inItem('Orders', 'manager-delete-confirm'));
    expect(all('manager-error')[0]?.textContent).toContain('locked (fictitious)');
    expect(workspace.tabs().map((t) => t.id)).toEqual(['t1']);
    expect(all('manager-profile').map((n) => n.dataset['name'])).toContain('Orders');
    // The confirmation stays so the user can retry.
    expect(inItem('Orders', 'manager-delete-confirm').disabled).toBe(false);
  });

  it('ignores a second action while one is running', async () => {
    let release: (() => void) | undefined;
    fake.handle(
      'profiles.duplicate',
      () =>
        new Promise((resolve) => {
          release = () => resolve({ profile: profile('copy') });
        }),
    );
    await start();
    await click(inItem('Orders', 'manager-duplicate'));
    expect(inItem('Billing', 'manager-duplicate').disabled).toBe(true);
    inItem('Billing', 'manager-duplicate').click();
    await settle();
    expect(fake.requestsFor('profiles.duplicate')).toHaveLength(1);
    release?.();
    await settle();
    expect(url()).toBe('/connections/copy');
  });
});
