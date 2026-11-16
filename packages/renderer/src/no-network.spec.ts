import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// `ng test` runs from the workspace folder (packages/renderer).
const SRC = join(process.cwd(), 'src');

function files(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path, pattern);
    return pattern.test(entry.name) ? [path] : [];
  });
}

// Remote or protocol-relative URLs in places the browser would fetch them. Attributes may be
// Angular bindings (`[src]="'https://...'"`, a string literal inside the bound expression), and
// `srcset` may name the remote URL in any of its comma-separated candidates.
const REMOTE =
  /(?:\b(?:src|href)\]?\s*=\s*["']?'?|\bsrcset\]?\s*=\s*["']?'?(?:[^"'>]*?,\s*)?|url\(\s*["']?|@import\s+["']?)(?:https?:)?\/\//i;

describe('no external network resources', () => {
  // Templates and inline styles of components live in .ts files too.
  const sources = files(SRC, /(?<!\.spec)\.(?:html|css|scss|ts)$/);

  it('finds the entry HTML and global styles', () => {
    const names = sources.map((path) => relative(SRC, path));
    expect(names).toContain('index.html');
    expect(names).toContain('styles.css');
  });

  it.each(sources.map((path) => [relative(SRC, path), path]))(
    '%s loads nothing from the network',
    (_name, path) => {
      expect(readFileSync(path, 'utf8')).not.toMatch(REMOTE);
    },
  );

  // The guard is only as good as REMOTE: check that it flags the usual ways a CDN sneaks in,
  // and that it leaves local references alone (otherwise the per-file test would be noise).
  it.each([
    [
      'Google Fonts <link>',
      '<link href="https://fonts.googleapis.com/css2?family=Orbitron" rel="stylesheet">',
    ],
    ['preconnect <link>', "<link rel='preconnect' href='https://fonts.gstatic.com'>"],
    ['CDN <script>', '<script src="https://cdn.example.test/lib.js"></script>'],
    ['unquoted attribute', '<img src=https://img.example.test/logo.png>'],
    ['plain http', '<img src="http://img.example.test/logo.png">'],
    ['protocol-relative src', '<script src="//cdn.example.test/lib.js"></script>'],
    ['spaces around =', '<a href = "https://example.test/">x</a>'],
    ['upper-case attribute', '<IMG SRC="HTTPS://img.example.test/x.png">'],
    ['url() unquoted', '@font-face { src: url(https://fonts.example.test/x.woff2); }'],
    ['url() quoted', 'body { background: url( "https://img.example.test/bg.png" ); }'],
    ['@import string', '@import "https://fonts.googleapis.com/css2?family=Share+Tech+Mono";'],
    ['@import protocol-relative', "@import '//cdn.example.test/reset.css';"],
    ['@import url()', '@import url(//cdn.example.test/reset.css);'],
    ['inline template in a .ts file', 'template: `<img src="https://img.example.test/a.png">`'],
    ['Angular [src] binding to a literal', `<img [src]="'https://cdn.example.test/a.png'">`],
    ['Angular [attr.href] binding', `<link [attr.href]="'//cdn.example.test/x.css'">`],
    ['srcset', '<img srcset="https://img.example.test/a.png 2x">'],
    ['srcset second candidate', '<img srcset="a.png 1x, https://img.example.test/b.png 2x">'],
    ['Angular [srcset] binding', `<img [srcset]="'https://img.example.test/a.png 2x'">`],
  ])('REMOTE flags %s', (_name, text) => {
    expect(text).toMatch(REMOTE);
  });

  it.each([
    ['relative src', '<script src="main.js" type="module"></script>'],
    ['relative href', '<link rel="stylesheet" href="./styles.css">'],
    ['base href', '<base href="./" />'],
    ['bundled font url()', "@font-face { src: url('./media/orbitron.woff2'); }"],
    ['data: url()', 'body { background: url(data:image/png;base64,AAAA); }'],
    ['local @import', "@import './theme.css';"],
    ['URL in a comment', '// See https://angular.dev/guide/zoneless'],
    ['CSP text', "default-src 'self'; script-src 'self'"],
    ['Angular [src] binding to a field', '<img [src]="logoUrl">'],
    ['Angular [src] binding to a local literal', `<img [src]="'./media/logo.png'">`],
    ['local srcset', '<img srcset="logo.png 1x, logo@2x.png 2x">'],
  ])('REMOTE leaves %s alone', (_name, text) => {
    expect(text).not.toMatch(REMOTE);
  });

  it('the CSP only allows the app itself', () => {
    const html = readFileSync(join(SRC, 'index.html'), 'utf8');
    expect(html).toMatch(/<base href="\.\/"/);
    expect(html).toMatch(/default-src 'self'; script-src 'self';/);
  });

  it('the CSP names no remote source and keeps fonts local', () => {
    const html = readFileSync(join(SRC, 'index.html'), 'utf8');
    const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html)?.[1];
    expect(csp).toBeDefined();
    expect(csp).toMatch(/font-src 'self'(;|$)/);
    expect(csp).not.toMatch(/https?:|\/\/|\*/);
  });
});
