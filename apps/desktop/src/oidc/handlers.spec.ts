import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { serve, type Port } from '@thicket/backend';
import {
  parseResultIn,
  privilegedMethods,
  type Response,
  type SecretStorageStatus,
} from '@thicket/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SecretsStore } from '../secrets';
import { FakeSafeStorage } from '../secrets/testing';
import { oidcHandlers, type OidcMainDeps } from './handlers';

const ctx = { signal: new AbortController().signal, requestId: '1' };

/** A fictitious token cache (what the backend sends as `tokens`). */
const TOKENS = '{"v":1,"issuer":"https://idp.example.test","accessToken":"fictitious-at"}';

function fakeSecrets(level: SecretStorageStatus['level'] = 'secure') {
  return {
    status: vi.fn(() =>
      Promise.resolve({
        level,
        backend: 'gnome_libsecret',
        defaultSecretMode: level === 'secure' ? 'saved' : 'ask',
      } as SecretStorageStatus),
    ),
    set: vi.fn<SecretsStore['set']>(() => Promise.resolve()),
    delete: vi.fn<SecretsStore['delete']>(() => Promise.resolve()),
  };
}

function handlers(deps: Partial<OidcMainDeps> & { secrets?: ReturnType<typeof fakeSecrets> }) {
  const secrets = deps.secrets ?? fakeSecrets();
  const openExternal = deps.openExternal ?? vi.fn(() => Promise.resolve());
  const table = oidcHandlers({ ...deps, openExternal, secrets });
  return {
    secrets,
    openExternal,
    openBrowser: (url: string) =>
      table['oidc.openBrowser']?.({ url } as never, ctx) as Promise<unknown>,
    saveTokens: (profileId: string, tokens: string | null) =>
      table['oidc.saveTokens']?.({ profileId, tokens } as never, ctx) as Promise<unknown>,
  };
}

describe('oidcHandlers', () => {
  it('serves exactly oidc.openBrowser and oidc.saveTokens, both privileged methods', () => {
    const names = Object.keys(oidcHandlers({ openExternal: vi.fn(), secrets: fakeSecrets() }));
    expect(names.sort()).toEqual(['oidc.openBrowser', 'oidc.saveTokens']);
    for (const name of names) expect(Object.hasOwn(privilegedMethods, name)).toBe(true);
  });
});

describe('oidc.openBrowser', () => {
  it.each([
    'https://idp.example.test/auth?client_id=c&state=s',
    'http://localhost:8080/realms/test/protocol/openid-connect/auth',
  ])('opens %s in the system browser', async (url) => {
    const h = handlers({});
    const result = await h.openBrowser(url);
    expect(result).toEqual({});
    expect(parseResultIn(privilegedMethods, 'oidc.openBrowser', result).ok).toBe(true);
    expect(h.openExternal).toHaveBeenCalledWith(new URL(url).toString());
  });

  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'smb://share.example.test/x',
    'ms-settings:display',
    'data:text/html,<script>alert(1)</script>',
  ])('refuses the %s scheme without opening anything', async (url) => {
    const h = handlers({});
    await expect(h.openBrowser(url)).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    expect(h.openExternal).not.toHaveBeenCalled();
  });

  it('refuses a string that is no URL', async () => {
    const h = handlers({});
    await expect(h.openBrowser('not a url')).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      message: 'Not a URL',
    });
    expect(h.openExternal).not.toHaveBeenCalled();
  });

  it('a failing openExternal is UNSUPPORTED (the backend may fall back to the device flow)', async () => {
    const h = handlers({ openExternal: vi.fn(() => Promise.reject(new Error('no handler'))) });
    await expect(h.openBrowser('https://idp.example.test/auth')).rejects.toMatchObject({
      code: 'UNSUPPORTED',
    });
  });
});

