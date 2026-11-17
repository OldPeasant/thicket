import { serve, type Port } from '@thicket/backend';
import {
  methods,
  parseResult,
  parseResultIn,
  privilegedMethods,
  route,
  BROADCAST_STREAMS,
  settingsChanged,
  type Event,
  type Response,
  type Settings,
} from '@thicket/contract';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HistoryStore } from '../history';
import { ProfilesStore } from '../profiles';
import { SecretsStore } from '../secrets';
import { FakeSafeStorage } from '../secrets/testing';
import { DEFAULT_SETTINGS, SettingsStore } from '../settings/store';
import { Broadcaster } from './broadcast';
import { mainHandlers, privilegedHandlers } from './handlers';

const ctx = { signal: new AbortController().signal, requestId: '1' };

/** A store whose file never exists: reads find nothing, these tests write nothing. */
function emptyStore() {
  return new SecretsStore({
    file: '/nonexistent/thicket-test/secrets.bin',
    safeStorage: new FakeSafeStorage(),
    platform: 'linux',
  });
}
const deps = (version: string) => ({ version, secrets: emptyStore() });

describe('main handlers', () => {
  it('app.ping answers with the process and version', () => {
    const result: unknown = mainHandlers(deps('1.2.3'))['app.ping']?.({} as never, ctx);
    expect(result).toEqual({ process: 'main', version: '1.2.3' });
    expect(parseResult('app.ping', result).ok).toBe(true);
  });

  it('the privileged handlers answer within their contract (nothing stored)', async () => {
    const handlers = privilegedHandlers({ secrets: emptyStore() });
    const ping: unknown = handlers['main.ping']?.({} as never, ctx);
    const secrets: unknown = await handlers['secrets.get']?.({ profileId: 'p' } as never, ctx);
    expect(parseResultIn(privilegedMethods, 'main.ping', ping).ok).toBe(true);
    expect(secrets).toEqual({ secrets: null });
    expect(parseResultIn(privilegedMethods, 'secrets.get', secrets).ok).toBe(true);
  });

  it('main handlers and privileged handlers do not share a method name', () => {
    const main = Object.keys(mainHandlers(deps('0')));
    const privileged = Object.keys(privilegedHandlers({ secrets: emptyStore() }));
    expect(main.filter((name) => privileged.includes(name))).toEqual([]);
  });
});

/** A synchronous in-memory port: `push` delivers to the server, `sent` collects its answers. */
function fakePort() {
  const listeners = new Set<(message: unknown) => void>();
  const port = {
    sent: [] as Response[],
    send: (message: unknown) => void port.sent.push(message as Response),
    onMessage(listener: (message: unknown) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    close: () => undefined,
    push: (message: unknown) => {
      for (const listener of [...listeners]) listener(message);
    },
  };
  return port satisfies Port;
}

describe("a window's main port (served with the renderer contract)", () => {
  it('answers app.ping and refuses privileged methods even if a handler for them exists', async () => {
    const port = fakePort();
    const secretsGet = vi.fn(() => ({ secrets: { password: 'fictitious' } }));
    // Even a mistaken wiring that mixes in the privileged handlers must not expose them: the
    // renderer-facing server validates against `methods`, which does not contain them.
    serve(port, {
      table: methods,
      route: 'main',
      handlers: {
        ...mainHandlers(deps('9.9.9')),
        ...privilegedHandlers({ secrets: emptyStore() }),
        'secrets.get': secretsGet,
      },
    });
    port.push({ id: '1', method: 'app.ping', params: {} });
    port.push({ id: '2', method: 'secrets.get', params: { profileId: 'p' } });
    port.push({ id: '3', method: 'main.ping', params: {} });
    await vi.waitFor(() => expect(port.sent).toHaveLength(3));
    const byId = new Map(port.sent.map((r) => [r.id, r]));
    expect(byId.get('1')).toEqual({
      id: '1',
      ok: true,
      result: { process: 'main', version: '9.9.9' },
    });
    expect(byId.get('2')).toMatchObject({ ok: false, error: { code: 'UNKNOWN_METHOD' } });
    expect(byId.get('3')).toMatchObject({ ok: false, error: { code: 'UNKNOWN_METHOD' } });
    expect(secretsGet).not.toHaveBeenCalled();
  });

  it('refuses backend methods sent to main and inherited object keys as method names', async () => {
    const port = fakePort();
    serve(port, { table: methods, route: 'main', handlers: mainHandlers(deps('1')) });
    port.push({ id: 'b', method: 'backend.sleep', params: { ms: 10 } });
    port.push({ id: 'p', method: '__proto__', params: {} });
    port.push({ id: 'c', method: 'constructor', params: {} });
    await vi.waitFor(() => expect(port.sent).toHaveLength(3));
    const byId = new Map(port.sent.map((r) => [r.id, r]));
    expect(byId.get('b')).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL', message: 'backend.sleep is served by backend, not by main' },
    });
    expect(byId.get('p')).toMatchObject({ ok: false, error: { code: 'UNKNOWN_METHOD' } });
    expect(byId.get('c')).toMatchObject({ ok: false, error: { code: 'UNKNOWN_METHOD' } });
  });
});

