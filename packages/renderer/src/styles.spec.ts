import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// `ng test` runs from the workspace folder (packages/renderer).
const SRC = join(process.cwd(), 'src');
const STYLES = join(SRC, 'styles.css');

// The renderer CSP allows fonts only from 'self' (see no-network.spec.ts), which blocks data:
// URLs. The Tron fonts therefore ship as files next to the styles and are bundled by the build.
describe('global styles: Tron fonts', () => {
  const css = readFileSync(STYLES, 'utf8');
  const fontFaces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1] ?? '');
  const urls = [...css.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/g)].map((m) => m[2] ?? '');

  it('embeds no data: URLs or base64 payloads, which font-src self would block', () => {
    expect(css).not.toMatch(/url\(\s*["']?\s*data:/i);
    expect(css).not.toMatch(/;base64,/i);
  });

  it('declares Orbitron and Share Tech Mono, each from a woff2 file', () => {
    const families = fontFaces.map((body) => /font-family:\s*'([^']+)'/.exec(body)?.[1]);
    expect(families).toEqual(['Orbitron', 'Share Tech Mono']);
    for (const body of fontFaces) {
      expect(body).toMatch(
        /src:\s*url\(\s*'\.\/assets\/fonts\/[a-z-]+\.woff2'\s*\)\s*format\('woff2'\)/,
      );
    }
  });

  it('points every url() at an existing woff2 font file under src/', () => {
    expect(urls).toHaveLength(2);
    for (const url of urls) {
      const file = resolve(dirname(STYLES), url);
      // Stays inside src/ so the build bundles it (no ../ escapes, no absolute or remote paths).
      expect(relative(SRC, file).startsWith('..')).toBe(false);
      expect(url).not.toMatch(/^(?:[a-z]+:|\/)/i);
      expect(existsSync(file), url).toBe(true);
      expect(statSync(file).size).toBeGreaterThan(1000);
      // WOFF2 files start with the signature "wOF2".
      expect(readFileSync(file).subarray(0, 4).toString('latin1'), url).toBe('wOF2');
    }
  });

  it('uses the declared families in the (Tron) font tokens', () => {
    const tokens = readFileSync(join(SRC, 'app', 'theme', 'tokens.css'), 'utf8');
    expect(tokens).toMatch(/--font-[a-z-]+:\s*'Orbitron'/);
    expect(tokens).toMatch(/--font-[a-z-]+:\s*'Share Tech Mono'/);
  });
});
