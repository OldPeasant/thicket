import type { SchemaField } from '@thicket/contract';
import type { BsonValue } from '@thicket/core/bson';
import { parseShellSyntaxDocument } from '@thicket/core/shellsyntax';
import { describe, expect, it } from 'vitest';

import {
  EXAMPLE_TEXT_LIMIT,
  filterKeyOf,
  percent,
  schemaRows,
  typeColor,
  typeCondition,
  withFilterField,
} from './schema-analysis.model';

const str = (value: string): BsonValue => ({ type: 'string', value });
const int = (value: number): BsonValue => ({ type: 'int', value });

/** The keys of a printed filter and the shell-syntax value of each. */
function keysOf(filter: string): string[] {
  return parseShellSyntaxDocument(filter).fields.map((f) => f.key);
}
function valueOf(filter: string, key: string): BsonValue | undefined {
  return parseShellSyntaxDocument(filter).fields.find((f) => f.key === key)?.value;
}

describe('filterKeyOf', () => {
  it.each([
    ['name', 'name'],
    ['a.b.c', 'a.b.c'],
    ['tags.[]', 'tags'],
    ['items.[].name', 'items.name'],
    ['m.[].[].x', 'm.x'],
  ])('%s → %s', (path, key) => {
    expect(filterKeyOf(path)).toBe(key);
  });
});

describe('typeColor', () => {
  it.each([
    ['string', 'string'],
    ['int', 'int'],
    ['long', 'long'],
    ['double', 'double'],
    ['decimal', 'decimal'],
    ['bool', 'bool'],
    ['date', 'date'],
    ['null', 'null'],
    ['object', 'object'],
    ['array', 'array'],
    ['regex', 'regex'],
    ['timestamp', 'timestamp'],
    ['symbol', 'symbol'],
    ['undefined', 'undefined'],
    ['javascript', 'javascript'],
    ['objectId', 'object-id'],
    ['binData', 'bin-data'],
    ['minKey', 'min-key'],
    ['maxKey', 'max-key'],
    ['dbPointer', 'db-pointer'],
    ['javascriptWithScope', 'javascript'],
  ])('%s uses the --bson-%s theme token, muted text as fallback', (bsonType, token) => {
    expect(typeColor(bsonType)).toBe(`var(--bson-${token}, var(--text-muted))`);
  });

  it('kebab-cases an unknown camelCase alias', () => {
    expect(typeColor('fooBarBaz')).toBe('var(--bson-foo-bar-baz, var(--text-muted))');
  });
});

describe('percent', () => {
  it.each([
    [0, '0 %'],
    [1, '100 %'],
    [0.5, '50 %'],
    [0.375, '37.5 %'],
    [1 / 3, '33.3 %'],
    [2 / 3, '66.7 %'],
    [0.0004, '0 %'],
    [0.9996, '100 %'],
    [0.001, '0.1 %'],
  ])('%d → %s', (share, text) => {
    expect(percent(share)).toBe(text);
  });
});

describe('typeCondition', () => {
  it('is { $type: "<alias>" }', () => {
    expect(typeCondition('objectId')).toEqual({
      type: 'object',
      fields: [{ key: '$type', value: { type: 'string', value: 'objectId' } }],
    });
  });
});

describe('withFilterField', () => {
  it('an empty or blank filter becomes the condition alone', () => {
    for (const current of ['', '   ', '\n']) {
      const out = withFilterField(current, 'status', str('open'));
      expect(keysOf(out)).toEqual(['status']);
      expect(valueOf(out, 'status')).toEqual(str('open'));
    }
  });

  it('an empty document {} gets the condition', () => {
    const out = withFilterField('{}', 'n', int(5));
    expect(keysOf(out)).toEqual(['n']);
    expect(valueOf(out, 'n')).toMatchObject({ type: 'int', value: 5 });
  });

  it('keeps the other fields and appends a new key at the end', () => {
    const out = withFilterField('{ status: "open", n: { $gt: 3 } }', 'city', str('Springfield'));
    expect(keysOf(out)).toEqual(['status', 'n', 'city']);
    expect(valueOf(out, 'status')).toEqual(str('open'));
    expect(valueOf(out, 'city')).toEqual(str('Springfield'));
    const n = valueOf(out, 'n');
    expect(n?.type).toBe('object');
  });

  it('replaces the same key in place (order kept)', () => {
    const out = withFilterField('{ a: 1, status: "open", b: 2 }', 'status', str('closed'));
    expect(keysOf(out)).toEqual(['a', 'status', 'b']);
    expect(valueOf(out, 'status')).toEqual(str('closed'));
  });

  it('a dotted key is one key, quoted so it parses back', () => {
    const out = withFilterField('{ a: 1 }', 'items.name', str('pen'));
    expect(keysOf(out)).toEqual(['a', 'items.name']);
    expect(valueOf(out, 'items.name')).toEqual(str('pen'));
  });

  it('a $type condition parses back as { $type: alias }', () => {
    const out = withFilterField('', 'value', typeCondition('int'));
    expect(valueOf(out, 'value')).toEqual(typeCondition('int'));
  });

  it('replaces an unparseable filter with the condition alone', () => {
    for (const current of ['{ status: ', 'not a filter', '[1, 2]']) {
      const out = withFilterField(current, 'status', str('open'));
      expect(keysOf(out)).toEqual(['status']);
    }
  });

  it('keeps typed numbers typed (int stays int, not double)', () => {
    const out = withFilterField('', 'n', { type: 'long', value: 9n });
    expect(valueOf(out, 'n')?.type).toBe('long');
  });

  it('a string value with quotes and shell characters stays a literal string', () => {
    const tricky = `it's "x" }); db.dropDatabase(`;
    const out = withFilterField('', 'note', str(tricky));
    expect(valueOf(out, 'note')).toEqual(str(tricky));
  });
});

