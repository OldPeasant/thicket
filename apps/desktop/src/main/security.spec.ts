import { join } from 'node:path/posix';
import { describe, expect, it, vi } from 'vitest';

import {
  blockNavigation,
  blockWebview,
  contentSecurityPolicy,
  denyPermission,
  denyWindowOpen,
  mimeType,
  resolveAppFile,
  secureWebPreferences,
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
  it('denies every window.open', () => {
    expect(denyWindowOpen()).toEqual({ action: 'deny' });
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
});

describe('mimeType', () => {
  it('knows the renderer file types', () => {
    expect(mimeType('/r/index.html')).toBe('text/html; charset=utf-8');
    expect(mimeType('/r/main-X.JS')).toBe('text/javascript; charset=utf-8');
    expect(mimeType('/r/a.woff2')).toBe('font/woff2');
    expect(mimeType('/r/blob')).toBe('application/octet-stream');
  });
});
