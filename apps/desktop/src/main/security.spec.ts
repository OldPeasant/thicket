import { join } from 'node:path/posix';
import { describe, expect, it, vi } from 'vitest';

import {
  blockNavigation,
  blockWebview,
  contentSecurityPolicy,
  denyPermission,
  mimeType,
  resolveAppFile,
  secureWebPreferences,
  windowOpenHandler,
  withCspHeader,
} from './security';

describe('secureWebPreferences', () => {
  it('sandboxes the renderer, isolates the context and disables Node', () => {
    const prefs = secureWebPreferences('/app/preload.cjs');
    expect(prefs).toMatchObject({
      preload: '/app/preload.cjs',
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    });
  });
});

describe('contentSecurityPolicy', () => {
  it("is default-src 'self'; script-src 'self' without eval or remote origins", () => {
    const csp = contentSecurityPolicy();
    const directives = csp.split('; ');
    expect(directives).toContain("default-src 'self'");
    expect(directives).toContain("script-src 'self'");
    expect(directives).toContain("object-src 'none'");
    expect(directives).toContain("connect-src 'self'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toMatch(/https?:/);
  });

  it('allows only the dev server live-reload socket in dev', () => {
    const csp = contentSecurityPolicy('http://localhost:4200');
    expect(csp).toContain("connect-src 'self' ws://localhost:4200 wss://localhost:4200");
    expect(csp).toContain("script-src 'self'");
  });
});

describe('withCspHeader', () => {
  it('replaces any CSP header in any letter case and keeps the others', () => {
    const headers = withCspHeader(
      { 'content-security-policy': ['x'], 'Content-Type': 'text/html', Vary: ['a', 'b'] },
      'csp',
    );
    expect(headers).toEqual({
      'Content-Type': ['text/html'],
      Vary: ['a', 'b'],
      'Content-Security-Policy': ['csp'],
    });
  });

  it('adds the header when there are none', () => {
    expect(withCspHeader(undefined, 'csp')).toEqual({ 'Content-Security-Policy': ['csp'] });
  });
});

describe('window.open and navigation', () => {
  it('denies every window.open and opens nothing for non-release URLs', () => {
    const openExternal = vi.fn(() => Promise.resolve());
    for (const url of [
      'thicket://app/index.html',
      'https://evil.test/',
      'https://github.com/OldPeasant/thicket/releases/download/v1.0.0/Thicket-1.0.0.exe',
    ]) {
      expect(windowOpenHandler(url, openExternal)).toEqual({ action: 'deny' });
    }
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('blocks navigation to other pages', () => {
    const event = { preventDefault: vi.fn() };
    expect(blockNavigation(event, 'https://evil.test/', 'thicket://app/index.html')).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('blocks navigation when the URL is unknown or unparsable', () => {
    const a = { preventDefault: vi.fn() };
    expect(blockNavigation(a)).toBe(true);
    expect(a.preventDefault).toHaveBeenCalled();
    const b = { preventDefault: vi.fn() };
    expect(blockNavigation(b, 'not a url', 'thicket://app/index.html')).toBe(true);
    expect(b.preventDefault).toHaveBeenCalled();
  });

  it('lets a same-document (fragment only) change through', () => {
    const event = { preventDefault: vi.fn() };
    expect(blockNavigation(event, 'thicket://app/index.html#x', 'thicket://app/index.html')).toBe(
      false,
    );
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('blocks a navigation that only changes the query, path or origin of the page', () => {
    const current = 'thicket://app/index.html';
    for (const url of [
      'thicket://app/index.html?x=1',
      'thicket://app/other.html',
      'thicket://evil/index.html',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'http://localhost:4200/index.html',
    ]) {
      const event = { preventDefault: vi.fn() };
      expect(blockNavigation(event, url, current)).toBe(true);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
    }
  });

  it('blocks navigation when only one of the URLs is known or the current page is unparsable', () => {
    const a = { preventDefault: vi.fn() };
    expect(blockNavigation(a, 'thicket://app/index.html')).toBe(true);
    expect(a.preventDefault).toHaveBeenCalled();
    const b = { preventDefault: vi.fn() };
    expect(blockNavigation(b, 'thicket://app/index.html', '')).toBe(true);
    expect(b.preventDefault).toHaveBeenCalled();
  });

  it('lets a hash change on the dev server through as well', () => {
    const event = { preventDefault: vi.fn() };
    expect(blockNavigation(event, 'http://localhost:4200/#/a', 'http://localhost:4200/#/b')).toBe(
      false,
    );
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('blocks webviews and refuses all permissions', () => {
    const event = { preventDefault: vi.fn() };
    blockWebview(event);
    expect(event.preventDefault).toHaveBeenCalled();
    const callback = vi.fn();
    denyPermission({}, 'media', callback);
    expect(callback).toHaveBeenCalledWith(false);
  });
});

describe('resolveAppFile', () => {
  const root = '/r';
  it('maps thicket://app paths below the root', () => {
    expect(resolveAppFile('thicket://app/index.html', root, join)).toBe('/r/index.html');
    expect(resolveAppFile('thicket://app/media/a.woff2', root, join)).toBe('/r/media/a.woff2');
    expect(resolveAppFile('thicket://app/', root, join)).toBe('/r/index.html');
    expect(resolveAppFile('thicket://app/collections/x', root, join)).toBe('/r/index.html');
  });

  it('refuses other hosts, schemes and escapes', () => {
    expect(resolveAppFile('thicket://other/index.html', root, join)).toBeUndefined();
    expect(resolveAppFile('https://app/index.html', root, join)).toBeUndefined();
    expect(resolveAppFile('thicket://app/%2e%2e/secret.txt', root, join)).toBe('/r/secret.txt');
    expect(resolveAppFile('thicket://app/a%2F..%2F..%2Fx.txt', root, join)).toBeUndefined();
    expect(resolveAppFile('thicket://app/a%5C..%5Cx.txt', root, join)).toBeUndefined();
    expect(resolveAppFile('thicket://app/%E0%A4%A.txt', root, join)).toBeUndefined();
    expect(resolveAppFile('::nope', root, join)).toBeUndefined();
  });

  it('refuses null bytes and dot segments in any position', () => {
    expect(resolveAppFile('thicket://app/a%00.js', root, join)).toBeUndefined();
    expect(resolveAppFile('thicket://app/media%2F%2E%2E%2Fx.js', root, join)).toBeUndefined();
    expect(resolveAppFile('thicket://app/media%2F.%2Fx.js', root, join)).toBeUndefined();
    expect(resolveAppFile('thicket://app/..%5C..%5Cwin.ini', root, join)).toBeUndefined();
  });

  it('never resolves outside the root (URL parsing folds literal dot segments first)', () => {
    expect(resolveAppFile('thicket://app/../../etc/passwd', root, join)).toBe('/r/index.html');
    expect(resolveAppFile('thicket://app/%2e%2e/%2e%2e/etc/x.txt', root, join)).toBe(
      '/r/etc/x.txt',
    );
    expect(resolveAppFile('thicket://app/a/../../b.js', root, join)).toBe('/r/b.js');
    expect(resolveAppFile('thicket://app//etc/passwd.txt', root, join)).toBe('/r/etc/passwd.txt');
    expect(resolveAppFile('thicket://app/media/%2e/x.js', root, join)).toBe('/r/media/x.js');
  });

  it('ignores the query and fragment of a file URL', () => {
    expect(resolveAppFile('thicket://app/main.js?v=1#x', root, join)).toBe('/r/main.js');
  });
});

describe('contentSecurityPolicy (more)', () => {
  it('forbids framing, plugins and form posts', () => {
    const directives = contentSecurityPolicy().split('; ');
    expect(directives).toEqual(
      expect.arrayContaining([
        "frame-ancestors 'none'",
        "frame-src 'none'",
        "form-action 'none'",
        "base-uri 'self'",
      ]),
    );
  });

  it('dev mode only widens connect-src, not scripts', () => {
    const prod = contentSecurityPolicy().split('; ');
    const dev = contentSecurityPolicy('http://127.0.0.1:4200/some/path').split('; ');
    const differ = dev.filter((d) => !prod.includes(d));
    expect(differ).toEqual(["connect-src 'self' ws://127.0.0.1:4200 wss://127.0.0.1:4200"]);
  });
});

describe('withCspHeader (more)', () => {
  it('normalises single string values to arrays and replaces an upper-case CSP header', () => {
    expect(
      withCspHeader({ 'CONTENT-SECURITY-POLICY': 'default-src *', 'X-A': 'b' }, 'csp'),
    ).toEqual({ 'X-A': ['b'], 'Content-Security-Policy': ['csp'] });
  });
});

describe('mimeType', () => {
  it('knows the renderer file types', () => {
    expect(mimeType('/r/index.html')).toBe('text/html; charset=utf-8');
    expect(mimeType('/r/main-X.JS')).toBe('text/javascript; charset=utf-8');
    expect(mimeType('/r/a.woff2')).toBe('font/woff2');
    expect(mimeType('/r/blob')).toBe('application/octet-stream');
    expect(mimeType('/r/styles.css')).toBe('text/css; charset=utf-8');
    expect(mimeType('/r/a.exe')).toBe('application/octet-stream');
  });
});

describe('windowOpenHandler: update notice release link', () => {
  it('opens a release page externally and denies every window', () => {
    const openExternal = vi.fn(() => Promise.resolve());
    const page = 'https://github.com/OldPeasant/thicket/releases/tag/v1.0.0';
    expect(windowOpenHandler(page, openExternal)).toEqual({ action: 'deny' });
    expect(openExternal).toHaveBeenCalledWith(page);
    expect(windowOpenHandler('https://evil.example/', openExternal)).toEqual({ action: 'deny' });
    expect(openExternal).toHaveBeenCalledTimes(1);
  });

  it('logs when the browser cannot be opened', async () => {
    const log = vi.fn();
    windowOpenHandler(
      'https://github.com/OldPeasant/thicket/releases/tag/v1.0.0',
      () => Promise.reject(new Error('no browser')),
      log,
    );
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith(expect.stringContaining('no browser')));
  });

  it('opens nothing for non-tag release URLs, http or a path escaping /releases/tag/ (test-writer)', () => {
    const openExternal = vi.fn(() => Promise.resolve());
    for (const url of [
      'https://github.com/OldPeasant/thicket/releases/latest',
      'https://github.com/OldPeasant/thicket/releases/tag/../download/v1.0.0/Thicket.exe',
      'http://github.com/OldPeasant/thicket/releases/tag/v1.0.0',
      'https://user@github.com/OldPeasant/thicket/releases/tag/v1.0.0',
      'not a url',
    ]) {
      expect(windowOpenHandler(url, openExternal)).toEqual({ action: 'deny' });
    }
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('a browser failure without a log is swallowed (test-writer)', async () => {
    let rejected = false;
    const openExternal = () => {
      rejected = true;
      return Promise.reject(new Error('no browser'));
    };
    const page = 'https://github.com/OldPeasant/thicket/releases/tag/v1.0.0';
    expect(windowOpenHandler(page, openExternal)).toEqual({ action: 'deny' });
    await Promise.resolve();
    await Promise.resolve();
    expect(rejected).toBe(true);
  });
});
