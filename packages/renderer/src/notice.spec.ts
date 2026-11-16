import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// `ng test` runs from the workspace folder (packages/renderer); NOTICE lives at the repo root.
const ROOT = join(process.cwd(), '..', '..');
const notice = readFileSync(join(ROOT, 'NOTICE'), 'utf8');
// NOTICE wraps lines; compare on single-spaced text so a reflow does not break the checks.
const text = notice.replace(/\s+/g, ' ');

// Apache-2.0 section 4: the copied JSON Canopy code keeps its attribution, and the modified
// files say that they were modified.
describe('root NOTICE: JSON Canopy attribution', () => {
  it('names JSON Canopy, Sonensei.ch and the Apache License 2.0 as origin of the explorer', () => {
    expect(text).toContain('JSON Canopy');
    expect(text).toContain('Copyright 2026 Sonensei.ch');
    expect(text).toContain('Apache License, Version 2.0');
    expect(text).toMatch(/JSON explorer \(packages\/renderer\/src\/app\/explorer\)/);
  });

  it('does not claim a Thicket copyright holder of its own', () => {
    // The header (before the JSON Canopy origin paragraph) names the product only; the copyright
    // lines further down belong to JSON Canopy.
    const header = notice.split('The JSON explorer')[0] ?? '';
    expect(header.split('\n')[0]).toBe('Thicket');
    expect(header).not.toMatch(/copyright/i);
    expect(text).not.toMatch(/Copyright \d{4} Thicket/i);
  });

  it('states that the JSON Canopy files were modified for Thicket', () => {
    expect(text).toMatch(/files were modified for Thicket/);
    expect(text).toMatch(/host bridge was removed/);
    expect(text).toMatch(/fonts were extracted into separate font files/);
  });

  it('keeps the original JSON Canopy NOTICE text', () => {
    expect(notice).toMatch(
      /The original JSON Canopy NOTICE reads:\n\n {2}JSON Canopy\n {2}Copyright 2026 Sonensei\.ch/,
    );
  });

  it('lists the bundled fonts under the SIL OFL with their current location', () => {
    expect(text).toMatch(/Orbitron and Share Tech Mono webfonts \(SIL Open Font License 1\.1\)/);
    expect(text).not.toMatch(/inlined in/);
  });

  it('refers only to repository paths that exist', () => {
    const paths = [...notice.matchAll(/packages\/[\w./-]+[\w/]/g)].map((m) => m[0]);
    expect(paths).toEqual(
      expect.arrayContaining([
        'packages/renderer/src/app/explorer',
        'packages/renderer/src/app/schema',
        'packages/renderer/src/styles.css',
        'packages/renderer/src/assets/fonts',
        'packages/renderer/src/assets/samples/canopy-demo.json',
      ]),
    );
    for (const path of paths) expect(existsSync(join(ROOT, path)), path).toBe(true);
    expect(notice).not.toMatch(/vendor\/|json-master-plugin/);
  });
});
