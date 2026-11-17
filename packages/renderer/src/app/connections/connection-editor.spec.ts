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

  describe('review fixes', () => {
    const SECRET = 'fictitious-Pr0xy';

    it('secret URI options are masked, never saved, and the editor says they were not stored', async () => {
      await start();
      await input(must('field-name'), 'Proxied');
      await click('tab-uri');
      await input(
        must('field-uri'),
        `mongodb://dave@db.example:27017/?proxyHost=socks.example&proxyPassword=${SECRET}` +
          `&tlsCertificateKeyFile=%2Fk.pem&tlsCertificateKeyFilePassword=${SECRET}` +
          `&authMechanismProperties=AWS_SESSION_TOKEN:${SECRET}`,
      );
      await click('tab-form');
      expect(text('uri-preview')).not.toContain(SECRET);
      expect(text('dropped-secrets')).toContain('proxyPassword');
      expect(text('dropped-secrets')).toContain('tlsCertificateKeyFilePassword');
      expect(text('dropped-secrets')).toContain('AWS_SESSION_TOKEN');
      await click('tab-uri');
      expect(must<HTMLTextAreaElement>('field-uri').value).not.toContain(SECRET);

      await click('save');
      expect(JSON.stringify(savedDraft())).not.toContain(SECRET);
      await click('test-connection');
      expect(JSON.stringify(fake.requestsFor('conn.test'))).not.toContain(SECRET);
    });

    it('the ready editor has a level-1 page heading', async () => {
      await start('p1');
      expect(must('page-heading').tagName).toBe('H1');
      expect(text('page-heading')).toBe('Edit connection');
    });

    it('a failed setSecret keeps the new profile: a retry updates it instead of creating another', async () => {
      fake.fail('profiles.setSecret', {
        code: 'INTERNAL',
        message: 'keychain locked (fictitious)',
      });
      await start();
      await input(must('field-name'), 'Fresh');
      await change(must<HTMLSelectElement>('field-mechanism'), 'SCRAM-SHA-256');
      await input(must('field-username'), 'fay');
      await input(must('field-password'), 'typed-pw');
      await check('secret-saved');
      await click('save');

      expect(text('save-error')).toContain('Saved, but the password could not be stored');
      expect(text('save-error')).toContain('keychain locked (fictitious)');
      expect(text('page-heading')).toBe('Edit connection');
      expect(must<HTMLInputElement>('field-password').value).toBe('typed-pw');
      expect(fake.requestsFor('profiles.list').length).toBeGreaterThan(1);
      expect(TestBed.inject(Router).url).not.toBe('/connections/new-id');

      fake.respond('profiles.setSecret', { secureStorage: true });
      await click('save');
      const saves = fake.requestsFor('profiles.save');
      expect(saves).toHaveLength(2);
      expect(savedDraft().id).toBe('new-id');
      expect(fake.requestsFor('profiles.setSecret').map((r) => r.params)).toEqual([
        { profileId: 'new-id', kind: 'password', value: 'typed-pw' },
        { profileId: 'new-id', kind: 'password', value: 'typed-pw' },
      ]);
      expect(el.querySelector('[data-testid="save-error"]')).toBeNull();
      expect(TestBed.inject(Router).url).toBe('/connections/new-id');
    });

    it('switching to another profile while Save runs shows the new profile, not the saved one', async () => {
      fake.handle('profiles.get', ({ profileId }) => ({
        profile: saved({ id: profileId, name: `Name ${profileId}` }),
        storedSecrets: [],
      }));
      let release: (() => void) | undefined;
      fake.handle(
        'profiles.save',
        ({ profile }) =>
          new Promise((resolve) => {
            release = () => resolve({ profile: { ...profile, id: profile.id ?? 'x' } });
          }),
      );
      await start('p1');
      await input(must('field-name'), 'Renamed p1');
      await click('save');
      fixture.componentRef.setInput('id', 'p2');
      await settle();
      expect(must<HTMLInputElement>('field-name').value).toBe('Name p2');
      release?.();
      await settle();
      expect(must<HTMLInputElement>('field-name').value).toBe('Name p2');
      expect(el.querySelector('[data-testid="saved-notice"]')).toBeNull();
      expect(el.querySelector('[data-testid="save-error"]')).toBeNull();
      expect(must<HTMLButtonElement>('save').disabled).toBe(false);
    });

    it('a Save that fails after switching to another profile shows no error on the new one', async () => {
      fake.handle('profiles.get', ({ profileId }) => ({
        profile: saved({ id: profileId, name: `Name ${profileId}` }),
        storedSecrets: [],
      }));
      let release: (() => void) | undefined;
      fake.handle(
        'profiles.save',
        () =>
          new Promise((resolve) => {
            release = () =>
              resolve({ error: { code: 'INTERNAL', message: 'store locked (fictitious)' } });
          }),
      );
      await start('p1');
      await click('save');
      fixture.componentRef.setInput('id', 'p2');
      await settle();
      release?.();
      await settle();
      expect(must<HTMLInputElement>('field-name').value).toBe('Name p2');
      expect(el.querySelector('[data-testid="save-error"]')).toBeNull();
      expect(must<HTMLButtonElement>('save').disabled).toBe(false);
    });

    it('a failed setSecret on an existing profile stays on its page; a retry stores the password', async () => {
      fake.fail('profiles.setSecret', {
        code: 'INTERNAL',
        message: 'keychain locked (fictitious)',
      });
      await start('p1');
      const router = TestBed.inject(Router);
      const urlBefore = router.url;
      await input(must('field-password'), 'rotated-pw');
      await click('save');
      expect(text('save-error')).toContain('Saved, but the password could not be stored');
      expect(el.querySelector('[data-testid="saved-notice"]')).toBeNull();
      expect(must<HTMLInputElement>('field-password').value).toBe('rotated-pw');

      fake.respond('profiles.setSecret', { secureStorage: true });
      await click('save');
      expect(
        fake
          .requestsFor('profiles.save')
          .map((r) => (r.params as { profile: ProfileDraft }).profile.id),
      ).toEqual(['p1', 'p1']);
      expect(fake.requestsFor('profiles.setSecret').map((r) => r.params)).toEqual([
        { profileId: 'p1', kind: 'password', value: 'rotated-pw' },
        { profileId: 'p1', kind: 'password', value: 'rotated-pw' },
      ]);
      expect(el.querySelector('[data-testid="save-error"]')).toBeNull();
      expect(must('saved-notice')).toBeTruthy();
      expect(must<HTMLInputElement>('field-password').value).toBe('');
      expect(router.url).toBe(urlBefore);
    });

    for (const outcome of ['succeeds', 'fails'] as const) {
      it(`a password store that ${outcome} after switching profiles leaves the new profile alone`, async () => {
        fake.handle('profiles.get', ({ profileId }) => ({
          profile: saved({ id: profileId, name: `Name ${profileId}` }),
          storedSecrets: [],
        }));
        let release: (() => void) | undefined;
        fake.handle(
          'profiles.setSecret',
          () =>
            new Promise((resolve) => {
              release = () =>
                resolve(
                  outcome === 'succeeds'
                    ? { secureStorage: true }
                    : { error: { code: 'INTERNAL', message: 'keychain locked (fictitious)' } },
                );
            }),
        );
        await start('p1');
        await input(must('field-password'), 'rotated-pw');
        await click('save');
        expect(release).toBeDefined();
        fixture.componentRef.setInput('id', 'p2');
        await settle();
        release?.();
        await settle();
        expect(must<HTMLInputElement>('field-name').value).toBe('Name p2');
        expect(must<HTMLInputElement>('field-password').value).toBe('');
        // p2 has no stored password: the p1 store must not mark one as saved.
        expect(must<HTMLInputElement>('field-password').placeholder).not.toContain('Saved');
        expect(el.querySelector('[data-testid="save-error"]')).toBeNull();
        expect(el.querySelector('[data-testid="saved-notice"]')).toBeNull();
        expect(must<HTMLButtonElement>('save').disabled).toBe(false);
      });
    }

    it('edits made while the password is being stored are kept when Save finishes', async () => {
      let release: (() => void) | undefined;
      fake.handle(
        'profiles.setSecret',
        () =>
          new Promise((resolve) => {
            release = () => resolve({ secureStorage: true });
          }),
      );
      await start('p1');
      await input(must('field-password'), 'rotated-pw');
      await click('save');
      expect(release).toBeDefined();
      await input(must('field-name'), 'Edited meanwhile');
      release?.();
      await settle();
      expect(must<HTMLInputElement>('field-name').value).toBe('Edited meanwhile');
      expect(savedDraft().name).toBe('Orders');
      expect(fake.requestsFor('profiles.setSecret').map((r) => r.params)).toEqual([
        { profileId: 'p1', kind: 'password', value: 'rotated-pw' },
      ]);
      expect(el.querySelector('[data-testid="save-error"]')).toBeNull();
      // The newer edits are not saved, so the editor does not say "Saved.".
      expect(el.querySelector('[data-testid="saved-notice"]')).toBeNull();
    });

    it('leaving a new profile while Save runs does not navigate back to it', async () => {
      let release: (() => void) | undefined;
      fake.handle(
        'profiles.save',
        ({ profile }) =>
          new Promise((resolve) => {
            release = () => resolve({ profile: { ...profile, id: 'new-id' } });
          }),
      );
      await start();
      await input(must('field-name'), 'Fresh');
      await click('save');
      expect(release).toBeDefined();
      const router = TestBed.inject(Router);
      await router.navigateByUrl('/connections/elsewhere');
      fixture.destroy();
      const listsBefore = fake.requestsFor('profiles.list').length;
      release?.();
      for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r));
      expect(router.url).toBe('/connections/elsewhere');
      // The sidebar still learns about the saved profile.
      expect(fake.requestsFor('profiles.list').length).toBeGreaterThan(listsBefore);
    });

    it('leaving a new profile while its password is stored keeps the store but stays on the new page', async () => {
      let release: (() => void) | undefined;
      fake.handle(
        'profiles.setSecret',
        () =>
          new Promise((resolve) => {
            release = () => resolve({ secureStorage: true });
          }),
      );
      await start();
      await input(must('field-name'), 'Fresh');
      await change(must<HTMLSelectElement>('field-mechanism'), 'SCRAM-SHA-256');
      await input(must('field-username'), 'fay');
      await input(must('field-password'), 'typed-pw');
      await check('secret-saved');
      await click('save');
      // profiles.save has answered; the password store is still running.
      expect(release).toBeDefined();
      const router = TestBed.inject(Router);
      await router.navigateByUrl('/connections/elsewhere');
      fixture.destroy();
      release?.();
      for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r));
      expect(router.url).toBe('/connections/elsewhere');
      // The password of the saved profile is still stored for it, exactly once.
      expect(fake.requestsFor('profiles.setSecret').map((r) => r.params)).toEqual([
        { profileId: 'new-id', kind: 'password', value: 'typed-pw' },
      ]);
    });

    it('a new profile saved without edits during the store navigates to its page with the Saved notice state', async () => {
      await start();
      await input(must('field-name'), 'Fresh');
      const router = TestBed.inject(Router);
      await click('save');
      expect(router.url).toBe('/connections/new-id');
      // The next editor instance reads this state to show "Saved.".
      expect(router.lastSuccessfulNavigation()?.extras.state).toEqual({
        thicketProfileSaved: true,
      });
    });

    it('a saved profile holding a secret option loads without it and says it is not stored', async () => {
      stored = saved({
        connectionString:
          'mongodb://alice@db1.example:27017/?authMechanism=SCRAM-SHA-256' +
          `&proxyHost=socks.example&proxyPassword=${SECRET}`,
      });
      await start('p1');
      expect(text('dropped-secrets')).toContain('proxyPassword');
      expect(text('uri-preview')).not.toContain(SECRET);
      expect(text('uri-preview')).toContain('proxyHost=socks.example');
      await click('tab-uri');
      expect(must<HTMLTextAreaElement>('field-uri').value).not.toContain(SECRET);

      await click('save');
      expect(JSON.stringify(savedDraft())).not.toContain(SECRET);
      // The note stays after saving: the secret is gone from the profile now.
      expect(text('dropped-secrets')).toContain('proxyPassword');

      await input(
        must('field-uri'),
        'mongodb://alice@db1.example:27017/?authMechanism=SCRAM-SHA-256',
      );
      await click('tab-form');
      expect(el.querySelector('[data-testid="dropped-secrets"]')).toBeNull();
    });
  });

  describe('M2: SSH, client certificate, proxy, tags and write concern', () => {
    const SECRET = 'fictitious-ssh-Pa55';

    it('saves an SSH tunnel with its password stored as the sshPassword secret', async () => {
      await start();
      await input(must('field-name'), 'Tunnelled');
      await change(must<HTMLSelectElement>('field-mechanism'), 'NONE');
      expect(el.querySelector('[data-testid="ssh-fields"]')).toBeNull();
      await check('field-ssh');
      await change(must('field-ssh-host'), 'bastion.example');
      await change(must('field-ssh-username'), 'jumper');
      expect(text('route')).toContain('SSH jumper@bastion.example');
      await input(must('field-secret-sshPassword'), SECRET);
      // SSH is not a connection string option.
      expect(text('uri-preview')).not.toContain('bastion');
      expect(text('uri-preview')).not.toContain(SECRET);

      await click('save');
      expect(savedDraft().ssh).toEqual({
        host: 'bastion.example',
        port: 22,
        username: 'jumper',
        method: 'password',
      });
      expect(JSON.stringify(savedDraft())).not.toContain(SECRET);
      const secrets = fake.requestsFor('profiles.setSecret').map((r) => r.params);
      expect(secrets).toEqual([{ profileId: 'new-id', kind: 'sshPassword', value: SECRET }]);
    });

    it('shows SSH field problems and the key file chooser fills the key file', async () => {
      fake.respond('profiles.chooseFile', { path: '/fictitious/id_ed25519' });
      await start();
      await input(must('field-name'), 'Keys');
      await check('field-ssh');
      await click('ssh-method-privateKey');
      await click('save');
      expect(text('problems')).toContain('Enter the SSH server.');
      expect(text('problems')).toContain('Enter the SSH user name.');
      expect(text('problems')).toContain('Choose the SSH private key file.');
      expect(fake.requestsFor('profiles.save')).toHaveLength(0);

      await click('choose-ssh-key');
      expect(fake.requestsFor('profiles.chooseFile')[0]?.params).toEqual({
        purpose: 'sshPrivateKeyFile',
      });
      expect(must<HTMLInputElement>('field-ssh-key-file').value).toBe('/fictitious/id_ed25519');
      expect(text('problems')).not.toContain('private key file');
    });

    it('refuses SSH together with a proxy', async () => {
      await start();
      await input(must('field-name'), 'Both');
      await check('field-ssh');
      await change(must('field-ssh-host'), 'bastion.example');
      await change(must('field-ssh-username'), 'jumper');
      await change(must('field-proxy-host'), 'socks.example');
      await click('save');
      expect(text('problems')).toContain('Use either an SSH tunnel or a SOCKS5 proxy, not both.');
    });

    it('loads a saved SSH profile and shows the saved secret as saved', async () => {
      stored = saved({
        ssh: { host: 'bastion.example', port: 2222, username: 'jumper', method: 'password' },
      });
      fake.handle('profiles.get', () => ({
        profile: stored,
        storedSecrets: ['password', 'sshPassword'],
      }));
      await start('p1');
      expect(must<HTMLInputElement>('field-ssh').checked).toBe(true);
      expect(must<HTMLInputElement>('field-ssh-port').value).toBe('2222');
      expect(must<HTMLInputElement>('field-secret-sshPassword').placeholder).toBe(
        'Saved; type to replace it',
      );
      await check('field-ssh', false);
      await click('save');
      expect(savedDraft().ssh).toBeUndefined();
    });

    it('proxy fields go into the URI; the proxy password is stored, never in the URI', async () => {
      await start();
      await input(must('field-name'), 'Proxied');
      await change(must('field-proxy-host'), 'socks.example');
      await change(must('field-proxy-port'), '1081');
      await change(must('field-proxy-username'), 'pat');
      await input(must('field-secret-proxyPassword'), SECRET);
      const uri = text('uri-preview');
      expect(uri).toContain('proxyHost=socks.example');
      expect(uri).toContain('proxyPort=1081');
      expect(uri).toContain('proxyUsername=pat');
      expect(uri).not.toContain(SECRET);
      await click('save');
      expect(savedDraft().proxy).toEqual({ host: 'socks.example', port: 1081, username: 'pat' });
      expect(fake.requestsFor('profiles.setSecret').map((r) => r.params)).toEqual([
        { profileId: 'new-id', kind: 'proxyPassword', value: SECRET },
      ]);
    });

    it('X.509: client certificate, key file and passphrase; URI follows', async () => {
      fake.handle('profiles.chooseFile', ({ purpose }) => ({
        path: purpose === 'tlsCertificateKeyFile' ? '/fictitious/client.pem' : null,
      }));
      await start();
      await input(must('field-name'), 'Cert');
      await change(must<HTMLSelectElement>('field-mechanism'), 'MONGODB-X509');
      expect(el.querySelector('[data-testid="field-auth-source"]')).toBeNull();
      expect(el.querySelector('[data-testid="field-password"]')).toBeNull();
      await click('save');
      expect(text('problems')).toContain(
        'X.509 authentication needs TLS and a client certificate file.',
      );
      await check('field-tls');
      await click('choose-cert');
      expect(must<HTMLInputElement>('field-cert-file').value).toBe('/fictitious/client.pem');
      expect(text('uri-preview')).toContain('authMechanism=MONGODB-X509');
      expect(text('uri-preview')).toContain('tlsCertificateKeyFile=');
      await change(must('field-key-file'), '/fictitious/client.key');
      await input(must('field-secret-tlsKeyPassphrase'), SECRET);
      expect(text('uri-preview')).not.toContain(SECRET);
      await click('save');
      expect(savedDraft().tls).toEqual({
        enabled: true,
        certificateKeyFile: '/fictitious/client.pem',
        keyFile: '/fictitious/client.key',
      });
      expect(savedDraft().auth).toEqual({ mechanism: 'MONGODB-X509', secretMode: 'none' });
      expect(fake.requestsFor('profiles.setSecret').map((r) => r.params)).toEqual([
        { profileId: 'new-id', kind: 'tlsKeyPassphrase', value: SECRET },
      ]);
    });

    it('a key file without a client certificate cannot be saved (CR-2)', async () => {
      await start();
      await input(must('field-name'), 'Key only');
      await check('field-tls');
      await change(must('field-cert-file'), '/fictitious/client.crt');
      await change(must('field-key-file'), '/fictitious/client.key');
      await change(must('field-cert-file'), '');
      await click('save');
      expect(text('problems')).toContain(
        'A private key file needs the client certificate file it belongs to.',
      );
      expect(fake.requestsFor('profiles.save')).toHaveLength(0);
    });

    it('tag sets: edited in the form, synced to the URI, refused with primary (CR-3)', async () => {
      await start();
      await input(must('field-name'), 'Tags');
      await click('add-tag-set');
      await change(nth('field-tag-set', 0), 'dc:east, rack:1');
      await click('add-tag-set');
      await click('save');
      expect(text('problems')).toContain(
        'Read preference tags need a read preference other than Primary.',
      );
      await change(must<HTMLSelectElement>('field-read-preference'), 'nearest');
      expect(text('uri-preview')).toMatch(/readPreferenceTags=dc(:|%3A)east(,|%2C)rack(:|%3A)1/);
      await click('save');
      expect(savedDraft().readPreference).toBe('nearest');
      expect(savedDraft().readPreferenceTags).toEqual([
        [
          { name: 'dc', value: 'east' },
          { name: 'rack', value: '1' },
        ],
        [],
      ]);

      // URI → form
      await click('tab-uri');
      await input(
        must('field-uri'),
        'mongodb://db1.example/?readPreference=secondary&readPreferenceTags=dc:west',
      );
      await click('tab-form');
      expect(all('field-tag-set').map((i) => i.value)).toEqual(['dc:west']);
      await click('remove-tag-set');
      expect(all('field-tag-set')).toHaveLength(0);
      expect(text('uri-preview')).not.toContain('readPreferenceTags');
    });

    it('write concern fields sync both ways', async () => {
      await start();
      await input(must('field-name'), 'WC');
      await change(must('field-w'), 'majority');
      await change(must<HTMLSelectElement>('field-journal'), 'true');
      await change(must('field-wtimeout'), '2500');
      for (const part of ['w=majority', 'journal=true', 'wtimeoutMS=2500']) {
        expect(text('uri-preview')).toContain(part);
      }
      await change(must('field-w'), '2');
      await click('save');
      expect(savedDraft().writeConcern).toEqual({ w: 2, journal: true, wtimeoutMS: 2500 });

      await click('tab-uri');
      await input(must('field-uri'), 'mongodb://db1.example/?w=1&journal=false');
      await click('tab-form');
      expect(must<HTMLInputElement>('field-w').value).toBe('1');
      expect(must<HTMLSelectElement>('field-journal').value).toBe('false');
      expect(must<HTMLInputElement>('field-wtimeout').value).toBe('');
    });

    it('copies the connection string with the password masked', async () => {
      const copied: string[] = [];
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: (t: string) => (copied.push(t), Promise.resolve()) },
      });
      await start();
      await change(must<HTMLSelectElement>('field-mechanism'), 'SCRAM-SHA-256');
      await input(must('field-username'), 'alice');
      await input(must('field-password'), SECRET);
      await click('copy-uri');
      expect(copied).toEqual(['mongodb://alice:****@localhost:27017/?authMechanism=SCRAM-SHA-256']);
      expect(text('copy-state')).toBe('Copied, with the password masked.');
      await input(must('field-username'), 'bob');
      expect(el.querySelector('[data-testid="copy-state"]')).toBeNull();
    });
  });

  describe('M2 gaps (test-writer)', () => {
    const SSH_PW = 'fictitious-ssh-pw';
    const KEY_PW = 'fictitious-key-pw';
    const PROXY_PW = 'fictitious-proxy-pw';
    const setSecretCalls = () => fake.requestsFor('profiles.setSecret').map((r) => r.params);

    async function sshPasswordTunnel(): Promise<void> {
      await check('field-ssh');
      await change(must('field-ssh-host'), 'bastion.example');
      await change(must('field-ssh-username'), 'jumper');
    }

    it('one of several secrets fails: the others are stored, the failed one is kept for a retry', async () => {
      fake.handle('profiles.setSecret', ({ kind }) =>
        kind === 'sshPassword'
          ? { error: { code: 'INTERNAL', message: 'keychain locked (fictitious)' } }
          : { secureStorage: true },
      );
      await start();
      await input(must('field-name'), 'Two secrets');
      await sshPasswordTunnel();
      await input(must('field-secret-sshPassword'), SSH_PW);
      await check('field-tls');
      await change(must('field-cert-file'), '/fictitious/client.pem');
      await input(must('field-secret-tlsKeyPassphrase'), KEY_PW);
      await click('save');

      expect(setSecretCalls()).toEqual([
        { profileId: 'new-id', kind: 'sshPassword', value: SSH_PW },
        { profileId: 'new-id', kind: 'tlsKeyPassphrase', value: KEY_PW },
      ]);
      expect(text('save-error')).toContain('Saved, but the SSH password could not be stored');
      expect(text('save-error')).toContain('keychain locked (fictitious)');
      expect(text('save-error')).not.toContain('client key passphrase');
      expect(el.querySelector('[data-testid="saved-notice"]')).toBeNull();
      // The typed SSH password stays for the retry; the stored passphrase now shows as saved.
      expect(must<HTMLInputElement>('field-secret-sshPassword').value).toBe(SSH_PW);
      expect(must<HTMLInputElement>('field-secret-tlsKeyPassphrase').placeholder).toBe(
        'Saved; type to replace it',
      );
      expect(must<HTMLInputElement>('field-secret-sshPassword').placeholder).toBe('none');
      expect(TestBed.inject(Router).url).not.toBe('/connections/new-id');

      fake.respond('profiles.setSecret', { secureStorage: true });
      await click('save');
      expect(savedDraft().id).toBe('new-id');
      expect(fake.requestsFor('profiles.save')).toHaveLength(2);
      expect(setSecretCalls().slice(2)).toContainEqual({
        profileId: 'new-id',
        kind: 'sshPassword',
        value: SSH_PW,
      });
      expect(el.querySelector('[data-testid="save-error"]')).toBeNull();
      expect(TestBed.inject(Router).url).toBe('/connections/new-id');
    });

    it('a failed database password store stops before the other secrets are stored', async () => {
      fake.handle('profiles.setSecret', ({ kind }) =>
        kind === 'password'
          ? { error: { code: 'INTERNAL', message: 'keychain locked (fictitious)' } }
          : { secureStorage: true },
      );
      stored = saved({
        ssh: { host: 'bastion.example', port: 22, username: 'jumper', method: 'password' },
      });
      await start('p1');
      await input(must('field-password'), 'fictitious-db-pw');
      await input(must('field-secret-sshPassword'), SSH_PW);
      await click('save');
      expect(text('save-error')).toContain('Saved, but the password could not be stored');
      expect(setSecretCalls().map((p) => (p as { kind: string }).kind)).toEqual(['password']);
      expect(must<HTMLInputElement>('field-secret-sshPassword').value).toBe(SSH_PW);
    });

    it('secrets typed for settings that are no longer used are not stored', async () => {
      await start();
      await input(must('field-name'), 'Changed my mind');
      await sshPasswordTunnel();
      await input(must('field-secret-sshPassword'), SSH_PW);
      // Switching to the SSH agent hides the password field and drops it from the save.
      await click('ssh-method-agent');
      expect(el.querySelector('[data-testid="field-secret-sshPassword"]')).toBeNull();
      await check('field-ssh', false);
      await change(must('field-proxy-host'), 'socks.example');
      await change(must('field-proxy-username'), 'pat');
      await input(must('field-secret-proxyPassword'), PROXY_PW);
      // Without a proxy user there is no proxy password.
      await change(must('field-proxy-username'), ' ');
      expect(el.querySelector('[data-testid="field-secret-proxyPassword"]')).toBeNull();
      await click('save');
      expect(savedDraft().proxy).toEqual({ host: 'socks.example', port: 1080 });
      expect(savedDraft().ssh).toBeUndefined();
      expect(setSecretCalls()).toEqual([]);
      expect(JSON.stringify(savedDraft())).not.toContain(SSH_PW);
      expect(JSON.stringify(savedDraft())).not.toContain(PROXY_PW);
    });

    it('a saved secret that is not retyped is not stored again; the field shows it as saved', async () => {
      stored = saved({
        connectionString:
          'mongodb://alice@db1.example:27017/?authMechanism=SCRAM-SHA-256' +
          '&proxyHost=socks.example&proxyUsername=pat',
      });
      fake.handle('profiles.get', () => ({
        profile: stored,
        storedSecrets: ['password', 'proxyPassword'],
      }));
      await start('p1');
      expect(must<HTMLInputElement>('field-secret-proxyPassword').placeholder).toBe(
        'Saved; type to replace it',
      );
      await click('save');
      expect(setSecretCalls()).toEqual([]);
      expect(text('saved-notice')).toBe('Saved.');
    });

    it('an SSH key passphrase is stored as sshKeyPassphrase together with the key file', async () => {
      await start();
      await input(must('field-name'), 'Key tunnel');
      await sshPasswordTunnel();
      await click('ssh-method-privateKey');
      await change(must('field-ssh-key-file'), '/fictitious/id_ed25519');
      await input(must('field-secret-sshKeyPassphrase'), KEY_PW);
      await click('save');
      expect(savedDraft().ssh).toEqual({
        host: 'bastion.example',
        port: 22,
        username: 'jumper',
        method: 'privateKey',
        privateKeyFile: '/fictitious/id_ed25519',
      });
      expect(setSecretCalls()).toEqual([
        { profileId: 'new-id', kind: 'sshKeyPassphrase', value: KEY_PW },
      ]);
    });

    it('SSH port: a trimmed number is saved; text, 0 and 65536 are refused', async () => {
      await start();
      await input(must('field-name'), 'Port');
      await sshPasswordTunnel();
      const problem = 'The SSH port is a whole number from 1 to 65535.';
      for (const bad of ['abc', '0', '65536', '22.5']) {
        await change(must('field-ssh-port'), bad);
        await click('save');
        expect(text('problems'), bad).toContain(problem);
      }
      expect(fake.requestsFor('profiles.save')).toHaveLength(0);
      await change(must('field-ssh-port'), ' 2222 ');
      expect(el.querySelector('[data-testid="problems"]')?.textContent ?? '').not.toContain(
        problem,
      );
      await click('save');
      expect(savedDraft().ssh?.port).toBe(2222);
    });

    it('the route shows the proxy hop and the SRV target', async () => {
      await start();
      expect(el.querySelector('[data-testid="route"]')).toBeNull();
      await change(nth('field-host', 0), 'cluster0.example.net');
      await check('field-scheme-srv');
      await change(must('field-proxy-host'), 'socks.example');
      expect(text('route')).toContain('SOCKS5 socks.example');
      expect(text('route')).toContain('cluster0.example.net (SRV)');
      await change(must('field-proxy-host'), '');
      expect(el.querySelector('[data-testid="route"]')).toBeNull();
    });

    it('the proxy port: empty uses 1080, an invalid one is refused', async () => {
      await start();
      await input(must('field-name'), 'Proxy port');
      await change(must('field-proxy-host'), 'socks.example');
      await change(must('field-proxy-port'), 'many');
      await click('save');
      expect(text('problems')).toContain('The proxy port is a whole number from 1 to 65535.');
      await change(must('field-proxy-port'), '');
      expect(text('uri-preview')).not.toContain('proxyPort');
      await click('save');
      expect(savedDraft().proxy).toEqual({ host: 'socks.example', port: 1080 });
    });

    it('a proxy user without a proxy host is refused', async () => {
      await start();
      await input(must('field-name'), 'User only');
      await change(must('field-proxy-host'), 'socks.example');
      await change(must('field-proxy-username'), 'pat');
      await change(must('field-proxy-host'), '');
      // The user field stays visible so it can be removed.
      expect(must<HTMLInputElement>('field-proxy-username').value).toBe('pat');
      await click('save');
      expect(text('problems')).toContain('Enter the proxy host, or remove the proxy user name.');
      expect(fake.requestsFor('profiles.save')).toHaveLength(0);
    });

    it('tag sets: editing and removing the middle one keeps the others in order', async () => {
      await start();
      await input(must('field-name'), 'Tags');
      await change(must<HTMLSelectElement>('field-read-preference'), 'secondary');
      for (const [i, set] of ['dc:east', 'dc:west', 'rack:1'].entries()) {
        await click('add-tag-set');
        await change(nth('field-tag-set', i), set);
      }
      await change(nth('field-tag-set', 1), 'dc:west, ssd');
      expect(all('field-tag-set').map((i) => i.value)).toEqual([
        'dc:east',
        'dc:west, ssd:',
        'rack:1',
      ]);
      const removes = all<HTMLButtonElement>('remove-tag-set');
      expect(removes[1]?.getAttribute('aria-label')).toBe('Remove tag set 2');
      removes[1]?.click();
      await settle();
      expect(all('field-tag-set').map((i) => i.value)).toEqual(['dc:east', 'rack:1']);
      await click('save');
      expect(savedDraft().readPreferenceTags).toEqual([
        [{ name: 'dc', value: 'east' }],
        [{ name: 'rack', value: '1' }],
      ]);
    });

    it('a tag without a name is refused in the form', async () => {
      await start();
      await input(must('field-name'), 'Nameless tag');
      await change(must<HTMLSelectElement>('field-read-preference'), 'nearest');
      await click('add-tag-set');
      await change(nth('field-tag-set', 0), ':east');
      await click('save');
      expect(text('problems')).toContain('Every read preference tag needs a name (name:value).');
      expect(fake.requestsFor('profiles.save')).toHaveLength(0);
    });

    it('removing every tag set lets a primary read preference be saved again', async () => {
      await start();
      await input(must('field-name'), 'No tags');
      await click('add-tag-set');
      await change(nth('field-tag-set', 0), 'dc:east');
      await click('save');
      expect(text('problems')).toContain('need a read preference other than Primary');
      await click('remove-tag-set');
      expect(el.querySelector('[data-testid="tag-sets"]')).toBeNull();
      await click('save');
      expect(savedDraft()).not.toHaveProperty('readPreferenceTags');
    });

    it('write concern: invalid timeouts and empty fields are left out', async () => {
      await start();
      await input(must('field-name'), 'WC');
      await change(must('field-w'), 'majority');
      await change(must<HTMLSelectElement>('field-journal'), 'false');
      await change(must('field-wtimeout'), '100');
      expect(text('uri-preview')).toContain('journal=false');
      for (const bad of ['-5', '1.5', 'soon']) {
        await change(must('field-wtimeout'), bad);
        expect(text('uri-preview'), bad).not.toContain('wtimeoutMS');
      }
      await change(must('field-w'), '  ');
      await change(must<HTMLSelectElement>('field-journal'), '');
      expect(text('uri-preview')).not.toMatch(/[?&](w|journal|wtimeoutMS)=/);
      await click('save');
      expect(savedDraft().writeConcern ?? {}).toEqual({});
    });

    it('the private key file chooser fills the separate key file', async () => {
      fake.handle('profiles.chooseFile', () => ({ path: '/fictitious/client.key' }));
      await start();
      await check('field-tls');
      await change(must('field-cert-file'), '/fictitious/client.crt');
      await click('choose-key');
      expect(fake.requestsFor('profiles.chooseFile')[0]?.params).toEqual({
        purpose: 'tlsCertificateKeyFile',
      });
      expect(must<HTMLInputElement>('field-key-file').value).toBe('/fictitious/client.key');
      await change(must('field-key-file'), ' ');
      expect(must<HTMLInputElement>('field-key-file').value).toBe('');
    });

    it('a failed certificate or SSH key chooser is reported and keeps the field', async () => {
      fake.fail('profiles.chooseFile', { code: 'INTERNAL', message: 'dialog failed (fictitious)' });
      await start();
      await check('field-tls');
      await click('choose-cert');
      expect(text('save-error')).toContain('dialog failed (fictitious)');
      expect(must<HTMLInputElement>('field-cert-file').value).toBe('');
      fake.respond('profiles.chooseFile', { path: null });
      await sshPasswordTunnel();
      await click('ssh-method-privateKey');
      await click('choose-ssh-key');
      expect(must<HTMLInputElement>('field-ssh-key-file').value).toBe('');
    });

    it('an SSH password store that finishes after switching profiles leaves the new profile alone', async () => {
      const sshProfile = (id: string) =>
        saved({
          id,
          name: `Name ${id}`,
          ssh: { host: 'bastion.example', port: 22, username: 'jumper', method: 'password' },
        });
      fake.handle('profiles.get', ({ profileId }) => ({
        profile: sshProfile(profileId),
        storedSecrets: [],
      }));
      let release: (() => void) | undefined;
      fake.handle(
        'profiles.setSecret',
        () =>
          new Promise((resolve) => {
            release = () => resolve({ secureStorage: true });
          }),
      );
      await start('p1');
      await input(must('field-secret-sshPassword'), SSH_PW);
      await click('save');
      expect(release).toBeDefined();
      fixture.componentRef.setInput('id', 'p2');
      await settle();
      release?.();
      await settle();
      expect(must<HTMLInputElement>('field-name').value).toBe('Name p2');
      // p2 has no stored SSH password: the p1 store must not mark one as saved.
      expect(must<HTMLInputElement>('field-secret-sshPassword').placeholder).toBe('none');
      expect(must<HTMLInputElement>('field-secret-sshPassword').value).toBe('');
      expect(el.querySelector('[data-testid="saved-notice"]')).toBeNull();
      expect(el.querySelector('[data-testid="save-error"]')).toBeNull();
    });

    it('turning TLS off hides the key passphrase and does not store it', async () => {
      await start();
      await input(must('field-name'), 'TLS off');
      await check('field-tls');
      await change(must('field-cert-file'), '/fictitious/client.pem');
      await input(must('field-secret-tlsKeyPassphrase'), KEY_PW);
      await check('field-tls', false);
      expect(el.querySelector('[data-testid="field-secret-tlsKeyPassphrase"]')).toBeNull();
      await click('save');
      expect(setSecretCalls()).toEqual([]);
    });

    it('secret fields are disabled when no encryption is available', async () => {
      storage = { level: 'unavailable', backend: 'basic_text', defaultSecretMode: 'ask' };
      await start();
      await sshPasswordTunnel();
      expect(must<HTMLInputElement>('field-secret-sshPassword').disabled).toBe(true);
    });

    it('a failed copy says so; copying from the connection-string tab works too', async () => {
      const copied: string[] = [];
      let fail = true;
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: (t: string) =>
            fail ? Promise.reject(new Error('denied')) : (copied.push(t), Promise.resolve()),
        },
      });
      await start();
      await click('copy-uri');
      expect(text('copy-state')).toBe('The connection string could not be copied.');
      expect(text('copy-uri')).toBe('Copy');
      fail = false;
      await click('tab-uri');
      await click('copy-uri');
      expect(copied).toEqual(['mongodb://localhost:27017']);
      expect(text('copy-state')).toBe('Copied, with the password masked.');
      expect(text('copy-uri')).toBe('Copied');
    });

    it('copy is disabled while the connection string cannot be written', async () => {
      await start();
      expect(must<HTMLButtonElement>('copy-uri').disabled).toBe(false);
      await change(nth('field-host', 0), '');
      expect(must('uri-preview').classList).toContain('invalid');
      expect(must<HTMLButtonElement>('copy-uri').disabled).toBe(true);
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
