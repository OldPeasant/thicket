import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { Profile, ProfileDraft, SecretStorageStatus } from '@thicket/contract';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import { ConnectionEditor } from './connection-editor';

const SECURE: SecretStorageStatus = {
  level: 'secure',
  backend: 'gnome_libsecret',
  defaultSecretMode: 'saved',
};

const saved = (extra: Partial<Profile> = {}): Profile => ({
  id: 'p1',
  name: 'Orders',
  connectionString: 'mongodb://alice@db1.example:27017/?authMechanism=SCRAM-SHA-256',
  auth: { mechanism: 'SCRAM-SHA-256', username: 'alice', secretMode: 'saved' },
  readOnly: false,
  production: false,
  ...extra,
});

describe('ConnectionEditor', () => {
  let fake: FakeThicketBridge;
  let fixture: ComponentFixture<ConnectionEditor>;
  let el: HTMLElement;
  let storage: SecretStorageStatus;
  let stored: Profile;

  beforeEach(() => {
    fake = new FakeThicketBridge();
    storage = SECURE;
    stored = saved();
    fake.handle('profiles.secretStorage', () => storage);
    fake.handle('profiles.get', () => ({ profile: stored, storedSecrets: ['password'] }));
    fake.respond('profiles.list', { profiles: [] });
    fake.respond('conn.status', { connections: [] });
    fake.handle('profiles.save', ({ profile }) => ({
      profile: { ...profile, id: profile.id ?? 'new-id' },
    }));
    fake.respond('profiles.setSecret', { secureStorage: true });
    TestBed.configureTestingModule({
      providers: [
        provideFakeThicket(fake),
        provideRouter([{ path: 'connections/:id', children: [] }]),
      ],
    });
  });

  async function start(id?: string): Promise<void> {
    fixture = TestBed.createComponent(ConnectionEditor);
    if (id !== undefined) fixture.componentRef.setInput('id', id);
    el = fixture.nativeElement as HTMLElement;
    await settle();
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await fixture.whenStable();
      await new Promise((r) => setTimeout(r));
    }
  }

  const must = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const found = el.querySelector<T>(`[data-testid="${id}"]`);
    if (!found) throw new Error(`no ${id}`);
    return found;
  };
  const all = <T extends HTMLElement = HTMLInputElement>(id: string): T[] => [
    ...el.querySelectorAll<T>(`[data-testid="${id}"]`),
  ];
  const nth = (id: string, index: number): HTMLInputElement => {
    const found = all(id)[index];
    if (!found) throw new Error(`no ${id} #${String(index)}`);
    return found;
  };
  const text = (id: string) => must(id).textContent?.trim() ?? '';

  async function input(target: HTMLInputElement | HTMLTextAreaElement, value: string) {
    target.value = value;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
  }
  async function change(target: HTMLInputElement | HTMLSelectElement, value?: string) {
    if (value !== undefined) target.value = value;
    target.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
  }
  async function check(id: string, on = true) {
    const box = must<HTMLInputElement>(id);
    box.checked = on;
    await change(box);
  }
  async function click(id: string) {
    must(id).click();
    await settle();
  }
  const savedDraft = (): ProfileDraft => {
    const requests = fake.requestsFor('profiles.save');
    const last = requests[requests.length - 1];
    if (!last) throw new Error('profiles.save was not sent');
    return (last.params as { profile: ProfileDraft }).profile;
  };

  describe('form ⇄ connection string', () => {
    it('shows the connection string of the form fields and updates it on every edit', async () => {
      await start();
      expect(text('uri-preview')).toBe('mongodb://localhost:27017');

      await change(nth('field-host', 0), 'db1.example');
      await change(nth('field-port', 0), '27018');
      await click('add-host');
      await change(nth('field-host', 1), 'db2.example');
      await change(must('field-replica-set'), 'rs0');
      expect(text('uri-preview')).toBe(
        'mongodb://db1.example:27018,db2.example:27017/?replicaSet=rs0',
      );

      await change(must<HTMLSelectElement>('field-mechanism'), 'SCRAM-SHA-1');
      await input(must('field-username'), 'bob');
      await change(must('field-auth-source'), 'admin');
      await check('field-tls');
      await check('field-allow-invalid-hostnames');
      await change(must<HTMLSelectElement>('field-read-preference'), 'secondaryPreferred');
      await change(must('field-app-name'), 'Reports');
      await change(must('field-connect-timeout'), '5000');
      const uri = text('uri-preview');
      expect(uri).toMatch(/^mongodb:\/\/bob@db1\.example:27018,db2\.example:27017\/\?/);
      for (const part of [
        'replicaSet=rs0',
        'authSource=admin',
        'authMechanism=SCRAM-SHA-1',
        'tls=true',
        'tlsAllowInvalidHostnames=true',
        'readPreference=secondaryPreferred',
        'appName=Reports',
        'connectTimeoutMS=5000',
      ]) {
        expect(uri).toContain(part);
      }
      expect(must('tls-insecure').textContent).toContain('not fully checked');
    });

    it('switching to SRV keeps one host without port', async () => {
      await start();
      await change(nth('field-host', 0), 'cluster0.example.net');
      await check('field-scheme-srv');
      expect(text('uri-preview')).toBe('mongodb+srv://cluster0.example.net');
      expect(all('field-port')).toHaveLength(0);
      expect(must<HTMLInputElement>('field-tls').checked).toBe(true);
    });

    it('the connection-string tab shows the form state and edits the form', async () => {
      await start();
      await change(nth('field-host', 0), 'db1.example');
      await click('tab-uri');
      const area = must<HTMLTextAreaElement>('field-uri');
      expect(area.value).toBe('mongodb://db1.example:27017');

      await input(
        area,
        'mongodb://carol@h1:27020,h2:27021/?replicaSet=rs1&authSource=admin&tls=true&appName=X',
      );
      expect(el.querySelector('[data-testid="uri-error"]')).toBeNull();
      await click('tab-form');
      expect(all('field-host').map((h) => h.value)).toEqual(['h1', 'h2']);
      expect(all('field-port').map((h) => h.value)).toEqual(['27020', '27021']);
      expect(must<HTMLInputElement>('field-replica-set').value).toBe('rs1');
      expect(must<HTMLSelectElement>('field-mechanism').value).toBe('SCRAM-SHA-256');
      expect(must<HTMLInputElement>('field-username').value).toBe('carol');
      expect(must<HTMLInputElement>('field-auth-source').value).toBe('admin');
      expect(must<HTMLInputElement>('field-tls').checked).toBe(true);
      expect(must<HTMLInputElement>('field-app-name').value).toBe('X');
    });

    it('an invalid connection string is reported and leaves the form as it was', async () => {
      await start();
      await click('tab-uri');
      const area = must<HTMLTextAreaElement>('field-uri');
      await input(area, 'http://nope');
      expect(must('field-uri').getAttribute('aria-invalid')).toBe('true');
      expect(text('uri-error')).not.toBe('');
      await click('tab-form');
      expect(all('field-host').map((h) => h.value)).toEqual(['localhost']);
    });
  });

  describe('password', () => {
    it('is a masked input and shows as **** in the connection string', async () => {
      await start();
      await change(must<HTMLSelectElement>('field-mechanism'), 'SCRAM-SHA-256');
      await input(must('field-username'), 'alice');
      const password = must<HTMLInputElement>('field-password');
      expect(password.type).toBe('password');
      await input(password, 's3cr3t!');
      expect(text('uri-preview')).toBe(
        'mongodb://alice:****@localhost:27017/?authMechanism=SCRAM-SHA-256',
      );
      expect(el.textContent).not.toContain('s3cr3t!');

      await click('toggle-password');
      expect(must<HTMLInputElement>('field-password').type).toBe('text');
      await click('toggle-password');
      expect(must<HTMLInputElement>('field-password').type).toBe('password');

      await click('tab-uri');
      expect(must<HTMLTextAreaElement>('field-uri').value).toContain('alice:****@');
    });

    it('a pasted password moves to the password field and never into the saved profile', async () => {
      await start();
      await input(must('field-name'), 'Pasted');
      await click('tab-uri');
      await input(must('field-uri'), 'mongodb://dave:p%40ss@db.example:27017/');
      await click('tab-form');
      expect(must<HTMLInputElement>('field-password').value).toBe('p@ss');
      expect(text('uri-preview')).toContain('dave:****@');

      // **** in the URI keeps the typed password.
      await click('tab-uri');
      await input(must('field-uri'), 'mongodb://dave:****@db.example:27017/?appName=Y');
      await click('tab-form');
      expect(must<HTMLInputElement>('field-password').value).toBe('p@ss');

      await click('save');
      const draft = savedDraft();
      expect(draft.connectionString).not.toContain('p@ss');
      expect(draft.connectionString).not.toContain('p%40ss');
      expect(draft.connectionString).not.toContain('****');
      expect(draft.auth).toEqual({
        mechanism: 'SCRAM-SHA-256',
        username: 'dave',
        secretMode: 'saved',
      });
      expect(fake.requestsFor('profiles.setSecret').map((r) => r.params)).toEqual([
        { profileId: 'new-id', kind: 'password', value: 'p@ss' },
      ]);
      // A new profile continues on its own page.
      expect(TestBed.inject(Router).url).toBe('/connections/new-id');
    });

    it('ask each time saves no password', async () => {
      await start();
      await input(must('field-name'), 'Asker');
      await change(must<HTMLSelectElement>('field-mechanism'), 'SCRAM-SHA-256');
      await input(must('field-username'), 'eve');
      await input(must('field-password'), 'only-for-test');
      await check('secret-ask');
      expect(must('ask-hint').textContent).toContain('not stored');
      await click('save');
      expect(savedDraft().auth?.secretMode).toBe('ask');
      expect(fake.requestsFor('profiles.setSecret')).toHaveLength(0);
    });

    it('a weak keychain is explained and new profiles default to asking', async () => {
      storage = { level: 'weak', backend: 'basic_text', defaultSecretMode: 'ask' };
      await start();
      await change(must<HTMLSelectElement>('field-mechanism'), 'SCRAM-SHA-256');
      expect(must<HTMLInputElement>('secret-ask').checked).toBe(true);
      expect(text('weak-keychain')).toContain('basic_text');
    });

    it('without encryption the password cannot be saved', async () => {
      storage = { level: 'unavailable', backend: 'basic_text', defaultSecretMode: 'ask' };
      await start();
      await change(must<HTMLSelectElement>('field-mechanism'), 'SCRAM-SHA-256');
      expect(must<HTMLInputElement>('secret-saved').disabled).toBe(true);
      expect(el.querySelector('[data-testid="no-keychain"]')).not.toBeNull();
    });
  });

  describe('saved profiles', () => {
    it('loads the profile, says a password is saved and keeps fields the form does not edit', async () => {
      stored = saved({
        color: '#3b7dd8',
        folder: 'Shop',
        production: true,
        ssh: { host: 'bastion', port: 22, username: 'ops', method: 'agent' },
      });
      await start('p1');
      expect(must<HTMLInputElement>('field-name').value).toBe('Orders');
      expect(must<HTMLInputElement>('field-password').placeholder).toContain('Saved');
      expect(must<HTMLInputElement>('field-production').checked).toBe(true);
      expect(must<HTMLInputElement>('color-blue').checked).toBe(true);

      await check('field-read-only');
      await click('save');
      const draft = savedDraft();
      expect(draft).toMatchObject({
        id: 'p1',
        name: 'Orders',
        color: '#3b7dd8',
        folder: 'Shop',
        readOnly: true,
        production: true,
        ssh: { host: 'bastion', port: 22, username: 'ops', method: 'agent' },
      });
      // No password typed: the saved one stays (no setSecret).
      expect(fake.requestsFor('profiles.setSecret')).toHaveLength(0);
      expect(text('saved-notice')).toBe('Saved.');
    });

    it('Test connection of an unchanged saved profile uses the stored secrets', async () => {
      fake.respond('conn.test', {
        latencyMS: 12,
        server: { version: '8.2.1', topology: 'standalone', enterprise: false, raw: '{}' },
      });
      await start('p1');
      await click('test-connection');
      expect(fake.requestsFor('conn.test').map((r) => r.params)).toEqual([{ profileId: 'p1' }]);
      expect(text('test-ok')).toContain('8.2.1');

      await input(must('field-password'), 'new');
      await click('test-connection');
      const params = fake.requestsFor('conn.test')[1]?.params as {
        profile: ProfileDraft;
        password: string;
      };
      expect(params.password).toBe('new');
      expect(params.profile.id).toBe('p1');
    });

    it('a failed test shows the error code, its explanation and the message', async () => {
      fake.fail('conn.test', {
        code: 'AUTH_FAILED',
        message: 'Authentication failed: bad auth for user alice',
      });
      await start('p1');
      await click('test-connection');
      expect(text('test-error-code')).toBe('AUTH_FAILED');
      expect(text('test-error')).toContain('Check the user name, password');
      expect(text('test-error-message')).toContain('bad auth for user alice');
    });
  });

  describe('more form fields (test-writer)', () => {
    it('color, folder, hosts, direct connection and the CA file end up in the saved draft', async () => {
      fake.respond('profiles.chooseFile', { path: '/fictitious/ca.pem' });
      await start();
      await input(must('field-name'), 'Lab');
      await check('color-violet');
      await input(must('field-folder'), ' Customers / EU ');
      await click('add-host');
      await change(nth('field-host', 1), 'db2.example');
      await click('remove-host');
      expect(all('field-host').map((h) => h.value)).toEqual(['db2.example']);
      // The last host cannot be removed.
      expect(all<HTMLButtonElement>('remove-host').every((b) => b.disabled)).toBe(true);
      await check('field-direct');
      await check('field-tls');
      await click('choose-ca');
      expect(must<HTMLInputElement>('field-ca-file').value).toBe('/fictitious/ca.pem');
      expect(text('uri-preview')).toContain('directConnection=true');
      await click('save');
      expect(savedDraft()).toMatchObject({
        name: 'Lab',
        color: '#8a5cd0',
        folder: 'Customers/EU',
        tls: { enabled: true, caFile: '/fictitious/ca.pem' },
      });
      expect(savedDraft().connectionString).toMatch(/^mongodb:\/\/db2\.example:27017\/\?/);

      await check('color-none');
      await check('field-direct', false);
      await change(must('field-ca-file'), ' ');
      await click('save');
      expect(savedDraft()).not.toHaveProperty('color');
      expect(savedDraft().tls).toEqual({ enabled: true });
      expect(savedDraft().connectionString).not.toContain('directConnection');
    });

    it('clearing fields removes their options again', async () => {
      await start();
      await change(nth('field-host', 0), 'cluster0.example.net');
      await check('field-scheme-srv');
      await check('field-scheme-standard');
      // Back to a host list: the single host gets the default port again.
      expect(text('uri-preview')).toBe('mongodb://cluster0.example.net:27017');
      await change(nth('field-port', 0), ' ');
      expect(text('uri-preview')).toBe('mongodb://cluster0.example.net');

      await check('field-tls');
      await check('field-allow-invalid-certificates');
      expect(text('uri-preview')).toContain('tlsAllowInvalidCertificates=true');
      expect(must('tls-insecure').textContent).toContain('not fully checked');
      await check('field-allow-invalid-certificates', false);
      expect(text('uri-preview')).not.toContain('tlsAllowInvalidCertificates');

      await change(must<HTMLSelectElement>('field-read-preference'), 'nearest');
      await change(must('field-app-name'), 'Reports');
      await change(must<HTMLSelectElement>('field-mechanism'), 'SCRAM-SHA-256');
      await input(must('field-username'), 'alice');
      await change(must('field-auth-source'), 'admin');
      await change(must('field-replica-set'), 'rs0');
      await change(must('field-selection-timeout'), '2500');
      expect(text('uri-preview')).toContain('serverSelectionTimeoutMS=2500');
      await change(must<HTMLSelectElement>('field-read-preference'), '');
      await change(must('field-app-name'), '  ');
      await change(must('field-auth-source'), ' ');
      await change(must('field-replica-set'), '');
      await change(must('field-selection-timeout'), 'soon');
      await input(must('field-username'), '');
      expect(text('uri-preview')).toBe(
        'mongodb://cluster0.example.net/?authMechanism=SCRAM-SHA-256&tls=true',
      );
    });

    it('a cancelled or failed CA file chooser keeps the field', async () => {
      fake.respond('profiles.chooseFile', { path: null });
      await start();
      await check('field-tls');
      await click('choose-ca');
      expect(must<HTMLInputElement>('field-ca-file').value).toBe('');
      fake.fail('profiles.chooseFile', { code: 'INTERNAL', message: 'dialog failed (fictitious)' });
      await click('choose-ca');
      expect(text('save-error')).toContain('dialog failed (fictitious)');
    });

    it('No authentication clears user, password and auth source', async () => {
      await start();
      await change(must<HTMLSelectElement>('field-mechanism'), 'SCRAM-SHA-256');
      await input(must('field-username'), 'alice');
      await change(must('field-auth-source'), 'admin');
      await input(must('field-password'), 'fictitious-pw');
      await change(must<HTMLSelectElement>('field-mechanism'), 'NONE');
      expect(text('uri-preview')).toBe('mongodb://localhost:27017');
      expect(el.querySelector('[data-testid="field-password"]')).toBeNull();
      // Choosing a password mechanism again starts without the old credentials.
      await change(must<HTMLSelectElement>('field-mechanism'), 'SCRAM-SHA-1');
      expect(must<HTMLInputElement>('field-username').value).toBe('');
      expect(must<HTMLInputElement>('field-password').value).toBe('');
      expect(must<HTMLInputElement>('secret-saved').checked).toBe(true);
    });

    it('arrow keys switch between the form and the connection-string tab', async () => {
      await start();
      must('tab-form').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      await settle();
      expect(el.querySelector('[data-testid="field-uri"]')).not.toBeNull();
      must('tab-uri').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
      await settle();
      expect(el.querySelector('[data-testid="field-uri"]')).toBeNull();
      must('tab-form').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      await settle();
      expect(el.querySelector('[data-testid="field-uri"]')).toBeNull();
    });
  });

  describe('test and save errors (test-writer)', () => {
    const TEST_OK = {
      latencyMS: 3,
      server: { version: '8.0.4', topology: 'standalone' as const, enterprise: false, raw: '{}' },
    };

    it('Test connection in ask-each-time mode sends the typed password but never stores it', async () => {
      fake.respond('conn.test', TEST_OK);
      await start();
      await input(must('field-name'), 'Asker');
      await change(must<HTMLSelectElement>('field-mechanism'), 'SCRAM-SHA-256');
      await input(must('field-username'), 'eve');
      await check('secret-ask');
      await input(must('field-password'), 'fictitious-once');
      await click('test-connection');
      const params = fake.requestsFor('conn.test')[0]?.params as {
        profile: ProfileDraft;
        password: string;
      };
      expect(params.password).toBe('fictitious-once');
      expect(JSON.stringify(params.profile)).not.toContain('fictitious-once');
      expect(text('test-ok')).toContain('8.0.4');
      expect(fake.requestsFor('profiles.setSecret')).toHaveLength(0);
    });

    it('Test connection of an edited saved profile sends the draft', async () => {
      fake.respond('conn.test', TEST_OK);
      await start('p1');
      await change(must('field-app-name'), 'Edited');
      await click('test-connection');
      const params = fake.requestsFor('conn.test')[0]?.params as { profile: ProfileDraft };
      expect(params).not.toHaveProperty('password');
      expect(params.profile).toMatchObject({ id: 'p1', appName: 'Edited' });
    });

    it('a running test can be cancelled', async () => {
      fake.handle('conn.test', () => new Promise(() => undefined));
      await start('p1');
      await click('test-connection');
      expect(el.querySelector('[data-testid="test-running"]')).not.toBeNull();
      await click('test-cancel');
      expect(el.querySelector('[data-testid="test-running"]')).toBeNull();
      expect(el.querySelector('[data-testid="test-error"]')).toBeNull();
      expect(fake.cancels).toHaveLength(1);
      expect(must('test-connection')).toBeTruthy();
    });

    it('a CANCELLED answer resets the test without an error', async () => {
      fake.fail('conn.test', { code: 'CANCELLED', message: 'cancelled' });
      await start('p1');
      await click('test-connection');
      expect(el.querySelector('[data-testid="test-error"]')).toBeNull();
      expect(el.querySelector('[data-testid="test-ok"]')).toBeNull();
    });

    it('a failed save is shown and the form stays editable', async () => {
      fake.fail('profiles.save', { code: 'INTERNAL', message: 'store locked (fictitious)' });
      await start('p1');
      await click('save');
      expect(text('save-error')).toContain('store locked (fictitious)');
      expect(el.querySelector('[data-testid="saved-notice"]')).toBeNull();
      expect(must<HTMLButtonElement>('save').disabled).toBe(false);
      expect(fake.requestsFor('profiles.setSecret')).toHaveLength(0);
    });

    it('switching a saved password profile to ask each time no longer says a password is saved', async () => {
      await start('p1');
      expect(must<HTMLInputElement>('field-password').placeholder).toContain('Saved');
      await check('secret-ask');
      await click('save');
      expect(savedDraft().auth?.secretMode).toBe('ask');
      await check('secret-saved');
      expect(must<HTMLInputElement>('field-password').placeholder).not.toContain('Saved');
    });

    it('shows the load error of a profile that cannot be read', async () => {
      fake.fail('profiles.get', { code: 'NOT_FOUND', message: 'no such profile' });
      await start('missing');
      expect(text('editor-load-error')).toContain('could not be loaded');
      expect(text('page-heading')).toBe('Edit connection');
    });

    it('switching to another profile while one loads shows only the latest', async () => {
      let releaseFirst: (() => void) | undefined;
      fake.handle('profiles.get', ({ profileId }) => {
        const profile = saved({ id: profileId, name: `Name ${profileId}` });
        if (profileId === 'slow') {
          return new Promise((resolve) => {
            releaseFirst = () => resolve({ profile, storedSecrets: [] });
          });
        }
        return { profile, storedSecrets: [] };
      });
      await start('slow');
      fixture.componentRef.setInput('id', 'fast');
      await settle();
      expect(must<HTMLInputElement>('field-name').value).toBe('Name fast');
      releaseFirst?.();
      await settle();
      expect(must<HTMLInputElement>('field-name').value).toBe('Name fast');
    });
  });

  it('problems block saving and testing', async () => {
    await start();
    await change(nth('field-host', 0), '');
    await click('save');
    expect(text('problems')).toContain('Enter a name');
    expect(text('problems')).toContain('host name');
    await click('test-connection');
    expect(fake.requestsFor('profiles.save')).toHaveLength(0);
    expect(fake.requestsFor('conn.test')).toHaveLength(0);
  });
});