describe('schemaRows', () => {
  const field = (path: string, probability: number, extra: Partial<SchemaField> = {}) =>
    ({ path, probability, count: 1, types: [], ...extra }) as SchemaField;

  it('no fields → no rows', () => {
    expect(schemaRows([])).toEqual([]);
  });

  it('keeps the backend order and derives name, depth, missing and filter key', () => {
    const rows = schemaRows([
      field('a', 0.75, { count: 3 }),
      field('a.b', 0.5),
      field('tags', 1),
      field('tags.[]', 1),
      field('tags.[].name', 0.25),
    ]);
    expect(rows.map((r) => [r.path, r.name, r.depth, r.filterKey])).toEqual([
      ['a', 'a', 0, 'a'],
      ['a.b', 'b', 1, 'a.b'],
      ['tags', 'tags', 0, 'tags'],
      ['tags.[]', '[]', 1, 'tags'],
      ['tags.[].name', 'name', 2, 'tags.name'],
    ]);
    expect(rows[0]).toMatchObject({ share: 0.75, missing: 0.25, count: 3 });
    expect(rows[2]?.missing).toBe(0);
  });

  it('turns each type into a colored row with parsed examples', () => {
    const [row] = schemaRows([
      field('v', 0.8, {
        count: 8,
        types: [
          {
            bsonType: 'string',
            probability: 0.6,
            count: 6,
            examples: '["alpha","beta"]',
          },
          {
            bsonType: 'int',
            probability: 0.2,
            count: 2,
            examples: '[{"$numberInt":"7"}]',
          },
        ],
      }),
    ]);
    expect(row?.types.map((t) => [t.bsonType, t.share, t.count, t.color])).toEqual([
      ['string', 0.6, 6, typeColor('string')],
      ['int', 0.2, 2, typeColor('int')],
    ]);
    const [alpha, beta] = row?.types[0]?.examples ?? [];
    expect(alpha?.value).toEqual(str('alpha'));
    expect(alpha?.full).toContain('alpha');
    expect(alpha?.text).toBe(alpha?.full);
    expect(beta?.value).toEqual(str('beta'));
    const seven = row?.types[1]?.examples[0];
    expect(seven?.value).toMatchObject({ type: 'int', value: 7 });
    expect(seven?.full).toContain('7');
  });

  it('cuts long example text with an ellipsis; the full text stays', () => {
    const long = 'x'.repeat(120);
    const [row] = schemaRows([
      field('t', 1, {
        types: [{ bsonType: 'string', probability: 1, count: 1, examples: JSON.stringify([long]) }],
      }),
    ]);
    const ex = row?.types[0]?.examples[0];
    expect(ex?.full).toContain(long);
    expect(ex?.text).toHaveLength(EXAMPLE_TEXT_LIMIT);
    expect(ex?.text.endsWith('…')).toBe(true);
    expect(ex?.full.startsWith(ex.text.slice(0, -1))).toBe(true);
    expect(ex?.value).toEqual(str(long));
  });

  it('example text exactly at the limit is not cut', () => {
    // The printed string has quotes: 46 characters + 2 quotes = the limit.
    const s = 'y'.repeat(EXAMPLE_TEXT_LIMIT - 2);
    const [row] = schemaRows([
      field('t', 1, {
        types: [{ bsonType: 'string', probability: 1, count: 1, examples: JSON.stringify([s]) }],
      }),
    ]);
    const ex = row?.types[0]?.examples[0];
    expect(ex?.full).toHaveLength(EXAMPLE_TEXT_LIMIT);
    expect(ex?.text).toBe(ex?.full);
  });

  it('malformed or non-array examples give no examples instead of failing', () => {
    const [row] = schemaRows([
      field('t', 1, {
        types: [
          { bsonType: 'string', probability: 0.5, count: 1, examples: '["unterminated' },
          { bsonType: 'int', probability: 0.5, count: 1, examples: '{"a":1}' },
        ],
      }),
    ]);
    expect(row?.types.map((t) => t.examples)).toEqual([[], []]);
  });

  it('a field with share 0 shows its types with share 0 and is fully missing', () => {
    const [row] = schemaRows([
      field('x', 0, {
        count: 0,
        types: [{ bsonType: 'null', probability: 0.4, count: 1, examples: '[]' }],
      }),
    ]);
    expect(row?.missing).toBe(1);
    expect(row?.types[0]?.share).toBe(0);
  });
});