describe('main handlers with a HistoryStore (task query-history)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'thicket-main-history-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const HISTORY_METHODS = [
    'history.list',
    'history.add',
    'history.clear',
    'history.saveFavorite',
    'history.deleteFavorite',
  ];
  const TARGET = { profileId: 'p1', db: 'shop', coll: 'orders' };
  const QUERY = { filter: '{ a: 1 }', projection: '', sort: '', collation: '', limit: '' };

  it('serves history.* only when a HistoryStore is given, never on the privileged port', () => {
    const without = Object.keys(mainHandlers(deps('1')));
    expect(without.filter((name) => name.startsWith('history.'))).toEqual([]);
    const withHistory = Object.keys(
      mainHandlers({ ...deps('1'), history: new HistoryStore({ dir }) }),
    );
    expect(withHistory).toEqual(expect.arrayContaining(HISTORY_METHODS));
    for (const name of HISTORY_METHODS) expect(route(name)).toBe('main');
    const privileged = Object.keys(privilegedHandlers({ secrets: emptyStore() }));
    expect(privileged.filter((name) => name.startsWith('history.'))).toEqual([]);
  });

  it('answers history.* over a window port within the contract; invalid params write nothing', async () => {
    const port = fakePort();
    serve(port, {
      table: methods,
      route: 'main',
      handlers: mainHandlers({ ...deps('1'), history: new HistoryStore({ dir }) }),
    });
    port.push({
      id: 'bad',
      method: 'history.saveFavorite',
      params: { ...TARGET, name: '  ', query: QUERY },
    });
    port.push({
      id: 'extra',
      method: 'history.add',
      params: { ...TARGET, query: { ...QUERY, hint: 'x' } },
    });
    await vi.waitFor(() => expect(port.sent).toHaveLength(2));
    for (const answer of port.sent) {
      expect(answer).toMatchObject({ ok: false, error: { code: 'INVALID_PARAMS' } });
    }
    expect(await readdir(dir)).toEqual([]);

    port.push({ id: 'add', method: 'history.add', params: { ...TARGET, query: QUERY } });
    await vi.waitFor(() => expect(port.sent).toHaveLength(3));
    port.push({
      id: 'fav',
      method: 'history.saveFavorite',
      params: { ...TARGET, name: '  Open ', query: QUERY },
    });
    await vi.waitFor(() => expect(port.sent).toHaveLength(4));
    port.push({ id: 'list', method: 'history.list', params: TARGET });
    await vi.waitFor(() => expect(port.sent).toHaveLength(5));
    const byId = new Map(port.sent.map((r) => [r.id, r]));
    expect(byId.get('fav')).toMatchObject({
      ok: true,
      result: { favorites: [{ name: 'Open', query: QUERY }] },
    });
    const list = byId.get('list');
    expect(list).toMatchObject({
      ok: true,
      result: { entries: [{ query: QUERY }], favorites: [{ name: 'Open' }] },
    });
    if (list?.ok) expect(parseResult('history.list', list.result).ok).toBe(true);
    expect((await readdir(dir)).sort()).toEqual(['favorites.json', 'history']);
  });
});

