import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// `ng test` runs from the workspace folder (packages/renderer).
const TOKENS = join(process.cwd(), 'src', 'app', 'theme', 'tokens.css');
const css = readFileSync(TOKENS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

type TokenSet = Map<string, string>;

/** Top-level rule blocks: selector -> custom properties (no nesting in tokens.css). */
function parseBlocks(source: string): Map<string, TokenSet> {
  const blocks = new Map<string, TokenSet>();
  for (const match of source.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selectors = (match[1] ?? '').split(',').map((s) => s.trim().replace(/\s+/g, ' '));
    const tokens: TokenSet = new Map();
    for (const decl of (match[2] ?? '').split(';')) {
      const m = /^\s*(--[a-z0-9-]+)\s*:\s*([\s\S]+?)\s*$/.exec(decl);
      if (m?.[1] && m[2]) tokens.set(m[1], m[2].replace(/\s+/g, ' '));
    }
    for (const selector of selectors) blocks.set(selector, tokens);
  }
  return blocks;
}

const blocks = parseBlocks(css);

const COMBOS = [
  { style: 'business', theme: 'light' },
  { style: 'business', theme: 'dark' },
  { style: 'tron', theme: 'light' },
  { style: 'tron', theme: 'dark' },
] as const;

function set(style: string, theme: string): TokenSet {
  const tokens = blocks.get(`:root[data-style='${style}'][data-theme='${theme}']`);
  if (!tokens) throw new Error(`no token block for ${style}/${theme}`);
  return tokens;
}

/** Value of `name`, following `var(--other)` references inside the same set. */
function resolve(tokens: TokenSet, name: string, depth = 0): string {
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`${name} is not defined`);
  const ref = /^var\((--[a-z0-9-]+)\)$/.exec(value);
  if (ref?.[1] && depth < 10) return resolve(tokens, ref[1], depth + 1);
  return value;
}

