import '@angular/compiler';
import { Injector } from '@angular/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { SchemaService } from './schema.service';

// The memoised lookups were rewritten from `has/set/get()!` to a `memo()` helper for the strict
// lint. These check they still answer correctly, cache per document, and start afresh on change.
const SCHEMA = JSON.stringify({
  title: 'Crew',
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: { type: 'string' },
    id: { type: 'integer', readOnly: true },
    nick: { type: 'string' },
    old: { type: 'string', deprecated: true },
    tags: {
      type: 'array',
      items: {
        type: 'object',
        required: ['label'],
        properties: { label: { type: 'string' }, weight: { type: 'number', default: 1 } },
      },
    },
  },
});

describe('SchemaService', () => {
  let schema: SchemaService;

  beforeEach(() => {
    schema = Injector.create({ providers: [SchemaService] }).get(SchemaService);
  });

  it('answers neutrally while no schema or no document is loaded', () => {
    expect(schema.readOnlyFor('.id')).toBe(false);
    expect(schema.ghostsFor('')).toEqual([]);
    expect(schema.permitsKey('', 'anything')).toBe(true);
    expect(schema.requiredFor('').size).toBe(0);
    expect(schema.declaredKeys('')).toEqual([]);
    expect(schema.declaredItemKeys('.tags')).toEqual([]);

    expect(schema.load(SCHEMA, 'crew.schema.json')).toBe(true);
    // A schema but no document yet: still neutral for the data-dependent questions.
    expect(schema.readOnlyFor('.id')).toBe(false);
    expect(schema.ghostsFor('')).toEqual([]);
    expect(schema.permitsKey('', 'anything')).toBe(true);
    expect(schema.requiredFor('').size).toBe(0);
  });

  describe('with a schema and a document', () => {
    beforeEach(() => {
      expect(schema.load(SCHEMA, 'crew.schema.json')).toBe(true);
      schema.setData({ name: 'Ada Example', id: 7, tags: [{ label: 'x' }] });
    });

    it('answers each lookup from the schema', () => {
      expect(schema.name()).toBe('Crew');
      expect(schema.readOnlyFor('.id')).toBe(true);
      expect(schema.readOnlyFor('.name')).toBe(false);
      expect(schema.ghostsFor('').map((g) => g.key)).toEqual(['nick']);
      expect(schema.ghostsFor('.tags[0]')).toMatchObject([
        { key: 'weight', hasDefault: true, default: 1, required: false },
      ]);
      expect(schema.permitsKey('', 'nick')).toBe(true);
      expect(schema.permitsKey('', 'unknown')).toBe(false);
      expect(schema.permitsKey('.tags[0]', 'unknown')).toBe(true);
      expect([...schema.requiredFor('')]).toEqual(['name']);
      expect([...schema.requiredFor('.tags[0]')]).toEqual(['label']);
      expect(schema.declaredKeys('')).toEqual(['name', 'id', 'nick', 'tags']);
      expect(schema.declaredItemKeys('.tags')).toEqual(['label', 'weight']);
    });

    it('caches answers, including false and empty ones, until the document changes', () => {
      const ghosts = schema.ghostsFor('');
      const required = schema.requiredFor('');
      const declared = schema.declaredKeys('');
      const items = schema.declaredItemKeys('.tags');
      expect(schema.ghostsFor('')).toBe(ghosts);
      expect(schema.requiredFor('')).toBe(required);
      expect(schema.declaredKeys('')).toBe(declared);
      expect(schema.declaredItemKeys('.tags')).toBe(items);
      expect(schema.readOnlyFor('.name')).toBe(false);
      expect(schema.readOnlyFor('.name')).toBe(false);
      expect(schema.permitsKey('', 'unknown')).toBe(false);
      expect(schema.permitsKey('', 'unknown')).toBe(false);

      schema.setData({ name: 'Ada Example', nick: 'ada' });
      // Data-dependent answers are recomputed for the new document.
      expect(schema.ghostsFor('')).not.toBe(ghosts);
      expect(schema.ghostsFor('').map((g) => g.key)).toEqual(['id', 'tags']);
      // Schema-only answers stay cached while the schema is the same.
      expect(schema.declaredKeys('')).toBe(declared);
    });

    it('keeps permitsKey answers apart per parent and key', () => {
      expect(schema.permitsKey('', 'label')).toBe(false);
      expect(schema.permitsKey('.tags[0]', 'label')).toBe(true);
      expect(schema.permitsKey('', 'name')).toBe(true);
    });

    it('starts afresh when the schema is replaced or cleared', () => {
      expect(schema.declaredKeys('')).toEqual(['name', 'id', 'nick', 'tags']);
      expect(
        schema.load('{"properties":{"other":{"type":"string"}}}', 'other.schema.json', 'file'),
      ).toBe(true);
      expect(schema.name()).toBe('other.schema.json');
      expect(schema.declaredKeys('')).toEqual(['other']);
      expect(schema.readOnlyFor('.id')).toBe(false);

      schema.clear();
      expect(schema.declaredKeys('')).toEqual([]);
      expect(schema.permitsKey('', 'unknown')).toBe(true);
    });

    it('keeps the loaded schema when new schema text is unusable', () => {
      expect(schema.load('{ not json', 'bad.json')).toBe(false);
      expect(schema.error()).toMatch(/^Not valid JSON/);
      expect(schema.load('[]', 'bad.json')).toBe(false);
      expect(schema.error()).toBe('A schema must be a JSON object.');
      expect(schema.readOnlyFor('.id')).toBe(true);
    });
  });

  it('passes variant questions and seeds through to the model for the current document', () => {
    const variants = JSON.stringify({
      $id: 'https://example.invalid/shapes.json',
      properties: {
        shapes: {
          type: 'array',
          items: {
            type: 'object',
            required: ['kind'],
            oneOf: [
              {
                title: 'Circle',
                required: ['radius'],
                properties: { kind: { const: 'circle' }, radius: { type: 'number', minimum: 1 } },
              },
              {
                title: 'Square',
                required: ['side'],
                properties: { kind: { const: 'square' }, side: { type: 'number' } },
              },
            ],
          },
        },
      },
    });
    expect(schema.switchVariantFor('.shapes[0]', 'square')).toBeUndefined();
    expect(schema.seedFor('', 'shapes')).toBeUndefined();
    expect(schema.seedItemFor('.shapes')).toBeUndefined();
    expect(schema.load(variants, 'shapes.schema.json')).toBe(true);
    expect(schema.key()).toBe('https://example.invalid/shapes.json');
    schema.setData({ shapes: [{ kind: 'circle', radius: 2 }] });

    const info = schema.variantsFor('.shapes[0]');
    expect(info?.variants.map((v) => v.label)).toEqual(['Circle', 'Square']);
    expect(schema.variantsFor('.shapes[0]')).toBe(info);
    expect(schema.variantIndexFor('.shapes[0]')).toBe(0);
    // The objects are open, so the circle's radius may stay.
    expect(schema.switchVariantFor('.shapes[0]', 'square')).toEqual({
      value: { kind: 'square', radius: 2, side: 0 },
      dropped: [],
      reset: [],
      added: ['side'],
    });
    expect(schema.seedItemFor('.shapes')).toEqual({ kind: 'circle', radius: 1 });
    expect(schema.seedFor('', 'shapes')).toEqual([]);
    expect(schema.seedFor('', 'unknown')).toBeUndefined();
    expect(schema.seed({ type: 'boolean' })).toBe(false);
    expect(schema.choicesFor('.shapes[0].kind')).toEqual(['circle', 'square']);
    expect(schema.typesFor('.shapes[0].radius')).toEqual(['number']);

    schema.fail('download failed');
    expect(schema.error()).toBe('download failed');
  });

  it('answers per line for JSON Lines, and nothing for a line that is not JSON', () => {
    expect(schema.load(SCHEMA, 'crew.schema.json')).toBe(true);
    schema.setLines([{ name: 'Ada Example', id: 1 }, undefined, { id: 2 }]);
    expect(schema.readOnlyFor('[0].id')).toBe(true);
    expect(schema.readOnlyFor('[1].id')).toBe(false);
    expect(schema.ghostsFor('[1]')).toEqual([]);
    expect(schema.permitsKey('[1]', 'unknown')).toBe(true);
    expect(schema.requiredFor('[1]').size).toBe(0);
    expect(schema.ghostsFor('[2]').find((g) => g.key === 'name')?.required).toBe(true);
    expect(schema.declaredKeys('[5]')).toEqual(['name', 'id', 'nick', 'tags']);
    expect(schema.problems().map((p) => p.path.join('.'))).toEqual(['2.name']);
  });
});
