import { describe, expect, it } from 'vitest';

import { parseEJson, parseEJsonDocument, stringifyEJson } from '../bson/ejson';
import { doc, int32, str } from '../bson/model';
import { renameAt } from '../bson/path';
import { diffDocuments, isAddressableKey, toUpdateDocument } from './diff';
import { bsonEquals } from './equals';
import { DIFF_CASES } from './fixtures';

const canonical = (text: string) => stringifyEJson(parseEJson(text));

describe('diffDocuments', () => {
  it.each(DIFF_CASES)('$name', (c) => {
    const original = parseEJsonDocument(c.original);
    const edited = parseEJsonDocument(c.edited);
    const diff = diffDocuments(original, edited);

    if (c.update === 'none') {
      expect(diff).toEqual({ kind: 'none' });
      return;
    }
    if (diff.kind === 'none') throw new Error('expected a change');
    if (c.update === 'replace') {
      expect(diff.kind).toBe('replace');
      if (diff.kind === 'replace') expect(diff.replacement).toBe(edited);
    } else {
      expect(diff.kind).toBe('update');
      if (diff.kind === 'update') expect(stringifyEJson(diff.update)).toBe(canonical(c.update));
    }
    expect(stringifyEJson(diff.expected)).toBe(canonical(c.expected ?? '{}'));
    const id = original.fields[0];
    expect(stringifyEJson(diff.filter)).toBe(
      stringifyEJson(doc([id as never, ...diff.expected.fields])),
    );
  });

  it('treats a rename made with renameAt (field keeps its position) as unset + set', () => {
    const original = parseEJsonDocument('{"_id":1,"name":"x","n":1}');
    const edited = renameAt(original, ['name'], 'title');
    const diff = diffDocuments(original, edited as never);
    // The renamed field keeps its position in the editor; the shared fields are still in order.
    expect(diff.kind).toBe('update');
    if (diff.kind === 'update') {
      expect(stringifyEJson(diff.update)).toBe(
        canonical('{"$set":{"title":"x"},"$unset":{"name":""}}'),
      );
      expect(diff.changedFields).toEqual(['name', 'title']);
    }
  });

  it('lists the operations and changed top-level fields', () => {
    const diff = diffDocuments(
      parseEJsonDocument('{"_id":1,"a":{"b":1,"c":2},"l":[1]}'),
      parseEJsonDocument('{"_id":1,"a":{"b":2},"l":[1,2]}'),
    );
    expect(diff.kind).toBe('update');
    if (diff.kind !== 'update') return;
    expect(diff.ops).toEqual([
      { op: 'set', path: 'a.b', value: int32(2) },
      { op: 'unset', path: 'a.c' },
      { op: 'push', path: 'l', items: [int32(2)] },
    ]);
    expect(diff.changedFields).toEqual(['a', 'l']);
  });

  it('replaces a document with repeated keys instead of guessing which one changed', () => {
    const original = doc([
      { key: '_id', value: int32(1) },
      {
        key: 'a',
        value: doc([
          { key: 'k', value: int32(1) },
          { key: 'k', value: int32(2) },
        ]),
      },
    ]);
    const edited = doc([
      { key: '_id', value: int32(1) },
      {
        key: 'a',
        value: doc([
          { key: 'k', value: int32(1) },
          { key: 'k', value: int32(3) },
        ]),
      },
    ]);
    const diff = diffDocuments(original, edited);
    expect(diff.kind).toBe('update');
    if (diff.kind === 'update')
      expect(diff.ops).toEqual([{ op: 'set', path: 'a', value: edited.fields[1]?.value }]);
  });

  it('replaces the whole document when the top level has repeated keys', () => {
    const original = doc([
      { key: '_id', value: int32(1) },
      { key: 'k', value: int32(1) },
      { key: 'k', value: int32(2) },
    ]);
    const edited = doc([
      { key: '_id', value: int32(1) },
      { key: 'k', value: int32(1) },
      { key: 'k', value: int32(3) },
    ]);
    const diff = diffDocuments(original, edited);
    expect(diff.kind).toBe('replace');
    // The first values are equal, so nothing differs by name: the filter checks every field.
    if (diff.kind === 'replace') expect(diff.changedFields).toEqual(['k']);
  });

  it('replaces the document for a top-level key with a $ prefix (no update path for it)', () => {
    const diff = diffDocuments(
      parseEJsonDocument('{"_id":1,"c":1}'),
      parseEJsonDocument('{"_id":1,"c":1,"$x":1}'),
    );
    expect(diff.kind).toBe('replace');
    if (diff.kind === 'replace') {
      expect(stringifyEJson(diff.expected)).toBe(
        canonical(
          '{"$expr":{"$eq":[{"$type":{"$getField":{"field":{"$literal":"$x"},"input":"$$ROOT"}}},"missing"]}}',
        ),
      );
    }
  });

  it('refuses a changed or removed _id and a document without _id', () => {
    const original = parseEJsonDocument('{"_id":1,"a":1}');
    expect(() => diffDocuments(original, parseEJsonDocument('{"_id":2,"a":1}'))).toThrow(
      /_id .* cannot be changed/,
    );
    expect(() => diffDocuments(original, parseEJsonDocument('{"a":1}'))).toThrow(
      /cannot be changed/,
    );
    expect(() =>
      diffDocuments(parseEJsonDocument('{"a":1}'), parseEJsonDocument('{"a":2}')),
    ).toThrow(/no _id/);
  });
});

