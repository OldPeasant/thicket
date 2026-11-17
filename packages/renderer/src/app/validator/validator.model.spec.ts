import { VALIDATION_ACTIONS, VALIDATION_LEVELS } from '@thicket/contract';
import { describe, expect, it } from 'vitest';

import {
  ACTION_HINTS,
  LEVEL_HINTS,
  parseValidatorText,
  SCHEMA_TEMPLATE,
  validatorText,
} from './validator.model';

describe('validatorText', () => {
  it('is empty without a validator', () => {
    expect(validatorText(null)).toBe('');
  });

  it('prints canonical EJSON as indented shell syntax', () => {
    expect(
      validatorText(
        '{"$jsonSchema":{"bsonType":"object","required":["sku"],"properties":{"qty":{"minimum":{"$numberInt":"1"}}}}}',
      ),
    ).toBe(
      [
        '{',
        '  $jsonSchema: {',
        '    bsonType: "object",',
        '    required: [',
        '      "sku"',
        '    ],',
        '    properties: {',
        '      qty: {',
        '        minimum: 1',
        '      }',
        '    }',
        '  }',
        '}',
      ].join('\n'),
    );
  });

  it('keeps BSON types that shell syntax spells as constructors', () => {
    const text = validatorText('{"n":{"$gt":{"$numberLong":"5"}}}');
    expect(text).toContain('NumberLong(');
    expect(parseValidatorText(text)).toEqual({
      ok: true,
      validator: '{"n":{"$gt":{"$numberLong":"5"}}}',
    });
  });

  it('shows text it cannot parse as it is', () => {
    expect(validatorText('{not ejson')).toBe('{not ejson');
  });
});

describe('parseValidatorText', () => {
  it.each([
    ['empty text', ''],
    ['whitespace only', '  \n\t '],
    ['an empty document', '{}'],
    ['an empty document with whitespace', ' {  } '],
  ])('reads %s as no validator', (_name, text) => {
    expect(parseValidatorText(text)).toEqual({ ok: true, validator: null });
  });

  it('turns shell syntax into canonical EJSON', () => {
    expect(
      parseValidatorText(
        "{ $jsonSchema: { bsonType: 'object', required: ['sku'] }, qty: { $gte: 1 } }",
      ),
    ).toEqual({
      ok: true,
      validator:
        '{"$jsonSchema":{"bsonType":"object","required":["sku"]},"qty":{"$gte":{"$numberInt":"1"}}}',
    });
  });

  it('parses the template to a $jsonSchema validator', () => {
    expect(parseValidatorText(SCHEMA_TEMPLATE)).toEqual({
      ok: true,
      validator: '{"$jsonSchema":{"bsonType":"object","required":[],"properties":{}}}',
    });
  });

  it('round-trips the printed text of a validator', () => {
    const ejson = '{"$or":[{"a":{"$exists":true}},{"b":{"$type":"string"}}]}';
    expect(parseValidatorText(validatorText(ejson))).toEqual({ ok: true, validator: ejson });
  });

  it.each([
    ['an unclosed document', '{ $jsonSchema: { bsonType: "object" }'],
    ['an array', '[ { a: 1 } ]'],
    ['a number', '42'],
    ['code', '{ a: process.exit() }'],
    ['a function', '{ $where: function () { return true } }'],
  ])('refuses %s with the parser message and its position', (_name, text) => {
    const parsed = parseValidatorText(text);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/\S/);
  });

  it('names line and column of a syntax error', () => {
    const parsed = parseValidatorText('{\n  a: 1,\n  b: \n}');
    // The value of `b` is missing: the parser stops at the "}" on line 4.
    expect(parsed).toEqual({ ok: false, error: 'Unexpected "}" (line 4, column 1)' });
  });
});

describe('hints', () => {
  it('describe every level and action of the contract', () => {
    expect(Object.keys(LEVEL_HINTS).sort()).toEqual([...VALIDATION_LEVELS].sort());
    expect(Object.keys(ACTION_HINTS).sort()).toEqual([...VALIDATION_ACTIONS].sort());
  });
});