function rgb(color: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (!hex?.[1]) throw new Error(`not an opaque #rrggbb color: ${color}`);
  const n = parseInt(hex[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG 2.x relative luminance and contrast ratio. */
function luminance(color: string): number {
  const [r, g, b] = rgb(color).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** BSON type aliases (`$type` names) and the token each one uses. */
const BSON_TYPES = [
  'double',
  'string',
  'object',
  'array',
  'binData',
  'undefined',
  'objectId',
  'bool',
  'date',
  'null',
  'regex',
  'dbPointer',
  'javascript',
  'symbol',
  'int',
  'timestamp',
  'long',
  'decimal',
  'minKey',
  'maxKey',
] as const;
const bsonToken = (type: string) =>
  `--bson-${type.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

const BACKGROUNDS = ['--bg-page', '--bg-elevated', '--bg-panel', '--bg-input'];
const TEXT_ON_ANY_BG = [
  '--text',
  '--text-muted',
  '--text-faint',
  '--accent',
  '--danger',
  '--production',
  '--readonly',
  ...BSON_TYPES.map(bsonToken),
];
const PAIRS: [string, string][] = [
  ...TEXT_ON_ANY_BG.flatMap((fg) => BACKGROUNDS.map((bg): [string, string] => [fg, bg])),
  ['--text', '--bg-hover'],
  ['--text-muted', '--bg-hover'],
  ['--text', '--accent-bg'],
  ['--accent', '--accent-bg'],
  ['--accent-contrast', '--accent'],
  ['--danger-text', '--danger-bg'],
  ['--production-text', '--production-bg'],
  ['--readonly-text', '--readonly-bg'],
];

describe('theme tokens: four complete sets', () => {
  it('has exactly one block per style x mode, plus :root as the Business light fallback', () => {
    for (const { style, theme } of COMBOS) expect(set(style, theme).size).toBeGreaterThan(50);
    expect(blocks.get(':root')).toBe(set('business', 'light'));
  });

  it('defines the same token names in all four sets', () => {
    const names = (s: TokenSet) => [...s.keys()].sort();
    const reference = names(set('business', 'light'));
    for (const { style, theme } of COMBOS) {
      expect(names(set(style, theme)), `${style}/${theme}`).toEqual(reference);
    }
  });

  for (const { style, theme } of COMBOS) {
    it(`${style}/${theme}: production accent, read-only marker and every BSON type`, () => {
      const tokens = set(style, theme);
      const required = [
        '--production',
        '--production-bg',
        '--production-text',
        '--readonly',
        '--readonly-bg',
        '--readonly-text',
        ...BSON_TYPES.map(bsonToken),
      ];
      for (const name of required) {
        expect(() => rgb(resolve(tokens, name)), `${style}/${theme} ${name}`).not.toThrow();
      }
    });
  }

  it('gives each BSON type of a set a token (20 types, $type aliases)', () => {
    expect(BSON_TYPES).toHaveLength(20);
    expect(new Set(BSON_TYPES.map(bsonToken)).size).toBe(20);
    expect(bsonToken('objectId')).toBe('--bson-object-id');
  });

  it('keeps the explorer value aliases pointing at BSON type tokens', () => {
    for (const { style, theme } of COMBOS) {
      const tokens = set(style, theme);
      expect(tokens.get('--val-str')).toBe('var(--bson-string)');
      expect(tokens.get('--val-num')).toBe('var(--bson-double)');
      expect(tokens.get('--val-bool')).toBe('var(--bson-bool)');
      expect(tokens.get('--val-null')).toBe('var(--bson-null)');
    }
  });

  it('distinguishes the production accent from the regular accent', () => {
    for (const { style, theme } of COMBOS) {
      const tokens = set(style, theme);
      expect(resolve(tokens, '--production')).not.toBe(resolve(tokens, '--accent'));
    }
  });
});

describe('Business: WCAG AA contrast (4.5:1) for text/background token pairs', () => {
  it('computes ratios correctly (sanity)', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });

  for (const theme of ['light', 'dark'] as const) {
    it(`business/${theme}: every pair >= 4.5`, () => {
      const tokens = set('business', theme);
      const failures = PAIRS.map(([fg, bg]) => ({
        pair: `${fg} on ${bg}`,
        ratio: contrast(resolve(tokens, fg), resolve(tokens, bg)),
      })).filter((r) => r.ratio < 4.5);
      expect(failures).toEqual([]);
    });

    it(`business/${theme}: the focus ring stands out (>= 3:1, non-text contrast)`, () => {
      const tokens = set('business', theme);
      for (const bg of BACKGROUNDS) {
        expect(contrast(resolve(tokens, '--focus'), resolve(tokens, bg))).toBeGreaterThanOrEqual(3);
      }
    });
  }
});

describe('Tron keeps the Canopy look; Business has no effects', () => {
  const EFFECTS = ['--glow', '--glow-strong', '--grid-overlay', '--scanline-overlay'];

  it('Business: no glow, grid or scanlines, system UI font, no uppercase headings', () => {
    for (const theme of ['light', 'dark']) {
      const tokens = set('business', theme);
      for (const name of [...EFFECTS, '--scrollbar-glow']) expect(tokens.get(name)).toBe('none');
      expect(tokens.get('--font-ui')).toMatch(/^system-ui/);
      expect(tokens.get('--font-ui')).not.toMatch(/Orbitron|Share Tech/);
      expect(tokens.get('--font-mono')).not.toMatch(/Share Tech/);
      expect(tokens.get('--heading-transform')).toBe('none');
    }
  });

  it('Tron: glow, grid and scanlines, Orbitron and Share Tech Mono', () => {
    for (const theme of ['light', 'dark']) {
      const tokens = set('tron', theme);
      expect(tokens.get('--glow')).toMatch(/currentColor/);
      expect(tokens.get('--glow-strong')).toMatch(/currentColor/);
      expect(tokens.get('--grid-overlay')).toMatch(/linear-gradient/);
      expect(tokens.get('--scanline-overlay')).toMatch(/repeating-linear-gradient/);
      expect(tokens.get('--font-ui')).toMatch(/^'Orbitron'/);
      expect(tokens.get('--font-mono')).toMatch(/^'Share Tech Mono'/);
      expect(tokens.get('--heading-transform')).toBe('uppercase');
    }
  });

  it("Tron keeps Canopy's original colors", () => {
    const dark = set('tron', 'dark');
    expect(dark.get('--bg-page')).toBe('#030608');
    expect(dark.get('--accent')).toBe('#00e5ff');
    expect(resolve(dark, '--val-str')).toBe('#4dffb8');
    expect(resolve(dark, '--val-bool')).toBe('#ff8a00');
    const light = set('tron', 'light');
    expect(light.get('--bg-page')).toBe('#f3f7f9');
    expect(light.get('--accent')).toBe('#0891b2');
    expect(resolve(light, '--val-str')).toBe('#047857');
  });

  it('uses no literal colors in the global styles outside the token file', () => {
    const styles = readFileSync(join(process.cwd(), 'src', 'styles.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    expect(styles).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    expect(styles).toMatch(/@import '\.\/app\/theme\/tokens\.css';/);
  });
});