describe('diffDocuments edge cases', () => {
  it('treats an _id of another numeric type (int 1 vs long 1) as a changed _id', () => {
    expect(() =>
      diffDocuments(
        parseEJsonDocument('{"_id":{"$numberInt":"1"},"a":1}'),
        parseEJsonDocument('{"_id":{"$numberLong":"1"},"a":2}'),
      ),
    ).toThrow(/cannot be changed/);
  });

  it('checks every original field except _id for a pure top-level reorder', () => {
    const diff = diffDocuments(
      parseEJsonDocument('{"_id":1,"a":1,"b":{"c":2},"d":[3]}'),
      parseEJsonDocument('{"_id":1,"d":[3],"a":1,"b":{"c":2}}'),
    );
    expect(diff.kind).toBe('replace');
    if (diff.kind !== 'replace') return;
    expect(diff.changedFields).toEqual(['a', 'b', 'd']);
    expect(stringifyEJson(diff.filter)).toBe(
      canonical('{"_id":1,"a":{"$eq":1},"b":{"$eq":{"c":2}},"d":{"$eq":[3]}}'),
    );
  });

  it('lists changed fields of a replace in original order, then new fields', () => {
    const diff = diffDocuments(
      parseEJsonDocument('{"_id":1,"a":1,"b":2,"c":3}'),
      parseEJsonDocument('{"_id":1,"c":4,"b":2,"n":0}'),
    );
    expect(diff.kind).toBe('replace');
    if (diff.kind === 'replace') expect(diff.changedFields).toEqual(['a', 'c', 'n']);
  });

  it('does not modify its inputs', () => {
    const originalText = '{"_id":1,"a":{"b":1,"x":[1]},"r":true}';
    const editedText = '{"_id":1,"a":{"b":2,"x":[1,2]},"n":1}';
    const original = parseEJsonDocument(originalText);
    const edited = parseEJsonDocument(editedText);
    diffDocuments(original, edited);
    expect(stringifyEJson(original)).toBe(canonical(originalText));
    expect(stringifyEJson(edited)).toBe(canonical(editedText));
  });

  it('returns none for a structurally equal but separately built document', () => {
    const text = '{"_id":1,"d":{"$numberDouble":"NaN"},"a":[{"b":null}]}';
    expect(diffDocuments(parseEJsonDocument(text), parseEJsonDocument(text))).toEqual({
      kind: 'none',
    });
  });

  it('accepts _id values of any type, including documents', () => {
    const diff = diffDocuments(
      parseEJsonDocument('{"_id":{"k":1,"t":"x"},"a":1}'),
      parseEJsonDocument('{"_id":{"k":1,"t":"x"},"a":2}'),
    );
    expect(diff.kind).toBe('update');
    if (diff.kind === 'update')
      expect(stringifyEJson(diff.filter)).toBe(canonical('{"_id":{"k":1,"t":"x"},"a":{"$eq":1}}'));
  });

  it('refuses a document whose _id was reordered inside (embedded _id is compared exactly)', () => {
    expect(() =>
      diffDocuments(
        parseEJsonDocument('{"_id":{"k":1,"t":"x"},"a":1}'),
        parseEJsonDocument('{"_id":{"t":"x","k":1},"a":1}'),
      ),
    ).toThrow(/cannot be changed/);
  });
});