describe('oidc.saveTokens', () => {
  it('stores the tokens as the oidcTokens secret with secure storage and an existing profile', async () => {
    const hasProfile = vi.fn(() => Promise.resolve(true));
    const h = handlers({ hasProfile });
    const result = await h.saveTokens('p1', TOKENS);
    expect(result).toEqual({ saved: true });
    expect(parseResultIn(privilegedMethods, 'oidc.saveTokens', result).ok).toBe(true);
    expect(hasProfile).toHaveBeenCalledWith('p1');
    expect(h.secrets.set).toHaveBeenCalledWith('p1', 'oidcTokens', TOKENS);
  });

  it.each(['weak', 'unavailable'] as const)(
    'does not store with %s secret storage (saved: false)',
    async (level) => {
      const h = handlers({ secrets: fakeSecrets(level), hasProfile: () => Promise.resolve(true) });
      await expect(h.saveTokens('p1', TOKENS)).resolves.toEqual({ saved: false });
      expect(h.secrets.set).not.toHaveBeenCalled();
    },
  );

  it('does not store tokens of a profile that no longer exists', async () => {
    const h = handlers({ hasProfile: () => Promise.resolve(false) });
    await expect(h.saveTokens('gone', TOKENS)).resolves.toEqual({ saved: false });
    expect(h.secrets.set).not.toHaveBeenCalled();
  });

  it('null clears the oidcTokens secret (only that kind)', async () => {
    const h = handlers({ secrets: fakeSecrets('weak') });
    await expect(h.saveTokens('p1', null)).resolves.toEqual({ saved: true });
    expect(h.secrets.delete).toHaveBeenCalledWith('p1', 'oidcTokens');
    expect(h.secrets.set).not.toHaveBeenCalled();
  });

  it.each([
    ['status', 'keyring gone'],
    ['set', 'disk full'],
    ['delete', 'locked'],
  ] as const)('a failing secrets.%s answers saved: false and is logged', async (method, text) => {
    const secrets = fakeSecrets();
    secrets[method].mockRejectedValue(new Error(text));
    const log = vi.fn();
    const h = handlers({ secrets, log });
    const tokens = method === 'delete' ? null : TOKENS;
    await expect(h.saveTokens('p1', tokens)).resolves.toEqual({ saved: false });
    expect(log).toHaveBeenCalledWith(expect.stringContaining(text));
    // The tokens never go to the log.
    expect(JSON.stringify(log.mock.calls)).not.toContain('fictitious-at');
  });

  it('a failing hasProfile answers saved: false', async () => {
    const h = handlers({ hasProfile: () => Promise.reject(new Error('profiles unreadable')) });
    await expect(h.saveTokens('p1', TOKENS)).resolves.toEqual({ saved: false });
    expect(h.secrets.set).not.toHaveBeenCalled();
  });
});

describe('oidc.saveTokens with the real SecretsStore', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'thicket-oidc-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function store(backend = 'gnome_libsecret') {
    return new SecretsStore({
      file: path.join(dir, 'secrets.bin'),
      safeStorage: new FakeSafeStorage({ backend }),
      platform: 'linux',
    });
  }

  it('keeps the token cache next to the other secrets of the profile, then clears it', async () => {
    const secrets = store();
    await secrets.set('p1', 'password', 'fictitious-pw');
    const table = oidcHandlers({ openExternal: vi.fn(), secrets });
    await table['oidc.saveTokens']?.({ profileId: 'p1', tokens: TOKENS } as never, ctx);
    expect(await secrets.get('p1')).toEqual({ password: 'fictitious-pw', oidcTokens: TOKENS });
    await table['oidc.saveTokens']?.({ profileId: 'p1', tokens: null } as never, ctx);
    expect(await secrets.get('p1')).toEqual({ password: 'fictitious-pw' });
  });

  it('with the basic_text (weak) backend nothing is written', async () => {
    const secrets = store('basic_text');
    const table = oidcHandlers({ openExternal: vi.fn(), secrets });
    const result: unknown = await table['oidc.saveTokens']?.(
      { profileId: 'p1', tokens: TOKENS } as never,
      ctx,
    );
    expect(result).toEqual({ saved: false });
    expect(await secrets.get('p1')).toBeNull();
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

describe('oidc.* over the privileged port (contract validation)', () => {
  it('the contract refuses non-http(s) URLs and malformed saveTokens params before the handler', async () => {
    const openExternal = vi.fn(() => Promise.resolve());
    const secrets = fakeSecrets();
    const port = fakePort();
    serve(port, {
      table: privilegedMethods,
      route: 'main',
      handlers: oidcHandlers({ openExternal, secrets }),
    });
    port.push({
      id: 'ok',
      method: 'oidc.openBrowser',
      params: { url: 'https://idp.example.test/a' },
    });
    port.push({ id: 'file', method: 'oidc.openBrowser', params: { url: 'file:///etc/passwd' } });
    port.push({ id: 'extra', method: 'oidc.openBrowser', params: { url: 'https://a.test', x: 1 } });
    port.push({ id: 'empty', method: 'oidc.saveTokens', params: { profileId: 'p1', tokens: '' } });
    port.push({
      id: 'save',
      method: 'oidc.saveTokens',
      params: { profileId: 'p1', tokens: TOKENS },
    });
    await vi.waitFor(() => expect(port.sent).toHaveLength(5));
    const byId = new Map(port.sent.map((r) => [r.id, r]));
    expect(byId.get('ok')).toEqual({ id: 'ok', ok: true, result: {} });
    expect(byId.get('file')).toMatchObject({ ok: false, error: { code: 'INVALID_PARAMS' } });
    expect(byId.get('extra')).toMatchObject({ ok: false, error: { code: 'INVALID_PARAMS' } });
    expect(byId.get('empty')).toMatchObject({ ok: false, error: { code: 'INVALID_PARAMS' } });
    expect(byId.get('save')).toEqual({ id: 'save', ok: true, result: { saved: true } });
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(secrets.set).toHaveBeenCalledTimes(1);
  });
});
