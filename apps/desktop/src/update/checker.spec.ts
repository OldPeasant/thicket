import { methods } from '@thicket/contract';
import { describe, expect, it, vi } from 'vitest';

import {
  RELEASES_API,
  UPDATE_CACHE_MS,
  UpdateChecker,
  compareVersions,
  isReleaseUrl,
  parseVersion,
  type FetchLike,
} from './checker';
import { updateHandlers } from './handlers';
import rateLimited from './fixtures/rate-limited.json';
import releasesWithPrerelease from './fixtures/releases-prerelease.json';
import releases from './fixtures/releases.json';

/** A fetch that answers with a recorded GitHub response. */
function recorded(body: unknown, status = 200) {
  return vi.fn<FetchLike>(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

function checker(
  current: string,
  fetch: FetchLike,
  extra: Partial<{ enabled: () => boolean }> = {},
) {
  const log = vi.fn<(message: string) => void>();
  let time = 1_000_000;
  const instance = new UpdateChecker({
    current,
    enabled: extra.enabled ?? (() => true),
    fetch,
    log,
    now: () => time,
  });
  return { instance, log, advance: (ms: number) => (time += ms) };
}

const parseResult = (value: unknown) => methods['app.checkForUpdate'].result.parse(value);

describe('UpdateChecker with recorded API responses', () => {
  it('reports a newer release with its page', async () => {
    const fetch = recorded(releases);
    const result = await checker('0.2.0', fetch).instance.check();
    expect(parseResult(result)).toEqual({
      current: '0.2.0',
      latest: '0.3.0',
      updateAvailable: true,
      url: 'https://github.com/OldPeasant/thicket/releases/tag/v0.3.0',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      RELEASES_API,
      expect.objectContaining({
        headers: expect.objectContaining({ accept: 'application/vnd.github+json' }) as unknown,
      }),
    );
  });

  it('reports no update when the running version is the latest', async () => {
    const result = await checker('0.3.0', recorded(releases)).instance.check();
    expect(parseResult(result)).toMatchObject({ latest: '0.3.0', updateAvailable: false });
  });

  it('reports no update when the running version is newer than every release', async () => {
    const result = await checker('0.4.0', recorded(releases)).instance.check();
    expect(result.updateAvailable).toBe(false);
  });

  it('ignores pre-releases (the flag, or a pre-release tag)', async () => {
    const result = await checker('0.3.0', recorded(releasesWithPrerelease)).instance.check();
    expect(result).toEqual({
      current: '0.3.0',
      latest: '0.3.0',
      updateAvailable: false,
      url: 'https://github.com/OldPeasant/thicket/releases/tag/v0.3.0',
    });
  });

  it('ignores a pre-release tag published without the pre-release flag, and drafts', async () => {
    const [first] = releases;
    const body = [
      { ...first, tag_name: 'v0.9.0-rc.1' },
      { ...first, tag_name: 'v0.8.0', draft: true },
      ...releases.slice(1),
    ];
    const result = await checker('0.1.0', recorded(body)).instance.check();
    expect(result).toMatchObject({ latest: '0.2.0', updateAvailable: true });
  });

  it('a stable release is newer than a running pre-release of the same version', async () => {
    const result = await checker('0.3.0-beta.1', recorded(releases)).instance.check();
    expect(result).toMatchObject({ latest: '0.3.0', updateAvailable: true });
  });

  it('is silent on a network error', async () => {
    const fetch = vi.fn<FetchLike>(() => Promise.reject(new TypeError('fetch failed')));
    const { instance, log } = checker('0.2.0', fetch);
    await expect(instance.check()).resolves.toEqual({
      current: '0.2.0',
      latest: null,
      updateAvailable: false,
      url: null,
    });
    expect(log).toHaveBeenCalledWith('update check failed: fetch failed');
  });

  it('is silent on an HTTP error (rate limit) and does not cache it', async () => {
    const fetch = recorded(rateLimited, 403);
    const { instance, log } = checker('0.2.0', fetch);
    await expect(instance.check()).resolves.toMatchObject({ latest: null, updateAvailable: false });
    expect(log).toHaveBeenCalledWith('update check: GitHub answered HTTP 403');
    await instance.check();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('is silent on an unexpected body', async () => {
    for (const body of [rateLimited, null, 'x', [{ tag_name: 1 }]]) {
      const result = await checker('0.2.0', recorded(body)).instance.check();
      expect(result).toMatchObject({ latest: null, updateAvailable: false, url: null });
    }
  });

  it('is silent when reading the body fails', async () => {
    const fetch = vi.fn<FetchLike>(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError('bad')),
      }),
    );
    const { instance, log } = checker('0.2.0', fetch);
    await expect(instance.check()).resolves.toMatchObject({ updateAvailable: false });
    expect(log).toHaveBeenCalledWith('update check failed: bad');
  });

  it('aborts a request that hangs and stays silent', async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn<FetchLike>(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      );
      const pending = checker('0.2.0', fetch).instance.check();
      await vi.advanceTimersByTimeAsync(15_000);
      await expect(pending).resolves.toMatchObject({ updateAvailable: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it('never links to a page outside the Thicket releases', async () => {
    const body = [{ ...releases[0], html_url: 'https://evil.example/releases/tag/v0.3.0' }];
    const result = await checker('0.2.0', recorded(body)).instance.check();
    expect(result).toMatchObject({ latest: null, url: null, updateAvailable: false });
  });

  it('shares one request between concurrent checks and caches the answer', async () => {
    const fetch = recorded(releases);
    const { instance, advance } = checker('0.2.0', fetch);
    const [a, b] = await Promise.all([instance.check(), instance.check()]);
    expect(a).toEqual(b);
    await instance.check();
    expect(fetch).toHaveBeenCalledTimes(1);
    advance(UPDATE_CACHE_MS);
    await instance.check();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('UpdateChecker edge cases (test-writer)', () => {
  const page = (tag: string) => `https://github.com/OldPeasant/thicket/releases/tag/${tag}`;
  const entry = (tag: string, extra: Record<string, unknown> = {}) => ({
    tag_name: tag,
    html_url: page(tag),
    draft: false,
    prerelease: false,
    ...extra,
  });

  it('skips a release whose html_url is not a tag page and reports the newest one that is', async () => {
    const download = 'https://github.com/OldPeasant/thicket/releases/download/v0.5.0/Thicket.exe';
    const body = [
      entry('v0.5.0', { html_url: download }),
      entry('v0.4.0', { html_url: 'https://github.com/OldPeasant/thicket/releases/latest' }),
      entry('v0.3.0'),
    ];
    const result = await checker('0.2.0', recorded(body)).instance.check();
    expect(result).toEqual({
      current: '0.2.0',
      latest: '0.3.0',
      updateAvailable: true,
      url: page('v0.3.0'),
    });
  });

  it('picks the newest stable release by version, not by list order or text order', async () => {
    const body = [entry('v0.9.0'), entry('v0.10.0'), entry('v0.2.0')];
    const result = await checker('0.9.0', recorded(body)).instance.check();
    expect(result).toEqual({
      current: '0.9.0',
      latest: '0.10.0',
      updateAvailable: true,
      url: page('v0.10.0'),
    });
  });

  it('an empty release list means no update', async () => {
    const result = await checker('0.2.0', recorded([])).instance.check();
    expect(result).toEqual({ current: '0.2.0', latest: null, updateAvailable: false, url: null });
  });

  it('only pre-releases and drafts: no update and nothing to link', async () => {
    const body = [entry('v1.0.0', { prerelease: true }), entry('v2.0.0', { draft: true })];
    const result = await checker('0.2.0', recorded(body)).instance.check();
    expect(result).toMatchObject({ latest: null, updateAvailable: false, url: null });
  });

  it('a running version that is not semver (dev build) never claims an update', async () => {
    const result = await checker('dev', recorded(releases)).instance.check();
    expect(parseResult(result)).toEqual({
      current: 'dev',
      latest: '0.3.0',
      updateAvailable: false,
      url: page('v0.3.0'),
    });
  });

  it('keeps the cache until exactly UPDATE_CACHE_MS has passed', async () => {
    const fetch = recorded(releases);
    const { instance, advance } = checker('0.2.0', fetch);
    await instance.check();
    advance(UPDATE_CACHE_MS - 1);
    await instance.check();
    expect(fetch).toHaveBeenCalledTimes(1);
    advance(1);
    await instance.check();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('a caller changing its result does not change what others get', async () => {
    const { instance } = checker('0.2.0', recorded(releases));
    const [a, b] = await Promise.all([instance.check(), instance.check()]);
    a.updateAvailable = false;
    a.url = null;
    expect(b).toMatchObject({ updateAvailable: true, url: page('v0.3.0') });
    const c = await instance.check();
    c.latest = 'tampered';
    await expect(instance.check()).resolves.toMatchObject({
      latest: '0.3.0',
      updateAvailable: true,
    });
  });

  it('a shared request that fails answers every caller silently and the next check retries', async () => {
    let fail = true;
    const fetch = vi.fn<FetchLike>(() =>
      fail
        ? Promise.reject(new TypeError('fetch failed'))
        : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(releases) }),
    );
    const { instance } = checker('0.2.0', fetch);
    const results = await Promise.all([instance.check(), instance.check()]);
    expect(results.every((r) => !r.updateAvailable && r.latest === null)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    fail = false;
    await expect(instance.check()).resolves.toMatchObject({ updateAvailable: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('uses the global fetch when none is injected (as main wires it)', async () => {
    const fetch = recorded(releases);
    vi.stubGlobal('fetch', fetch);
    try {
      const instance = new UpdateChecker({ current: '0.2.0', enabled: () => true });
      await expect(instance.check()).resolves.toMatchObject({ updateAvailable: true });
      expect(fetch).toHaveBeenCalledWith(
        RELEASES_API,
        expect.objectContaining({ signal: expect.any(AbortSignal) as unknown }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('with the setting off the global fetch is never called either', async () => {
    const fetch = recorded(releases);
    vi.stubGlobal('fetch', fetch);
    try {
      const instance = new UpdateChecker({ current: '0.2.0', enabled: () => false });
      await instance.check();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('is silent without a log and on a failure that is not an Error', async () => {
    const instance = new UpdateChecker({
      current: '0.2.0',
      enabled: () => true,
      fetch: () => Promise.reject(new Error('offline')),
    });
    await expect(instance.check()).resolves.toMatchObject({ updateAvailable: false });
    const { instance: logged, log } = checker('0.2.0', () =>
      Promise.reject('connection reset' as unknown as Error),
    );
    await expect(logged.check()).resolves.toMatchObject({ updateAvailable: false });
    expect(log).toHaveBeenCalledWith('update check failed: connection reset');
  });

  it('leaves no timeout timer behind after an answer', async () => {
    vi.useFakeTimers();
    try {
      await checker('0.2.0', recorded(releases)).instance.check();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the checkForUpdates setting', () => {
  it('off: no request is made, also not on repeated checks', async () => {
    const fetch = recorded(releases);
    const { instance, advance } = checker('0.2.0', fetch, { enabled: () => false });
    for (let i = 0; i < 3; i++) {
      await instance.check();
      advance(UPDATE_CACHE_MS);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('turned on later: the next check asks GitHub', async () => {
    const fetch = recorded(releases);
    let enabled = false;
    const { instance } = checker('0.2.0', fetch, { enabled: () => enabled });
    await instance.check();
    expect(fetch).not.toHaveBeenCalled();
    enabled = true;
    await expect(instance.check()).resolves.toMatchObject({ updateAvailable: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('off: no request is made', async () => {
    const fetch = recorded(releases);
    const { instance } = checker('0.2.0', fetch, { enabled: () => false });
    await expect(instance.check()).resolves.toEqual({
      current: '0.2.0',
      latest: null,
      updateAvailable: false,
      url: null,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('is read on every check (turned off after a check, also a cached one)', async () => {
    const fetch = recorded(releases);
    let enabled = true;
    const { instance } = checker('0.2.0', fetch, { enabled: () => enabled });
    await expect(instance.check()).resolves.toMatchObject({ updateAvailable: true });
    enabled = false;
    await expect(instance.check()).resolves.toMatchObject({ updateAvailable: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('off: the app.checkForUpdate handler makes no request', async () => {
    const fetch = recorded(releases);
    const handlers = updateHandlers(checker('0.2.0', fetch, { enabled: () => false }).instance);
    const handler = handlers['app.checkForUpdate'] as () => Promise<unknown>;
    await expect(handler()).resolves.toMatchObject({ updateAvailable: false });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('versions', () => {
  const parse = (text: string) => {
    const version = parseVersion(text);
    if (!version) throw new Error(`not a version: ${text}`);
    return version;
  };
  const cmp = (a: string, b: string) => compareVersions(parse(a), parse(b));

  it('parses semantic versions with or without v', () => {
    expect(parseVersion('v1.2.3')).toEqual({ core: [1, 2, 3], pre: [] });
    expect(parseVersion('1.2.3-beta.1+build.5')).toEqual({ core: [1, 2, 3], pre: ['beta', '1'] });
    for (const bad of ['', '1.2', 'v1.2.3.4', 'latest', '1.2.x']) {
      expect(parseVersion(bad)).toBeUndefined();
    }
  });

  it('orders them like semver', () => {
    expect(cmp('0.10.0', '0.9.9')).toBe(1);
    expect(cmp('1.0.0', '1.0.0')).toBe(0);
    expect(cmp('1.0.0-alpha', '1.0.0')).toBe(-1);
    expect(cmp('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1);
    expect(cmp('1.0.0-alpha.1', '1.0.0-alpha.beta')).toBe(-1);
    expect(cmp('1.0.0-beta.2', '1.0.0-beta.11')).toBe(-1);
    expect(cmp('1.0.0-rc.1', '1.0.0-beta.11')).toBe(1);
  });

  it('orders them like semver in both directions (test-writer)', () => {
    expect(cmp('1.0.0-alpha.1', '1.0.0-alpha')).toBe(1);
    expect(cmp('1.0.0-alpha.beta', '1.0.0-alpha.1')).toBe(1);
    expect(cmp('1.0.0-beta', '1.0.0-alpha')).toBe(1);
    expect(cmp('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
    expect(cmp('1.0.0-beta.11', '1.0.0-beta.2')).toBe(1);
    expect(cmp('1.0.0', '1.0.0-rc.1')).toBe(1);
    expect(cmp('1.0.0-rc.1', '1.0.0-rc.1')).toBe(0);
    expect(cmp('0.9.9', '0.10.0')).toBe(-1);
  });

  it('rejects versions whose numbers are beyond safe integers (test-writer)', () => {
    expect(parseVersion('99999999999999999999.0.0')).toBeUndefined();
  });
});

describe('release links', () => {
  it('accepts only https tag pages of the Thicket releases', () => {
    expect(isReleaseUrl('https://github.com/OldPeasant/thicket/releases/tag/v1.0.0')).toBe(true);
    expect(isReleaseUrl('https://github.com/oldpeasant/thicket/releases/tag/v1.0.0')).toBe(true);
    for (const bad of [
      'http://github.com/OldPeasant/thicket/releases/tag/v1.0.0',
      'https://github.com/OldPeasant/thicket-evil/releases/tag/v1',
      'https://github.com/OldPeasant/thicket/releases',
      'https://github.com/OldPeasant/thicket/releases/latest',
      'https://github.com/OldPeasant/thicket/releases/download/v1.0.0/Thicket-1.0.0-x86_64.AppImage',
      'https://github.com/OldPeasant/thicket/releases/tag/../download/v1.0.0/Thicket.exe',
      'https://github.com.evil.example/OldPeasant/thicket/releases/tag/v1',
      'https://user@github.com/OldPeasant/thicket/releases/tag/v1',
      'javascript:alert(1)',
      'not a url',
      42,
    ]) {
      expect(isReleaseUrl(bad)).toBe(false);
    }
  });
});