describe('toUpdateDocument', () => {
  it('groups operations by operator in $set, $unset, $push order, keeping op order inside', () => {
    const update = toUpdateDocument([
      { op: 'push', path: 'l', items: [int32(1)] },
      { op: 'unset', path: 'u' },
      { op: 'set', path: 'b', value: str('x') },
      { op: 'set', path: 'a', value: int32(2) },
    ]);
    expect(stringifyEJson(update)).toBe(
      canonical('{"$set":{"b":"x","a":2},"$unset":{"u":""},"$push":{"l":{"$each":[1]}}}'),
    );
  });

  it('returns an empty document for no operations', () => {
    expect(toUpdateDocument([])).toEqual(doc());
  });
});

describe('isAddressableKey', () => {
  it.each([
    ['a', true],
    ['a_b', true],
    ['0', true],
    ['', false],
    ['a.b', false],
    ['$a', false],
    ['a$', true],
  ])('%j → %s', (key, ok) => {
    expect(isAddressableKey(key)).toBe(ok);
  });
});

describe('bsonEquals', () => {
  const v = (text: string) => parseEJson(text);
  it.each([
    ['{"a":1,"b":2}', '{"a":1,"b":2}', true],
    ['{"a":1,"b":2}', '{"b":2,"a":1}', false],
    ['{"a":1}', '{"a":1,"b":2}', false],
    ['[1,2]', '[1,2]', true],
    ['[1,2]', '[1]', false],
    ['[1,2]', '{"a":1}', false],
    ['{"$numberInt":"1"}', '{"$numberLong":"1"}', false],
    ['{"$numberInt":"1"}', '{"$numberDouble":"1.0"}', false],
    ['{"$numberDouble":"NaN"}', '{"$numberDouble":"NaN"}', true],
    ['{"$numberDouble":"-0.0"}', '{"$numberDouble":"0.0"}', false],
    ['{"$numberDecimal":"1.0"}', '{"$numberDecimal":"1.00"}', false],
    ['"a"', '{"$symbol":"a"}', false],
    ['{"$symbol":"a"}', '{"$symbol":"a"}', true],
    ['{"$code":"x"}', '{"$code":"x"}', true],
    ['{"$code":"x"}', '{"$code":"x","$scope":{}}', false],
    ['{"$code":"x","$scope":{"a":1}}', '{"$code":"x","$scope":{"a":1}}', true],
    ['{"$code":"x","$scope":{"a":1}}', '{"$code":"x","$scope":{"a":2}}', false],
    [
      '{"$binary":{"base64":"AQ==","subType":"00"}}',
      '{"$binary":{"base64":"AQ==","subType":"05"}}',
      false,
    ],
    ['{"$oid":"65a1b2c3d4e5f60718293a4b"}', '{"$oid":"65a1b2c3d4e5f60718293a4b"}', true],
    ['{"$date":{"$numberLong":"1"}}', '{"$date":{"$numberLong":"2"}}', false],
    [
      '{"$regularExpression":{"pattern":"a","options":"i"}}',
      '{"$regularExpression":{"pattern":"a","options":""}}',
      false,
    ],
    [
      '{"$dbPointer":{"$ref":"c","$id":{"$oid":"65a1b2c3d4e5f60718293a4b"}}}',
      '{"$dbPointer":{"$ref":"c","$id":{"$oid":"65a1b2c3d4e5f60718293a4b"}}}',
      true,
    ],
    ['{"$timestamp":{"t":1,"i":2}}', '{"$timestamp":{"t":1,"i":3}}', false],
    ['{"$undefined":true}', 'null', false],
    ['{"$minKey":1}', '{"$minKey":1}', true],
    ['{"$minKey":1}', '{"$maxKey":1}', false],
    ['true', 'true', true],
  ])('%s vs %s → %s', (a, b, eq) => {
    expect(bsonEquals(v(a), v(b))).toBe(eq);
    expect(bsonEquals(v(b), v(a))).toBe(eq);
  });

  it('is true for the same instance', () => {
    const s = str('x');
    expect(bsonEquals(s, s)).toBe(true);
  });
});
