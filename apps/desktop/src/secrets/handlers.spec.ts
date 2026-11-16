import { RpcError } from '@thicket/backend';
import { parseResult } from '@thicket/contract';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { secretsGetHandler, secretsHandlers } from './handlers';
import { SecretsStore } from './store';
import { FakeSafeStorage } from './testing';

const ctx = { signal: new AbortController().signal, requestId: '1' };
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'thicket-secrets-handlers-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function setup(safeStorage = new FakeSafeStorage()) {
  const store = new SecretsStore({
    file: path.join(dir, 'secrets.bin'),
    safeStorage,
    platform: 'linux',
  });
  const handlers = secretsHandlers(store);
  const call = (method: string, params: unknown) =>
    Promise.resolve(handlers[method]?.(params as never, ctx));
  return { store, call };
}

describe('secrets handlers', () => {
  it('profiles.secretStorage reports the status within the contract', async () => {
    const { call } = setup(new FakeSafeStorage({ backend: 'basic_text' }));
    const result = await call('profiles.secretStorage', {});
    expect(result).toEqual({ level: 'weak', backend: 'basic_text', defaultSecretMode: 'ask' });
    expect(parseResult('profiles.secretStorage', result).ok).toBe(true);
  });

  it('profiles.setSecret stores and reports secureStorage', async () => {
    const { store, call } = setup();
    const result = await call('profiles.setSecret', {
      profileId: 'p',
      kind: 'password',
      value: 'pw',
    });
    expect(result).toEqual({ secureStorage: true });
    expect(await store.get('p')).toEqual({ password: 'pw' });
  });

  it('profiles.setSecret on basic_text stores but reports secureStorage: false', async () => {
    const { store, call } = setup(new FakeSafeStorage({ backend: 'basic_text' }));
    const result = await call('profiles.setSecret', {
      profileId: 'p',
      kind: 'password',
      value: 'pw',
    });
    expect(result).toEqual({ secureStorage: false });
    expect(await store.get('p')).toEqual({ password: 'pw' });
  });

  it('profiles.setSecret without encryption fails with UNSUPPORTED', async () => {
    const { call } = setup(new FakeSafeStorage({ available: false }));
    const error: unknown = await call('profiles.setSecret', {
      profileId: 'p',
      kind: 'password',
      value: 'pw',
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcError);
    expect((error as RpcError).code).toBe('UNSUPPORTED');
  });

  it('profiles.setSecret passes other failures on unchanged (not as UNSUPPORTED)', async () => {
    const safeStorage = new FakeSafeStorage();
    safeStorage.encryptStringAsync = () => Promise.reject(new Error('encrypt failed'));
    const { store, call } = setup(safeStorage);
    const error: unknown = await call('profiles.setSecret', {
      profileId: 'p',
      kind: 'password',
      value: 'fictitious-pw',
    }).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(RpcError);
    expect((error as Error).message).toBe('encrypt failed');
    expect((error as Error).message).not.toContain('fictitious-pw');
    expect(await store.get('p')).toBeNull();
  });

  it('profiles.clearSecret of nothing stored answers {}', async () => {
    const { call } = setup();
    expect(await call('profiles.clearSecret', { profileId: 'nobody' })).toEqual({});
    expect(await call('profiles.clearSecret', { profileId: 'nobody', kind: 'oidcTokens' })).toEqual(
      {},
    );
  });

  it('profiles.clearSecret removes one kind or all', async () => {
    const { store, call } = setup();
    await store.set('p', 'password', 'pw');
    await store.set('p', 'sshPassword', 'ssh');
    expect(await call('profiles.clearSecret', { profileId: 'p', kind: 'password' })).toEqual({});
    expect(await store.get('p')).toEqual({ sshPassword: 'ssh' });
    expect(await call('profiles.clearSecret', { profileId: 'p' })).toEqual({});
    expect(await store.get('p')).toBeNull();
  });

  it('profiles.clearSecret without encryption fails with UNSUPPORTED when a file exists', async () => {
    const { store } = setup();
    await store.set('p', 'password', 'pw');
    const { store: locked, call } = setup(new FakeSafeStorage({ available: false }));
    const error: unknown = await call('profiles.clearSecret', { profileId: 'p' }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RpcError);
    expect((error as RpcError).code).toBe('UNSUPPORTED');
    expect(await locked.get('p')).toBeNull();
    expect(await setup().store.get('p')).toEqual({ password: 'pw' });
  });

  it('profiles.clearSecret on a weak backend with an undecryptable file fails with UNSUPPORTED', async () => {
    await writeFile(path.join(dir, 'secrets.bin'), Buffer.from('v11-keyring-ciphertext'));
    const { call } = setup(new FakeSafeStorage({ backend: 'basic_text' }));
    const error: unknown = await call('profiles.clearSecret', { profileId: 'p' }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RpcError);
    expect((error as RpcError).code).toBe('UNSUPPORTED');
  });

  it('secrets.get (privileged) returns the stored secrets or null', async () => {
    const { store } = setup();
    await store.set('p', 'password', 'pw');
    const get = secretsGetHandler(store);
    expect(await get({ profileId: 'p' } as never, ctx)).toEqual({ secrets: { password: 'pw' } });
    expect(await get({ profileId: 'q' } as never, ctx)).toEqual({ secrets: null });
  });
});
