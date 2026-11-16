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

// Remote or protocol-relative URLs in places the browser would fetch them.
const REMOTE = /(?:\b(?:src|href)\s*=\s*["']?|url\(\s*["']?|@import\s+["']?)(?:https?:)?\/\//i;

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

  it('the CSP only allows the app itself', () => {
    const html = readFileSync(join(SRC, 'index.html'), 'utf8');
    expect(html).toMatch(/<base href="\.\/"/);
    expect(html).toMatch(/default-src 'self'; script-src 'self';/);
  });
});
