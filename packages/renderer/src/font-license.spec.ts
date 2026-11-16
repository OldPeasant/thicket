import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// `ng test` runs from the workspace folder (packages/renderer).
const FONTS = join(process.cwd(), 'src', 'assets', 'fonts');

// The SIL OFL 1.1 requires the copyright notices and the licence text to travel with the fonts,
// in the repository and in the built app.
describe('Tron font licence (SIL OFL 1.1)', () => {
  const ofl = readFileSync(join(FONTS, 'OFL.txt'), 'utf8');

  it('names the copyright holder of each bundled font', () => {
    expect(ofl).toContain(
      'Copyright 2018 The Orbitron Project Authors (https://github.com/theleagueof/orbitron), with Reserved Font Name: "Orbitron".',
    );
    expect(ofl).toContain(
      "Copyright (c) 2012, Carrois Type Design, Ralph du Carrois (post@carrois.com www.carrois.com), with Reserved Font Name 'Share'.",
    );
  });

  it('contains the full licence text', () => {
    expect(ofl).toContain('SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007');
    for (const heading of [
      'PREAMBLE',
      'DEFINITIONS',
      'PERMISSION & CONDITIONS',
      'TERMINATION',
      'DISCLAIMER',
    ]) {
      expect(ofl).toMatch(new RegExp(`^${heading}$`, 'm'));
    }
    for (const condition of ['1)', '2)', '3)', '4)', '5)']) {
      expect(ofl).toMatch(new RegExp(`^${condition.replace(')', '\\)')} `, 'm'));
    }
    expect(ofl).toMatch(/OTHER DEALINGS IN THE FONT SOFTWARE\.\s*$/);
  });

  it('is copied into the build output next to the bundled fonts', () => {
    const angular = JSON.parse(readFileSync(join(process.cwd(), 'angular.json'), 'utf8'));
    const assets = Object.values<{ architect: { build: { options: { assets: unknown[] } } } }>(
      angular.projects,
    ).flatMap((p) => p.architect.build.options.assets);
    expect(assets).toContainEqual({ glob: 'OFL.txt', input: 'src/assets/fonts', output: 'media' });
  });
});
