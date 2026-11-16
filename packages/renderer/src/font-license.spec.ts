import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
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

  it('has a copyright entry for every font file in the folder', () => {
    const fonts = readdirSync(FONTS).filter((f) => /\.(woff2?|ttf|otf)$/i.test(f));
    expect(fonts.length).toBeGreaterThan(0);
    for (const font of fonts) expect(ofl, font).toContain(`(${font}):\nCopyright`);
  });

  it('quotes the copyright notice embedded in each font file verbatim', () => {
    for (const font of readdirSync(FONTS).filter((f) => f.endsWith('.woff2'))) {
      const embedded = woff2Copyright(readFileSync(join(FONTS, font)));
      expect(embedded, font).toMatch(/^Copyright /);
      // The whole line under the font's heading, so a truncated notice cannot match.
      expect(ofl, font).toContain(`(${font}):\n${embedded}\n`);
    }
  });

  it('is copied into the build output next to the bundled fonts', () => {
    const angular = JSON.parse(readFileSync(join(process.cwd(), 'angular.json'), 'utf8'));
    const assets = Object.values<{ architect: { build: { options: { assets: unknown[] } } } }>(
      angular.projects,
    ).flatMap((p) => p.architect.build.options.assets);
    expect(assets).toContainEqual({ glob: 'OFL.txt', input: 'src/assets/fonts', output: 'media' });
  });
});

/**
 * Reads the copyright notice (name ID 0) from a WOFF2 file's `name` table (WOFF2 spec section 5,
 * OpenType `name` table), so the test compares OFL.txt with what the shipped fonts actually say.
 */
function woff2Copyright(buf: Buffer): string {
  if (buf.toString('latin1', 0, 4) !== 'wOF2') throw new Error('not a WOFF2 file');
  const numTables = buf.readUInt16BE(12);
  const compressedSize = buf.readUInt32BE(20);
  let pos = 48;
  const base128 = (): number => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = buf[pos++] ?? 0;
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
    throw new Error('invalid UIntBase128');
  };
  const NAME = 5; // known-tag index of 'name'
  let nameOffset = -1;
  let nameLength = 0;
  let streamOffset = 0;
  for (let i = 0; i < numTables; i++) {
    const flags = buf[pos++] ?? 0;
    const tag = flags & 0x3f;
    if (tag === 63) pos += 4;
    const origLength = base128();
    const version = flags >> 6;
    // glyf (10) / loca (11) are transformed with version 0; other tables with versions 1-3.
    const transformed = tag === 10 || tag === 11 ? version === 0 : version !== 0;
    const length = transformed ? base128() : origLength;
    if (tag === NAME) [nameOffset, nameLength] = [streamOffset, length];
    streamOffset += length;
  }
  if (nameOffset < 0) throw new Error('no name table');
  const data = brotliDecompressSync(buf.subarray(pos, pos + compressedSize));
  const name = data.subarray(nameOffset, nameOffset + nameLength);
  const count = name.readUInt16BE(2);
  const storage = name.readUInt16BE(4);
  for (let r = 0; r < count; r++) {
    const rec = 6 + r * 12;
    const [platform, nameId] = [name.readUInt16BE(rec), name.readUInt16BE(rec + 6)];
    if (nameId !== 0) continue;
    const [length, offset] = [name.readUInt16BE(rec + 8), name.readUInt16BE(rec + 10)];
    const raw = Buffer.from(name.subarray(storage + offset, storage + offset + length));
    // Windows (3) and Unicode (0) platforms store UTF-16BE; Macintosh (1) stores single bytes.
    return platform === 1 ? raw.toString('latin1') : raw.swap16().toString('utf16le');
  }
  throw new Error('no copyright record');
}
