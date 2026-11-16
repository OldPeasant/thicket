import { describe, expect, it } from 'vitest';
import { SchemaModel, schemaRefOf, type JsonSchema, type Problem } from './index';

// JSON Canopy's version of this spec also ran against its samples/ folder (team, filters-demo,
// search-demo, app-config and pipeline schemas and documents), which was not copied into Thicket.
// These are the cases that stand on their own.
const paths = (problems: Problem[]) => problems.map((p) => p.path.join('.'));

describe('resolve', () => {
  it('lets local keywords win over the referenced ones', () => {
    const m = new SchemaModel({ $defs: { a: { type: 'string', title: 'A' } } });
    expect(m.resolve({ $ref: '#/$defs/a', title: 'Mine' })).toMatchObject({
      type: 'string',
      title: 'Mine',
    });
  });

  it('keeps both constraints when allOf parts share a property', () => {
    const m = new SchemaModel({});
    const s = m.resolve({
      allOf: [{ properties: { x: { type: 'string' } } }, { properties: { x: { minLength: 1 } } }],
    });
    expect(m.resolve(s.properties?.['x'] ?? {})).toMatchObject({ type: 'string', minLength: 1 });
  });

  it('treats inherited Object names as ordinary properties when merging allOf parts', () => {
    const m = new SchemaModel({});
    const s = m.resolve({
      allOf: [
        { properties: { a: { type: 'string' } } },
        { properties: { toString: { type: 'number' }, constructor: { type: 'boolean' } } },
      ],
    });
    expect(s.properties?.['toString']).toEqual({ type: 'number' });
    expect(s.properties?.['constructor']).toEqual({ type: 'boolean' });
  });

  it('keeps a __proto__ property as data instead of changing the prototype', () => {
    const m = new SchemaModel({});
    const parts = JSON.parse(
      '[{"properties":{"a":{"type":"string"}}},{"properties":{"__proto__":{"type":"number"}}}]',
    ) as JsonSchema[];
    const s = m.resolve({ allOf: parts });
    const props = s.properties ?? {};
    expect(Object.getPrototypeOf(props)).toBe(Object.prototype);
    expect(Object.hasOwn(props, '__proto__')).toBe(true);
    expect(Object.keys(props)).toEqual(['a', '__proto__']);
  });

  it('survives circular and unresolvable references', () => {
    const m = new SchemaModel({ $defs: { loop: { $ref: '#/$defs/loop' } } });
    expect(() => m.resolve({ $ref: '#/$defs/loop' })).not.toThrow();
    expect(m.resolve({ $ref: 'https://example.com/other.json' })).toEqual({});
    expect(m.warnings).toEqual([
      'circular $ref #/$defs/loop',
      'unsupported $ref https://example.com/other.json',
    ]);
  });
});

describe('allowedTypes', () => {
  it('follows type, enum and const', () => {
    const m = new SchemaModel({});
    expect(m.allowedTypes({ type: 'integer' })).toEqual(['number']);
    expect(m.allowedTypes({ enum: ['a', 1] })).toEqual(['string', 'number']);
    expect(m.allowedTypes({ const: null })).toEqual(['null']);
  });

  it('allows anything when unconstrained', () => {
    expect(new SchemaModel({}).allowedTypes({})).toEqual([
      'string',
      'number',
      'boolean',
      'null',
      'object',
      'array',
    ]);
  });
});

describe('choicesAt', () => {
  it('unions enumerated alternatives and refuses non-scalar values', () => {
    const m = new SchemaModel({
      properties: {
        a: { oneOf: [{ const: 'x' }, { enum: ['y', 3] }] },
        b: { oneOf: [{ const: 'x' }, { type: 'string' }] },
        c: { enum: [{ o: 1 }] },
      },
    });
    expect(m.choicesAt(['a'])).toEqual(['x', 'y', 3]);
    expect(m.choicesAt(['b'])).toBeUndefined();
    expect(m.choicesAt(['c'])).toBeUndefined();
  });
});

describe('seedItem', () => {
  it('is undefined when the schema says nothing about items there', () => {
    const m = new SchemaModel({ type: 'array' });
    expect(m.seedItem([], [])).toBeUndefined();
  });

  it('indexes by the current length, so a tuple (prefixItems) schema seeds the right slot', () => {
    const m = new SchemaModel({ type: 'array', prefixItems: [{ const: 'a' }, { const: 'b' }] });
    expect(m.seedItem([], ['a'])).toBe('b');
  });
});

describe('seed', () => {
  it('does not recurse forever through required self-references', () => {
    const m = new SchemaModel({
      $defs: {
        n: { type: 'object', required: ['child'], properties: { child: { $ref: '#/$defs/n' } } },
      },
      $ref: '#/$defs/n',
    });
    expect(() => m.seed(m.root)).not.toThrow();
  });

  it("returns a copy, never the schema's own default", () => {
    const m = new SchemaModel({ default: { a: [1] } });
    const first = m.seed(m.root) as { a: number[] };
    first.a.push(2);
    expect(m.seed(m.root)).toEqual({ a: [1] });
  });
});

describe('validate', () => {
  it('does not throw on data of the wrong shape', () => {
    expect(new SchemaModel({ type: 'object' }).validate(42).length).toBeGreaterThan(0);
  });

  it('honours a draft-07 schema', () => {
    const m = new SchemaModel({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      required: ['a'],
    });
    expect(paths(m.validate({}))).toEqual(['a']);
  });
});

describe('the $schema key', () => {
  it('is still checked where the schema declares it', () => {
    const schema = { properties: { $schema: { type: 'string' } }, additionalProperties: false };
    expect(new SchemaModel(schema).validate({ $schema: 3 }).map((p) => p.keyword)).toEqual([
      'type',
    ]);
  });
});

describe('errors for alternatives', () => {
  it('says so when a value fits more than one option', () => {
    const m = new SchemaModel({ oneOf: [{ type: 'string' }, { minLength: 1 }] });
    expect(m.validate('abc').map((p) => p.message)).toEqual([
      'fits more than one option (string, option 2); it must fit exactly one',
    ]);
  });

  it('falls back to the raw errors when a variant cannot be checked on its own', () => {
    // The first variant points into the middle of the root, which cannot be compiled alone.
    const m = new SchemaModel({
      properties: {
        a: { type: 'object' },
        b: {
          oneOf: [
            { type: 'object', properties: { q: { $ref: '#/properties/a' } } },
            { type: 'number' },
          ],
        },
      },
    });
    const problems = m.validate({ b: true });
    expect(problems.map((p) => p.keyword)).toContain('oneOf');
  });
});

describe('schemaRefOf', () => {
  it('reads $schema from an object document', () => {
    expect(schemaRefOf({ $schema: '../schemas/app-config.schema.json', name: 'x' })).toBe(
      '../schemas/app-config.schema.json',
    );
    expect(schemaRefOf({ name: 'x' })).toBeUndefined();
    expect(schemaRefOf([])).toBeUndefined();
    expect(schemaRefOf({ $schema: 3 })).toBeUndefined();
  });
});
