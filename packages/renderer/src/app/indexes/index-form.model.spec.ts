import { doc, int32, parseEJsonDocument, str } from '@thicket/core/bson';
import { describe, expect, it } from 'vitest';

import {
  buildIndex,
  type DraftErrors,
  emptyDraft,
  type IndexDraft,
  type KeyFieldDraft,
  printCreateIndex,
  isWildcard,
} from './index-form.model';

function draft(patch: Partial<IndexDraft>): IndexDraft {
  return { ...emptyDraft(), ...patch };
}

function key(...fields: [string, KeyFieldDraft['type']][]): KeyFieldDraft[] {
  return fields.map(([field, type]) => ({ field, type }));
}

/** The errors of a draft the model must refuse. */
function errorsOf(d: IndexDraft): DraftErrors {
  const result = buildIndex(d);
  if (result.ok) throw new Error(`expected errors, got ${JSON.stringify(result.spec.key)}`);
  return result.errors;
}

/** Key and options as plain JSON (canonical EJSON parsed) of a draft the model must accept. */
function specOf(d: IndexDraft): { key: unknown; options: unknown } {
  const result = buildIndex(d);
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.errors)}`);
  return {
    key: JSON.parse(result.spec.key) as unknown,
    options:
      result.spec.options === undefined ? undefined : (JSON.parse(result.spec.options) as unknown),
  };
}

const one = (field = 'createdAt', type: KeyFieldDraft['type'] = '1') => key([field, type]);

describe('isWildcard', () => {
  it.each([
    ['$**', true],
    ['attrs.$**', true],
    ['a.b.$**', true],
    ['a', false],
    ['$*', false],
    ['a$**', false],
    ['$**.a', false],
    ['', false],
  ])('%s -> %s', (field, expected) => {
    expect(isWildcard(field)).toBe(expected);
  });
});

describe('emptyDraft', () => {
  it('starts with one empty ascending field and no options', () => {
    expect(emptyDraft()).toEqual({
      fields: [{ field: '', type: '1' }],
      name: '',
      unique: false,
      sparse: false,
      hidden: false,
      ttl: '',
      partialFilter: '',
      collation: '',
      weights: '',
      defaultLanguage: '',
      wildcardProjection: '',
    });
  });

  it('returns a fresh object each time', () => {
    expect(emptyDraft()).not.toBe(emptyDraft());
  });
});

describe('buildIndex: key fields', () => {
  it('builds every key type with Int32 directions and string types, in order', () => {
    expect(
      specOf(
        draft({
          fields: key(['a', '1'], ['b', '-1']),
        }),
      ),
    ).toEqual({ key: { a: { $numberInt: '1' }, b: { $numberInt: '-1' } }, options: undefined });
    expect(specOf(draft({ fields: one('loc', '2dsphere') })).key).toEqual({ loc: '2dsphere' });
    expect(specOf(draft({ fields: one('pos', '2d') })).key).toEqual({ pos: '2d' });
    expect(specOf(draft({ fields: one('sku', 'hashed') })).key).toEqual({ sku: 'hashed' });
    expect(specOf(draft({ fields: one('body', 'text') })).key).toEqual({ body: 'text' });
  });

  it('trims field names', () => {
    expect(specOf(draft({ fields: one('  status  ') })).key).toEqual({
      status: { $numberInt: '1' },
    });
  });

  it('leaves options out of the spec when none are set', () => {
    const result = buildIndex(draft({ fields: one('status') }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spec.options).toBeUndefined();
      expect(result.spec.optionsDoc.fields).toEqual([]);
      expect(result.spec.keyDoc).toEqual(doc([{ key: 'status', value: int32(1) }]));
    }
  });

  it('refuses a key without fields', () => {
    expect(errorsOf(draft({ fields: [] }))).toEqual({ fields: 'Add at least one field.' });
  });

  it.each([
    ['', 'Enter a field name.'],
    ['   ', 'Enter a field name.'],
    ['a..b', 'A field path has no empty parts.'],
    ['.a', 'A field path has no empty parts.'],
    ['a.', 'A field path has no empty parts.'],
    ['$a', 'Field names do not start with $.'],
    ['.$**', 'A field path has no empty parts.'],
    ['a..b.$**', 'A field path has no empty parts.'],
    ['$x.$**', 'Field names do not start with $.'],
  ])('refuses the field %j: %s', (field, message) => {
    expect(errorsOf(draft({ fields: one(field) }))).toEqual({ 'field.0': message });
  });

  it('accepts dotted paths and wildcard paths', () => {
    expect(specOf(draft({ fields: one('a.b.c') })).key).toEqual({ 'a.b.c': { $numberInt: '1' } });
    expect(specOf(draft({ fields: one('$**') })).key).toEqual({ '$**': { $numberInt: '1' } });
    expect(specOf(draft({ fields: one('attrs.$**', '-1') })).key).toEqual({
      'attrs.$**': { $numberInt: '-1' },
    });
  });

  it('reports each field error under its own index', () => {
    expect(errorsOf(draft({ fields: key(['ok', '1'], ['', '1'], ['$x', '1']) }))).toEqual({
      'field.1': 'Enter a field name.',
      'field.2': 'Field names do not start with $.',
    });
  });

  it('refuses a duplicate field (also after trimming)', () => {
    expect(errorsOf(draft({ fields: key(['a', '1'], [' a ', '-1']) }))).toEqual({
      'field.1': 'a is already in the key.',
    });
  });

  it.each(['2dsphere', '2d', 'hashed'] as const)('refuses a wildcard field of type %s', (type) => {
    for (const field of ['$**', 'attrs.$**']) {
      const errors = errorsOf(draft({ fields: one(field, type) }));
      expect(errors['field.0']).toBe('A wildcard field is ascending or descending.');
    }
  });

  it('allows the wildcard text index { "$**": "text" }', () => {
    expect(specOf(draft({ fields: one('$**', 'text') }))).toEqual({
      key: { '$**': 'text' },
      options: undefined,
    });
  });

  it('allows the wildcard text field with plain and other text fields', () => {
    expect(
      specOf(draft({ fields: key(['shop', '1'], ['$**', 'text'], ['title', 'text']) })).key,
    ).toEqual({ shop: { $numberInt: '1' }, '$**': 'text', title: 'text' });
  });

  it('refuses text on a path wildcard', () => {
    expect(errorsOf(draft({ fields: one('attrs.$**', 'text') }))).toEqual({
      'field.0': 'Only the field $** can be a text field among wildcards.',
    });
  });

  it('refuses the wildcard text field together with a wildcard (non-text) field', () => {
    expect(errorsOf(draft({ fields: key(['$**', 'text'], ['attrs.$**', '1']) }))).toEqual({
      fields: 'A wildcard index has only ascending or descending fields.',
    });
  });

  it.each(['2dsphere', '2d', 'hashed'] as const)(
    'refuses the wildcard text field together with %s',
    (type) => {
      expect(errorsOf(draft({ fields: key(['$**', 'text'], ['x', type]) }))).toEqual({
        fields: `A text index cannot also have a ${type} field.`,
      });
    },
  );

  it('refuses two hashed fields', () => {
    expect(errorsOf(draft({ fields: key(['a', 'hashed'], ['b', 'hashed']) }))).toEqual({
      fields: 'An index has at most one hashed field.',
    });
  });

  it('refuses a 2d field that is not the first field of the key', () => {
    expect(errorsOf(draft({ fields: key(['cat', '1'], ['pos', '2d']) }))).toEqual({
      fields: 'A 2d field must be the first field of the key.',
    });
  });

  it('allows a 2d field first with further fields', () => {
    expect(specOf(draft({ fields: key(['pos', '2d'], ['cat', '1']) })).key).toEqual({
      pos: '2d',
      cat: { $numberInt: '1' },
    });
  });

  it('refuses two 2d fields', () => {
    expect(errorsOf(draft({ fields: key(['a', '2d'], ['b', '2d']) }))).toEqual({
      fields: 'An index has at most one 2d field.',
    });
  });

  it.each(['2dsphere', '2d', 'hashed'] as const)('refuses text together with %s', (type) => {
    expect(errorsOf(draft({ fields: key(['body', 'text'], ['x', type]) }))).toEqual({
      fields: `A text index cannot also have a ${type} field.`,
    });
  });

  it('allows compound text indexes with plain fields and several text fields', () => {
    expect(
      specOf(draft({ fields: key(['shop', '1'], ['title', 'text'], ['body', 'text']) })).key,
    ).toEqual({ shop: { $numberInt: '1' }, title: 'text', body: 'text' });
  });

  it('allows 2dsphere with other fields and one hashed with ascending fields', () => {
    expect(specOf(draft({ fields: key(['loc', '2dsphere'], ['cat', '1']) })).key).toEqual({
      loc: '2dsphere',
      cat: { $numberInt: '1' },
    });
    expect(specOf(draft({ fields: key(['a', 'hashed'], ['b', '1']) })).key).toEqual({
      a: 'hashed',
      b: { $numberInt: '1' },
    });
  });

  it('refuses a wildcard field combined with a special field', () => {
    expect(errorsOf(draft({ fields: key(['$**', '1'], ['loc', '2dsphere']) }))).toEqual({
      fields: 'A wildcard index has only ascending or descending fields.',
    });
    expect(errorsOf(draft({ fields: key(['$**', '1'], ['body', 'text']) }))).toEqual({
      fields: 'A wildcard index has only ascending or descending fields.',
    });
  });

  it('refuses two wildcard fields', () => {
    expect(errorsOf(draft({ fields: key(['a.$**', '1'], ['b.$**', '1']) }))).toEqual({
      fields: 'An index has at most one wildcard field.',
    });
  });

  it('allows a compound wildcard index with plain fields', () => {
    expect(specOf(draft({ fields: key(['tenant', '1'], ['attrs.$**', '1']) })).key).toEqual({
      tenant: { $numberInt: '1' },
      'attrs.$**': { $numberInt: '1' },
    });
  });

  it('returns the key and options built so far alongside the errors', () => {
    const result = buildIndex(draft({ fields: key(['a', '1'], ['', '-1']), name: 'n1' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.keyDoc.fields.map((f) => f.key)).toEqual(['a', '']);
      expect(result.optionsDoc).toEqual(doc([{ key: 'name', value: str('n1') }]));
    }
  });
});

describe('buildIndex: options', () => {
  it('builds every option in a fixed order', () => {
    expect(
      specOf(
        draft({
          fields: key(['title', 'text']),
          name: ' by_title ',
          unique: true,
          hidden: true,
          partialFilter: '{ status: "open" }',
          weights: '{ title: 10 }',
          defaultLanguage: ' french ',
        }),
      ).options,
    ).toEqual({
      name: 'by_title',
      unique: true,
      hidden: true,
      partialFilterExpression: { status: 'open' },
      weights: { title: { $numberInt: '10' } },
      default_language: 'french',
    });
    // A text index takes no collation: the collation's place is checked on a plain index.
    expect(
      specOf(
        draft({
          fields: key(['title', '1']),
          name: 'by_title',
          sparse: true,
          ttl: '60',
          collation: '{ locale: "fr", strength: 2 }',
        }),
      ).options,
    ).toEqual({
      name: 'by_title',
      sparse: true,
      expireAfterSeconds: { $numberInt: '60' },
      collation: { locale: 'fr', strength: { $numberInt: '2' } },
    });
  });

  describe('name', () => {
    it('leaves a blank name out', () => {
      expect(specOf(draft({ fields: one(), name: '   ' })).options).toBeUndefined();
    });

    it('refuses the reserved name *', () => {
      expect(errorsOf(draft({ fields: one(), name: ' * ' }))).toEqual({
        name: 'The name * is reserved.',
      });
    });
  });

  describe('unique', () => {
    it('is sent as true', () => {
      expect(specOf(draft({ fields: one('email'), unique: true })).options).toEqual({
        unique: true,
      });
    });

    it('refuses a unique hashed index', () => {
      expect(errorsOf(draft({ fields: one('sku', 'hashed'), unique: true }))).toEqual({
        unique: 'A hashed index cannot be unique.',
      });
    });

    it('refuses a unique wildcard index', () => {
      expect(errorsOf(draft({ fields: one('$**'), unique: true }))).toEqual({
        unique: 'A wildcard index cannot be unique.',
      });
    });
  });

  describe('sparse and partial filter', () => {
    it('sends sparse alone', () => {
      expect(specOf(draft({ fields: one(), sparse: true })).options).toEqual({ sparse: true });
    });

    it('refuses sparse together with a partial filter', () => {
      expect(
        errorsOf(draft({ fields: one(), sparse: true, partialFilter: '{ a: { $exists: true } }' })),
      ).toEqual({ sparse: 'Use either sparse or a partial filter, not both.' });
    });

    it('refuses sparse with an empty-document partial filter on both fields', () => {
      expect(errorsOf(draft({ fields: one(), sparse: true, partialFilter: '{}' }))).toEqual({
        partialFilter: 'Enter a filter, or leave the field empty.',
        sparse: 'Use either sparse or a partial filter, not both.',
      });
    });

    it('sends a partial filter in shell syntax as a document', () => {
      expect(
        specOf(draft({ fields: one(), partialFilter: '{ qty: { $gt: 5 } }' })).options,
      ).toEqual({ partialFilterExpression: { qty: { $gt: { $numberInt: '5' } } } });
    });

    it('treats a whitespace-only partial filter as not set', () => {
      expect(specOf(draft({ fields: one(), partialFilter: '  \n ' })).options).toBeUndefined();
    });

    it('refuses an empty partial filter document', () => {
      expect(errorsOf(draft({ fields: one(), partialFilter: '{ }' }))).toEqual({
        partialFilter: 'Enter a filter, or leave the field empty.',
      });
    });

    it('shows the parser message for a malformed partial filter and does not add it', () => {
      const result = buildIndex(draft({ fields: one(), partialFilter: '{ a: ' }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.partialFilter).toMatch(/line 1, column \d+/);
        expect(Object.keys(result.errors)).toEqual(['partialFilter']);
        expect(result.optionsDoc.fields).toEqual([]);
      }
    });

    it('sends a malformed partial filter with sparse only as a filter error', () => {
      const result = buildIndex(draft({ fields: one(), sparse: true, partialFilter: '{ a: ' }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(Object.keys(result.errors)).toEqual(['partialFilter']);
      }
    });
  });

  describe('hidden', () => {
    it('is sent as true', () => {
      expect(specOf(draft({ fields: one(), hidden: true })).options).toEqual({ hidden: true });
    });
  });

  describe('TTL', () => {
    it.each([
      ['0', 0],
      ['3600', 3600],
      [' 60 ', 60],
      ['2147483647', 2147483647],
    ])('sends %j seconds as Int32 expireAfterSeconds', (ttl, seconds) => {
      expect(specOf(draft({ fields: one(), ttl })).options).toEqual({
        expireAfterSeconds: { $numberInt: String(seconds) },
      });
    });

    it.each(['-1', '1.5', '1e3', 'abc', '0x10', '2147483648', '99999999999999999999', '+5'])(
      'refuses %j',
      (ttl) => {
        expect(errorsOf(draft({ fields: one(), ttl }))).toEqual({
          ttl: 'Enter whole seconds (0 or more).',
        });
      },
    );

    it('refuses a compound key', () => {
      expect(errorsOf(draft({ fields: key(['a', '1'], ['b', '1']), ttl: '60' }))).toEqual({
        ttl: 'A TTL index has exactly one field.',
      });
    });

    it('refuses a key without fields with both errors', () => {
      expect(errorsOf(draft({ fields: [], ttl: '60' }))).toEqual({
        fields: 'Add at least one field.',
        ttl: 'A TTL index has exactly one field.',
      });
    });

    it('refuses _id', () => {
      expect(errorsOf(draft({ fields: one('_id'), ttl: '60' }))).toEqual({
        ttl: 'The _id field cannot have a TTL.',
      });
    });

    it('accepts a descending field', () => {
      expect(specOf(draft({ fields: one('createdAt', '-1'), ttl: '60' })).options).toEqual({
        expireAfterSeconds: { $numberInt: '60' },
      });
    });

    it.each(['text', '2dsphere', '2d', 'hashed'] as const)('refuses a %s field', (type) => {
      expect(errorsOf(draft({ fields: one('createdAt', type), ttl: '60' }))).toEqual({
        ttl: 'A TTL field is ascending or descending (a date field).',
      });
    });

    it('refuses a wildcard field', () => {
      expect(errorsOf(draft({ fields: one('$**'), ttl: '60' }))).toEqual({
        ttl: 'A wildcard index cannot have a TTL.',
      });
    });

    it('combines with a partial filter (TTL + partial)', () => {
      expect(
        specOf(draft({ fields: one(), ttl: '3600', partialFilter: '{ archived: true }' })).options,
      ).toEqual({
        expireAfterSeconds: { $numberInt: '3600' },
        partialFilterExpression: { archived: true },
      });
    });
  });

  describe('collation', () => {
    it('sends a collation with a locale', () => {
      expect(specOf(draft({ fields: one(), collation: '{ locale: "de" }' })).options).toEqual({
        collation: { locale: 'de' },
      });
    });

    it.each(['{ strength: 2 }', '{ locale: "" }', '{ locale: 1 }', '{}'])(
      'refuses %s without a locale',
      (collation) => {
        expect(errorsOf(draft({ fields: one(), collation }))).toEqual({
          collation: 'A collation needs a locale, e.g. { locale: "en" }.',
        });
      },
    );

    it.each([
      ['text', 'A text index does not support a collation.'],
      ['2d', 'A 2d index does not support a collation.'],
    ] as const)('refuses a collation on a %s index', (type, message) => {
      expect(
        errorsOf(
          draft({ fields: key(['pos', type], ['cat', '1']), collation: '{ locale: "en" }' }),
        ),
      ).toEqual({ collation: message });
    });

    it('reports the 2d position and the 2d collation refusal together', () => {
      expect(
        errorsOf(
          draft({ fields: key(['cat', '1'], ['pos', '2d']), collation: '{ locale: "en" }' }),
        ),
      ).toEqual({
        fields: 'A 2d field must be the first field of the key.',
        collation: 'A 2d index does not support a collation.',
      });
    });

    it('refuses a collation on the wildcard text index', () => {
      expect(
        errorsOf(draft({ fields: one('$**', 'text'), collation: '{ locale: "en" }' })),
      ).toEqual({ collation: 'A text index does not support a collation.' });
    });

    it('allows a collation on a 2dsphere index', () => {
      expect(
        specOf(draft({ fields: one('loc', '2dsphere'), collation: '{ locale: "en" }' })).options,
      ).toEqual({ collation: { locale: 'en' } });
    });

    it('shows the parser message for a malformed collation', () => {
      expect(errorsOf(draft({ fields: one(), collation: 'locale' })).collation).toMatch(
        /line 1, column \d+/,
      );
    });
  });

  describe('weights and default language', () => {
    it('refuses weights on a non-text index', () => {
      expect(errorsOf(draft({ fields: one(), weights: '{ a: 2 }' }))).toEqual({
        weights: 'Weights apply to text indexes only.',
      });
    });

    it('shows the parser message for malformed weights', () => {
      expect(errorsOf(draft({ fields: one('body', 'text'), weights: '{ a: }' })).weights).toMatch(
        /line 1, column \d+/,
      );
    });

    it('refuses a language on a non-text index', () => {
      expect(errorsOf(draft({ fields: one(), defaultLanguage: 'german' }))).toEqual({
        defaultLanguage: 'The language applies to text indexes only.',
      });
    });

    it('sends weights and a language for the wildcard text index', () => {
      expect(
        specOf(
          draft({
            fields: one('$**', 'text'),
            weights: '{ title: 10 }',
            defaultLanguage: 'spanish',
          }),
        ).options,
      ).toEqual({ weights: { title: { $numberInt: '10' } }, default_language: 'spanish' });
    });

    it('treats a whitespace-only language as not set', () => {
      expect(specOf(draft({ fields: one(), defaultLanguage: '  ' })).options).toBeUndefined();
    });
  });

  describe('wildcard projection', () => {
    it('is sent for a $** index', () => {
      expect(
        specOf(draft({ fields: one('$**'), wildcardProjection: '{ secret: 0 }' })).options,
      ).toEqual({ wildcardProjection: { secret: { $numberInt: '0' } } });
    });

    it('is refused for a path wildcard (needs $** itself)', () => {
      expect(errorsOf(draft({ fields: one('attrs.$**'), wildcardProjection: '{ a: 1 }' }))).toEqual(
        { wildcardProjection: 'A wildcard projection needs the field $**.' },
      );
    });

    it('is refused for the wildcard text index', () => {
      expect(
        errorsOf(draft({ fields: one('$**', 'text'), wildcardProjection: '{ a: 1 }' })),
      ).toEqual({ wildcardProjection: 'A wildcard text index has no wildcard projection.' });
    });

    it('is refused for a plain index', () => {
      expect(errorsOf(draft({ fields: one(), wildcardProjection: '{ a: 1 }' }))).toEqual({
        wildcardProjection: 'A wildcard projection needs the field $**.',
      });
    });

    it('is refused for a key without fields', () => {
      expect(errorsOf(draft({ fields: [], wildcardProjection: '{ a: 1 }' }))).toEqual({
        fields: 'Add at least one field.',
        wildcardProjection: 'A wildcard projection needs the field $**.',
      });
    });

    it('shows the parser message when malformed', () => {
      expect(
        errorsOf(draft({ fields: one('$**'), wildcardProjection: '[1]' })).wildcardProjection,
      ).toEqual(expect.any(String));
    });
  });

  it('collects several option errors at once', () => {
    expect(
      Object.keys(
        errorsOf(
          draft({
            fields: one('sku', 'hashed'),
            name: '*',
            unique: true,
            ttl: 'x',
            weights: '{ a: 1 }',
            defaultLanguage: 'en',
          }),
        ),
      ).sort(),
    ).toEqual(['defaultLanguage', 'name', 'ttl', 'unique', 'weights']);
  });

  it('produces canonical EJSON that parses back to the same documents', () => {
    const result = buildIndex(
      draft({ fields: one('createdAt'), ttl: '30', partialFilter: '{ n: NumberLong(5) }' }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(parseEJsonDocument(result.spec.key)).toEqual(result.spec.keyDoc);
      expect(parseEJsonDocument(result.spec.options ?? '')).toEqual(result.spec.optionsDoc);
    }
  });
});

describe('printCreateIndex', () => {
  it('prints the key only when there are no options', () => {
    expect(printCreateIndex('orders', doc([{ key: 'a', value: int32(1) }]), doc([]))).toBe(
      'db.orders.createIndex({ a: 1 })',
    );
  });

  it('prints key and options in shell syntax', () => {
    const result = buildIndex(
      draft({ fields: one('createdAt'), ttl: '3600', partialFilter: '{ status: "open" }' }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(printCreateIndex('orders', result.spec.keyDoc, result.spec.optionsDoc)).toBe(
        'db.orders.createIndex({ createdAt: 1 }, { expireAfterSeconds: 3600, partialFilterExpression: { status: "open" } })',
      );
    }
  });

  it('prints the partial draft of a refused form too', () => {
    const result = buildIndex(draft({ fields: key(['a', '-1'], ['', '1']) }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(printCreateIndex('c', result.keyDoc, result.optionsDoc)).toContain('a: -1');
    }
  });
});
