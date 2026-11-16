import { describe, expect, it } from 'vitest';
import { SchemaModel } from '../schema';
import { formFields } from './form-fields.util';

const ghost = (key: string, required = false) => ({ key, schema: {}, required, hasDefault: false });

describe('formFields', () => {
  it('follows the schema order and puts absent keys in their place as ghosts', () => {
    const fields = formFields({ b: 1, a: 2 }, ['a', 'x', 'b'], [ghost('x')], new Set());
    expect(fields.map((f) => [f.key, !!f.ghost])).toEqual([
      ['a', false],
      ['x', true],
      ['b', false],
    ]);
  });

  it('appends keys only the data has, in data order', () => {
    const fields = formFields({ z: 1, a: 2, y: 3 }, ['a'], [], new Set());
    expect(fields.map((f) => f.key)).toEqual(['a', 'z', 'y']);
  });

  it('is the data order without a schema', () => {
    expect(formFields({ b: 1, a: 2 }, [], [], new Set()).map((f) => f.key)).toEqual(['b', 'a']);
  });

  it('marks required keys, present or absent', () => {
    const fields = formFields({ a: 1 }, ['a', 'b'], [ghost('b', true)], new Set(['a']));
    expect(fields.map((f) => [f.key, f.required])).toEqual([
      ['a', true],
      ['b', true],
    ]);
  });

  it('leaves out declared keys that are absent and not offered', () => {
    expect(formFields({ a: 1 }, ['a', 'old'], [], new Set()).map((f) => f.key)).toEqual(['a']);
  });

  it('keeps a declared key that is present even though it is not offered as a ghost', () => {
    expect(formFields({ old: 1 }, ['old'], [], new Set()).map((f) => f.key)).toEqual(['old']);
  });

  it('lays out a config document the way the schema orders it', () => {
    // A stand-in for JSON Canopy's app-config sample, which was not copied.
    const model = new SchemaModel({
      type: 'object',
      required: ['server', 'database'],
      properties: {
        $schema: { type: 'string' },
        name: { type: 'string' },
        environment: { enum: ['dev', 'prod'] },
        server: { type: 'object' },
        database: { type: 'object' },
        logging: { type: 'object' },
        features: { type: 'object' },
        cache: { type: 'object' },
        cacheTtl: { type: 'integer', deprecated: true },
      },
    });
    const data = { logging: {}, server: {}, $schema: 'x.json', database: {}, name: 'billing-api' };
    const fields = formFields(
      data,
      model.declaredKeysAt([]),
      model.ghostKeysAt([], data),
      model.requiredAt([], data),
    );
    expect(fields.map((f) => f.key)).toEqual([
      '$schema',
      'name',
      'environment',
      'server',
      'database',
      'logging',
      'features',
      'cache',
    ]);
    expect(fields.filter((f) => f.required).map((f) => f.key)).toEqual(['server', 'database']);
  });
});