describe('main handlers with a ProfilesStore', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'thicket-main-profiles-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function withProfiles() {
    const secrets = new SecretsStore({
      file: path.join(dir, 'secrets.bin'),
      safeStorage: new FakeSafeStorage(),
      platform: 'linux',
    });
    const profiles = new ProfilesStore({ file: path.join(dir, 'connections.json'), secrets });
    return mainHandlers({ version: '1', secrets, profiles });
  }

  it('serves profiles.* only when a ProfilesStore is given', () => {
    const profileMethods = [
      'profiles.list',
      'profiles.get',
      'profiles.save',
      'profiles.delete',
      'profiles.duplicate',
    ];
    expect(Object.keys(mainHandlers(deps('1')))).not.toEqual(
      expect.arrayContaining(['profiles.list']),
    );
    expect(Object.keys(withProfiles())).toEqual(
      expect.arrayContaining([
        ...profileMethods,
        'profiles.setSecret',
        'profiles.clearSecret',
        'profiles.secretStorage',
      ]),
    );
    // Still no overlap with the privileged port.
    const privileged = Object.keys(privilegedHandlers({ secrets: emptyStore() }));
    expect(Object.keys(withProfiles()).filter((name) => privileged.includes(name))).toEqual([]);
  });

  it('serves profiles.forConnect on the privileged port (NOT_FOUND for unknown ids)', async () => {
    const secrets = new SecretsStore({
      file: path.join(dir, 'secrets.bin'),
      safeStorage: new FakeSafeStorage(),
      platform: 'linux',
    });
    const profiles = new ProfilesStore({ file: path.join(dir, 'connections.json'), secrets });
    const saved = await profiles.save({
      name: 'Local',
      connectionString: 'mongodb://localhost:27017',
      readOnly: true,
      production: false,
    });
    expect(Object.keys(privilegedHandlers({ secrets }))).not.toContain('profiles.forConnect');
    const handlers = privilegedHandlers({ secrets, profiles });
    expect(Object.keys(mainHandlers({ version: '1', secrets, profiles }))).not.toContain(
      'profiles.forConnect',
    );
    const found: unknown = await handlers['profiles.forConnect']?.(
      { profileId: saved.id } as never,
      ctx,
    );
    expect(found).toEqual({ profile: saved });
    expect(parseResultIn(privilegedMethods, 'profiles.forConnect', found).ok).toBe(true);
    await expect(
      handlers['profiles.forConnect']?.({ profileId: 'missing' } as never, ctx),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('gates profiles.setSecret on the profile existing (over the main port)', async () => {
    const port = fakePort();
    serve(port, { table: methods, route: 'main', handlers: withProfiles() });
    port.push({
      id: 's1',
      method: 'profiles.setSecret',
      params: { profileId: 'ghost', kind: 'password', value: 'fictitious' },
    });
    await vi.waitFor(() => expect(port.sent).toHaveLength(1));
    expect(port.sent[0]).toMatchObject({ id: 's1', ok: false, error: { code: 'NOT_FOUND' } });
    await expect(readdir(dir)).resolves.toEqual([]);

    port.push({
      id: 'p1',
      method: 'profiles.save',
      params: {
        profile: {
          name: 'Fictitious',
          connectionString: 'mongodb://alice@db.example.test',
          auth: { mechanism: 'SCRAM-SHA-256', username: 'alice', secretMode: 'saved' },
          readOnly: false,
          production: false,
        },
      },
    });
    await vi.waitFor(() => expect(port.sent).toHaveLength(2));
    const saved = port.sent[1] as { ok: true; result: { profile: { id: string } } };
    expect(saved).toMatchObject({ id: 'p1', ok: true });
    port.push({
      id: 's2',
      method: 'profiles.setSecret',
      params: { profileId: saved.result.profile.id, kind: 'password', value: 'fictitious' },
    });
    port.push({ id: 'l1', method: 'profiles.list', params: {} });
    await vi.waitFor(() => expect(port.sent).toHaveLength(4));
    const byId = new Map(port.sent.map((r) => [r.id, r]));
    expect(byId.get('s2')).toMatchObject({ ok: true, result: { secureStorage: true } });
    expect(byId.get('l1')).toMatchObject({ ok: true });
    expect(JSON.stringify(port.sent)).not.toContain('"fictitious"');
  });

  describe('import/export (profiles.importCompass/importUris/export)', () => {
    const IMPORT_METHODS = ['profiles.importCompass', 'profiles.importUris', 'profiles.export'];
    const dialogs = {
      showSaveDialog: vi.fn(() => Promise.resolve({ canceled: true })),
      showOpenDialog: vi.fn(() => Promise.resolve({ canceled: true, filePaths: [] })),
    };

    function stores() {
      const secrets = new SecretsStore({
        file: path.join(dir, 'secrets.bin'),
        safeStorage: new FakeSafeStorage(),
        platform: 'linux',
      });
      const profiles = new ProfilesStore({ file: path.join(dir, 'connections.json'), secrets });
      return { secrets, profiles };
    }

    it('are served only when both a ProfilesStore and native dialogs are given', () => {
      const { secrets, profiles } = stores();
      const keys = (d: Parameters<typeof mainHandlers>[0]) => Object.keys(mainHandlers(d));
      for (const name of IMPORT_METHODS) {
        expect(keys({ version: '1', secrets })).not.toContain(name);
        expect(keys({ version: '1', secrets, dialogs })).not.toContain(name);
        expect(keys({ version: '1', secrets, profiles })).not.toContain(name);
        expect(keys({ version: '1', secrets, profiles, dialogs })).toContain(name);
        expect(route(name as 'profiles.export')).toBe('main');
      }
      // Adding the dialogs adds exactly the three methods; nothing is replaced or lost.
      expect(keys({ version: '1', secrets, profiles, dialogs }).sort()).toEqual(
        [...keys({ version: '1', secrets, profiles }), ...IMPORT_METHODS].sort(),
      );
      // Never on the privileged port.
      const privileged = Object.keys(privilegedHandlers({ secrets, profiles, dialogs }));
      for (const name of IMPORT_METHODS) expect(privileged).not.toContain(name);
    });

    it('import connection strings over the main port: password to secrets.bin only', async () => {
      const { secrets, profiles } = stores();
      const port = fakePort();
      serve(port, {
        table: methods,
        route: 'main',
        handlers: mainHandlers({ version: '1', secrets, profiles, dialogs }),
      });
      port.push({
        id: 'i1',
        method: 'profiles.importUris',
        params: { uris: ['mongodb://alice:fictitious-pw@db.example.test/?authSource=admin'] },
      });
      await vi.waitFor(() => expect(port.sent).toHaveLength(1));
      const reply = port.sent[0] as { ok: true; result: unknown };
      expect(reply).toMatchObject({ id: 'i1', ok: true });
      expect(parseResult('profiles.importUris', reply.result).ok).toBe(true);
      expect(reply.result).toMatchObject({
        imported: [
          {
            name: 'db.example.test',
            connectionString: 'mongodb://alice@db.example.test/?authSource=admin',
            auth: { username: 'alice', secretMode: 'saved' },
          },
        ],
        skipped: [],
        notices: [],
      });
      expect(JSON.stringify(port.sent)).not.toContain('fictitious-pw');
      const stored = await readFile(path.join(dir, 'connections.json'), 'utf8');
      expect(stored).toContain('db.example.test');
      expect(stored).not.toContain('fictitious-pw');

      port.push({ id: 'c1', method: 'profiles.importCompass', params: {} });
      port.push({ id: 'e1', method: 'profiles.export', params: {} });
      await vi.waitFor(() => expect(port.sent).toHaveLength(3));
      const byId = new Map(port.sent.map((r) => [r.id, r]));
      expect(byId.get('c1')).toMatchObject({ ok: true, result: null });
      expect(byId.get('e1')).toMatchObject({ ok: true, result: { path: null, exported: 0 } });
    });

    it('passes its log to the import (a secret that cannot be saved is logged)', async () => {
      const { secrets, profiles } = stores();
      vi.spyOn(secrets, 'set').mockRejectedValue(new Error('disk full'));
      const log = vi.fn();
      const handlers = mainHandlers({ version: '1', secrets, profiles, dialogs, log });
      const result = await handlers['profiles.importUris']?.(
        { uris: ['mongodb://alice:fictitious-pw@db.example.test/'] } as never,
        ctx,
      );
      expect(result).toMatchObject({ imported: [{ auth: { secretMode: 'ask' } }] });
      expect(log).toHaveBeenCalledWith(expect.stringContaining('could not save the password'));
      expect(JSON.stringify(log.mock.calls)).not.toContain('fictitious-pw');
    });
  });

  describe('together with a settings store', () => {
    function both() {
      const secrets = new SecretsStore({
        file: path.join(dir, 'secrets.bin'),
        safeStorage: new FakeSafeStorage(),
        platform: 'linux',
      });
      const profiles = new ProfilesStore({ file: path.join(dir, 'connections.json'), secrets });
      const settings = {
        get: vi.fn((): Settings => ({ ...DEFAULT_SETTINGS })),
        set: vi.fn((changes: Partial<Settings>) =>
          Promise.resolve({ ...DEFAULT_SETTINGS, ...changes }),
        ),
      };
      return { secrets, profiles, settings };
    }

    it('serve the union of both handler sets; nothing is replaced or lost', () => {
      const { secrets, profiles, settings } = both();
      const onlyProfiles = Object.keys(mainHandlers({ version: '1', secrets, profiles }));
      const onlySettings = Object.keys(mainHandlers({ version: '1', secrets, settings }));
      const all = Object.keys(mainHandlers({ version: '1', secrets, profiles, settings }));
      expect([...all].sort()).toEqual([...new Set([...onlyProfiles, ...onlySettings])].sort());
      expect(all).toEqual(
        expect.arrayContaining(['profiles.list', 'profiles.setSecret', 'app.settings.set']),
      );
      for (const name of all) {
        expect(Object.hasOwn(methods, name)).toBe(true);
        expect(route(name)).toBe('main');
      }
      const privileged = Object.keys(privilegedHandlers({ secrets: emptyStore() }));
      expect(all.filter((name) => privileged.includes(name))).toEqual([]);
    });

    it('answer profiles, settings and the gated setSecret on one window port', async () => {
      const { secrets, profiles, settings } = both();
      const port = fakePort();
      serve(port, {
        table: methods,
        route: 'main',
        handlers: mainHandlers({ version: '1', secrets, profiles, settings }),
      });
      port.push({ id: 'l', method: 'profiles.list', params: {} });
      port.push({ id: 'g', method: 'app.settings.get', params: {} });
      port.push({
        id: 's',
        method: 'profiles.setSecret',
        params: { profileId: 'ghost', kind: 'password', value: 'fictitious' },
      });
      await vi.waitFor(() => expect(port.sent).toHaveLength(3));
      const byId = new Map(port.sent.map((r) => [r.id, r]));
      expect(byId.get('l')).toEqual({ id: 'l', ok: true, result: { profiles: [] } });
      expect(byId.get('g')).toEqual({ id: 'g', ok: true, result: { settings: DEFAULT_SETTINGS } });
      // The settings store does not undo the profile-existence gate on setSecret.
      expect(byId.get('s')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
      expect(settings.set).not.toHaveBeenCalled();
      await expect(readdir(dir)).resolves.toEqual([]);
    });
  });
});

describe('the privileged port (main side)', () => {
  it('serves main.ping and secrets.get, and validates secrets.get params', async () => {
    const port = fakePort();
    const handlers = privilegedHandlers({ secrets: emptyStore() });
    serve(port, { table: privilegedMethods, route: 'main', handlers });
    port.push({ id: 'b1', method: 'main.ping', params: {} });
    port.push({ id: 'b2', method: 'secrets.get', params: { profileId: 'p1' } });
    port.push({ id: 'b3', method: 'secrets.get', params: {} });
    port.push({ id: 'b4', method: 'app.ping', params: {} });
    await vi.waitFor(() => expect(port.sent).toHaveLength(4));
    const byId = new Map(port.sent.map((r) => [r.id, r]));
    expect(byId.get('b1')).toEqual({ id: 'b1', ok: true, result: { process: 'main' } });
    expect(byId.get('b2')).toEqual({ id: 'b2', ok: true, result: { secrets: null } });
    expect(byId.get('b3')).toMatchObject({ ok: false, error: { code: 'INVALID_PARAMS' } });
    // The renderer contract is not served on the privileged port either.
    expect(byId.get('b4')).toMatchObject({ ok: false, error: { code: 'UNKNOWN_METHOD' } });
  });
});

describe('the privileged port with native dialogs', () => {
  const dialogs = {
    showSaveDialog: vi.fn(() =>
      Promise.resolve({ canceled: false, filePath: '/home/alice/a.json' }),
    ),
    showOpenDialog: vi.fn(() => Promise.resolve({ canceled: true, filePaths: [] })),
  };

  it('serves dialog.saveFile / dialog.openFile only when dialogs are given', () => {
    const without = Object.keys(privilegedHandlers({ secrets: emptyStore() }));
    const withDialogs = Object.keys(privilegedHandlers({ secrets: emptyStore(), dialogs }));
    expect(without).not.toContain('dialog.saveFile');
    expect(without).not.toContain('dialog.openFile');
    // Adding the dialogs only adds the two dialog methods; nothing is replaced or lost.
    expect(withDialogs.sort()).toEqual([...without, 'dialog.openFile', 'dialog.saveFile'].sort());
    for (const name of withDialogs) expect(Object.hasOwn(privilegedMethods, name)).toBe(true);
  });

  it('keeps profiles.forConnect next to the dialogs', () => {
    const secrets = emptyStore();
    const profiles = new ProfilesStore({ file: '/nonexistent/thicket-test/c.json', secrets });
    expect(Object.keys(privilegedHandlers({ secrets, profiles, dialogs }))).toEqual(
      expect.arrayContaining(['profiles.forConnect', 'dialog.saveFile', 'dialog.openFile']),
    );
  });

  it('answers dialog.* over the privileged port but never over a window port', async () => {
    const privileged = fakePort();
    serve(privileged, {
      table: privilegedMethods,
      route: 'main',
      handlers: privilegedHandlers({ secrets: emptyStore(), dialogs }),
    });
    privileged.push({ id: 's', method: 'dialog.saveFile', params: { defaultName: 'a.json' } });
    privileged.push({ id: 'o', method: 'dialog.openFile', params: {} });
    await vi.waitFor(() => expect(privileged.sent).toHaveLength(2));
    const byId = new Map(privileged.sent.map((r) => [r.id, r]));
    expect(byId.get('s')).toEqual({ id: 's', ok: true, result: { path: '/home/alice/a.json' } });
    expect(byId.get('o')).toEqual({ id: 'o', ok: true, result: { path: null } });

    // Even a mistaken wiring that mixes them into a window's handlers must not expose them.
    const window = fakePort();
    serve(window, {
      table: methods,
      route: 'main',
      handlers: {
        ...mainHandlers(deps('1')),
        ...privilegedHandlers({ secrets: emptyStore(), dialogs }),
      },
    });
    window.push({ id: 'w', method: 'dialog.saveFile', params: {} });
    await vi.waitFor(() => expect(window.sent).toHaveLength(1));
    expect(window.sent[0]).toMatchObject({ ok: false, error: { code: 'UNKNOWN_METHOD' } });
    expect(dialogs.showSaveDialog).toHaveBeenCalledTimes(1);
  });
});

describe('the privileged port with OIDC (task oidc-auth)', () => {
  const oidc = { openExternal: vi.fn(() => Promise.resolve()) };

  it('serves oidc.openBrowser / oidc.saveTokens only when oidc deps are given', () => {
    const without = Object.keys(privilegedHandlers({ secrets: emptyStore() }));
    const withOidc = Object.keys(privilegedHandlers({ secrets: emptyStore(), oidc }));
    expect(without).not.toContain('oidc.openBrowser');
    expect(without).not.toContain('oidc.saveTokens');
    // Adding OIDC only adds its two methods; nothing is replaced or lost.
    expect(withOidc.sort()).toEqual([...without, 'oidc.openBrowser', 'oidc.saveTokens'].sort());
    for (const name of withOidc) expect(Object.hasOwn(privilegedMethods, name)).toBe(true);
  });

  it('keeps profiles.forConnect and the dialogs next to oidc.*', () => {
    const secrets = emptyStore();
    const profiles = new ProfilesStore({ file: '/nonexistent/thicket-test/c.json', secrets });
    const dialogs = {
      showSaveDialog: vi.fn(() => Promise.resolve({ canceled: true, filePath: '' })),
      showOpenDialog: vi.fn(() => Promise.resolve({ canceled: true, filePaths: [] })),
    };
    expect(Object.keys(privilegedHandlers({ secrets, profiles, dialogs, oidc }))).toEqual(
      expect.arrayContaining([
        'profiles.forConnect',
        'dialog.saveFile',
        'oidc.openBrowser',
        'oidc.saveTokens',
      ]),
    );
  });

  it('oidc.saveTokens uses the given secrets store', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'thicket-main-oidc-'));
    try {
      const secrets = new SecretsStore({
        file: path.join(dir, 'secrets.bin'),
        safeStorage: new FakeSafeStorage(),
        platform: 'linux',
      });
      const handlers = privilegedHandlers({ secrets, oidc });
      const result: unknown = await handlers['oidc.saveTokens']?.(
        { profileId: 'p1', tokens: '{"fictitious":true}' } as never,
        ctx,
      );
      expect(result).toEqual({ saved: true });
      expect(await secrets.get('p1')).toEqual({ oidcTokens: '{"fictitious":true}' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('oidc.* is never answered over a window port, even if mixed into its handlers', async () => {
    const window = fakePort();
    serve(window, {
      table: methods,
      route: 'main',
      handlers: {
        ...mainHandlers(deps('1')),
        ...privilegedHandlers({ secrets: emptyStore(), oidc }),
      },
    });
    window.push({ id: 'o', method: 'oidc.openBrowser', params: { url: 'https://a.example.test' } });
    window.push({ id: 's', method: 'oidc.saveTokens', params: { profileId: 'p', tokens: 'x' } });
    await vi.waitFor(() => expect(window.sent).toHaveLength(2));
    for (const answer of window.sent) {
      expect(answer).toMatchObject({ ok: false, error: { code: 'UNKNOWN_METHOD' } });
    }
    expect(oidc.openExternal).not.toHaveBeenCalled();
  });
});

describe('app.settings handlers', () => {
  const SETTINGS: Settings = {
    style: 'business',
    mode: 'system',
    pageSize: 50,
    nestedPageSize: 100,
    defaultIntegerType: 'int32',
    dateDisplay: 'local',
    checkForUpdates: true,
    schemaSampleSize: 1000,
    sidebarWidth: 260,
  };

  function fakeStore() {
    let current: Settings = { ...SETTINGS };
    return {
      get: vi.fn(() => ({ ...current })),
      set: vi.fn((changes: Partial<Settings>) => {
        current = { ...current, ...changes };
        return Promise.resolve({ ...current });
      }),
    };
  }

  it('are only served when a settings store is given', () => {
    expect(mainHandlers(deps('1'))['app.settings.get']).toBeUndefined();
    expect(mainHandlers({ ...deps('1'), settings: fakeStore() })['app.settings.get']).toBeDefined();
  });

  it('coexist with the secrets handlers: every name is a distinct main-routed renderer method', () => {
    const without = Object.keys(mainHandlers(deps('1')));
    const withSettings = Object.keys(mainHandlers({ ...deps('1'), settings: fakeStore() }));
    // Adding the settings store only adds the two settings methods; nothing is replaced or lost.
    expect(withSettings.sort()).toEqual(
      [...without, 'app.settings.get', 'app.settings.set'].sort(),
    );
    expect(without).toEqual(
      expect.arrayContaining([
        'profiles.secretStorage',
        'profiles.setSecret',
        'profiles.clearSecret',
      ]),
    );
    for (const name of withSettings) {
      expect(Object.hasOwn(methods, name)).toBe(true);
      expect(route(name)).toBe('main');
    }
  });

  it('settings and secrets methods are both answered on one window port', async () => {
    const store = fakeStore();
    const port = fakePort();
    serve(port, {
      table: methods,
      route: 'main',
      handlers: mainHandlers({ ...deps('1'), settings: store }),
    });
    port.push({ id: 'st', method: 'profiles.secretStorage', params: {} });
    port.push({ id: 'g', method: 'app.settings.get', params: {} });
    port.push({ id: 's', method: 'app.settings.set', params: { settings: { pageSize: 100 } } });
    await vi.waitFor(() => expect(port.sent).toHaveLength(3));
    const byId = new Map(port.sent.map((r) => [r.id, r]));
    expect(byId.get('st')).toMatchObject({ ok: true });
    expect(
      parseResult('profiles.secretStorage', (byId.get('st') as { result: unknown }).result).ok,
    ).toBe(true);
    expect(byId.get('g')).toEqual({ id: 'g', ok: true, result: { settings: SETTINGS } });
    expect(byId.get('s')).toEqual({
      id: 's',
      ok: true,
      result: { settings: { ...SETTINGS, pageSize: 100 } },
    });
  });

  it('get and set go to the store over the renderer contract; invalid values are refused', async () => {
    const store = fakeStore();
    const port = fakePort();
    serve(port, {
      table: methods,
      route: 'main',
      handlers: mainHandlers({ ...deps('1'), settings: store }),
    });
    port.push({ id: 'g', method: 'app.settings.get', params: {} });
    port.push({ id: 's', method: 'app.settings.set', params: { settings: { style: 'tron' } } });
    port.push({ id: 'bad', method: 'app.settings.set', params: { settings: { pageSize: 30 } } });
    port.push({ id: 'extra', method: 'app.settings.set', params: { settings: { nope: 1 } } });
    await vi.waitFor(() => expect(port.sent).toHaveLength(4));
    const byId = new Map(port.sent.map((r) => [r.id, r]));
    expect(byId.get('g')).toEqual({ id: 'g', ok: true, result: { settings: SETTINGS } });
    expect(byId.get('s')).toEqual({
      id: 's',
      ok: true,
      result: { settings: { ...SETTINGS, style: 'tron' } },
    });
    expect(byId.get('bad')).toMatchObject({ ok: false, error: { code: 'INVALID_PARAMS' } });
    expect(byId.get('extra')).toMatchObject({ ok: false, error: { code: 'INVALID_PARAMS' } });
    expect(store.set).toHaveBeenCalledTimes(1);
    expect(store.set).toHaveBeenCalledWith({ style: 'tron' });
  });

  it('a failing store answers INTERNAL', async () => {
    const store = fakeStore();
    store.set.mockRejectedValueOnce(new Error('disk full'));
    const port = fakePort();
    const onError = vi.fn();
    serve(port, {
      table: methods,
      route: 'main',
      handlers: mainHandlers({ ...deps('1'), settings: store }),
      onError,
    });
    port.push({ id: 'f', method: 'app.settings.set', params: { settings: { mode: 'dark' } } });
    await vi.waitFor(() => expect(port.sent).toHaveLength(1));
    expect(port.sent[0]).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    expect(onError).toHaveBeenCalled();
  });
});

describe('app.settings with the real store and broadcaster (as wired in index.ts)', () => {
  it('a set over the port saves, answers and broadcasts one valid app.settings.changed', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'thicket-handlers-'));
    try {
      const file = path.join(dir, 'settings.json');
      const store = await SettingsStore.open(file);
      const broadcaster = new Broadcaster();
      store.onChange((value) =>
        broadcaster.emit(BROADCAST_STREAMS.settingsChanged, { settings: value }),
      );
      const events: Event[] = [];
      broadcaster.add((e) => events.push(e));
      const port = fakePort();
      serve(port, {
        table: methods,
        route: 'main',
        handlers: mainHandlers({ ...deps('1'), settings: store }),
      });

      port.push({ id: 's', method: 'app.settings.set', params: { settings: { mode: 'dark' } } });
      await vi.waitFor(() => expect(port.sent).toHaveLength(1));
      const expected = { ...DEFAULT_SETTINGS, mode: 'dark' };
      expect(port.sent[0]).toEqual({ id: 's', ok: true, result: { settings: expected } });
      expect(parseResult('app.settings.set', (port.sent[0] as { result: unknown }).result).ok).toBe(
        true,
      );
      expect(events).toEqual([
        { stream: 'app.settings.changed', kind: 'data', payload: { settings: expected } },
      ]);
      expect(settingsChanged.safeParse(events[0]?.payload).success).toBe(true);
      expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ version: 1, settings: expected });

      // Same value again, and an invalid value: answered, but no further event.
      port.push({ id: 'same', method: 'app.settings.set', params: { settings: { mode: 'dark' } } });
      port.push({ id: 'bad', method: 'app.settings.set', params: { settings: { pageSize: 7 } } });
      await vi.waitFor(() => expect(port.sent).toHaveLength(3));
      const byId = new Map(port.sent.map((r) => [r.id, r]));
      expect(byId.get('same')).toMatchObject({ ok: true, result: { settings: expected } });
      expect(byId.get('bad')).toMatchObject({ ok: false, error: { code: 'INVALID_PARAMS' } });
      expect(events).toHaveLength(1);

      port.push({ id: 'g', method: 'app.settings.get', params: {} });
      await vi.waitFor(() => expect(port.sent).toHaveLength(4));
      expect(port.sent[3]).toEqual({ id: 'g', ok: true, result: { settings: expected } });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
