import {
  type BsonDocument,
  type BsonValue,
  parseEJsonDocument,
  stringifyEJson,
} from '@thicket/core/bson';
import { type UpdateOp } from '@thicket/core/diff';
import { describe, expect, it } from 'vitest';

import { applyUpdate } from './apply-update';

const doc = (text: string): BsonDocument => parseEJsonDocument(text);
/** A value written as EJSON (`'"x"'`, `'{"$numberInt":"1"}'`, `'[1]'`, ...). */
const value = (text: string): BsonValue => {
  const field = doc(`{"v":${text}}`).fields[0];
  if (field === undefined) throw new Error('no value');
  return field.value;
};
const text = (d: BsonDocument) => stringifyEJson(d);

const BASE = '{"_id":"a","status":"open","total":{"$numberInt":"10"},"note":"x"}';

// applyUpdate models how MongoDB applies $set/$unset/$push, so "Undo last save" can tell whether a
// minimal update would restore the pre-save version with its field order.
describe('applyUpdate', () => {
  it('returns the document unchanged for no operations', () => {
    expect(text(applyUpdate(doc(BASE), []))).toBe(BASE);
  });

  it('$set of an existing field keeps its place', () => {
    const result = applyUpdate(doc(BASE), [{ op: 'set', path: 'total', value: value('"15"') }]);
    expect(text(result)).toBe('{"_id":"a","status":"open","total":"15","note":"x"}');
  });

  it('$set of a new field appends it last', () => {
    const result = applyUpdate(doc(BASE), [{ op: 'set', path: 'qty', value: value('"2"') }]);
    expect(result.fields.map((f) => f.key)).toEqual(['_id', 'status', 'total', 'note', 'qty']);
  });

  it('$unset removes the field and keeps the others in order', () => {
    const result = applyUpdate(doc(BASE), [{ op: 'unset', path: 'status' }]);
    expect(text(result)).toBe('{"_id":"a","total":{"$numberInt":"10"},"note":"x"}');
  });

  it('$unset of a missing field changes nothing', () => {
    expect(text(applyUpdate(doc(BASE), [{ op: 'unset', path: 'missing' }]))).toBe(BASE);
  });

  it('a removed field set again comes back last, so the order differs from the original', () => {
    const removed = applyUpdate(doc(BASE), [{ op: 'unset', path: 'status' }]);
    const restored = applyUpdate(removed, [{ op: 'set', path: 'status', value: value('"open"') }]);
    expect(restored.fields.map((f) => f.key)).toEqual(['_id', 'total', 'note', 'status']);
    expect(text(restored)).not.toBe(BASE);
  });

  describe('dotted paths', () => {
    const NESTED = '{"_id":"a","addr":{"city":"Springfield","zip":"12345"},"tags":"t"}';

    it('$set of an existing nested field keeps its place in the sub-document', () => {
      const result = applyUpdate(doc(NESTED), [
        { op: 'set', path: 'addr.city', value: value('"Shelbyville"') },
      ]);
      expect(text(result)).toBe(
        '{"_id":"a","addr":{"city":"Shelbyville","zip":"12345"},"tags":"t"}',
      );
    });

    it('$set of a new nested field appends it to its parent only', () => {
      const result = applyUpdate(doc(NESTED), [
        { op: 'set', path: 'addr.street', value: value('"Main St"') },
      ]);
      expect(text(result)).toBe(
        '{"_id":"a","addr":{"city":"Springfield","zip":"12345","street":"Main St"},"tags":"t"}',
      );
    });

    it('$set under a missing parent creates the parent, appended last', () => {
      const result = applyUpdate(doc(NESTED), [
        { op: 'set', path: 'meta.source.name', value: value('"import"') },
      ]);
      expect(text(result)).toBe(
        '{"_id":"a","addr":{"city":"Springfield","zip":"12345"},"tags":"t",' +
          '"meta":{"source":{"name":"import"}}}',
      );
    });

    it('$unset of a nested field removes it from its parent, keeping the parent', () => {
      const result = applyUpdate(doc(NESTED), [{ op: 'unset', path: 'addr.city' }]);
      expect(text(result)).toBe('{"_id":"a","addr":{"zip":"12345"},"tags":"t"}');
    });

    it('$unset under a missing parent or a non-object parent changes nothing', () => {
      expect(text(applyUpdate(doc(NESTED), [{ op: 'unset', path: 'nope.city' }]))).toBe(NESTED);
      expect(text(applyUpdate(doc(NESTED), [{ op: 'unset', path: 'tags.x' }]))).toBe(NESTED);
    });
  });

  describe('$push', () => {
    it('appends the items to an existing array', () => {
      const result = applyUpdate(doc('{"_id":"a","items":["x"],"n":"1"}'), [
        { op: 'push', path: 'items', items: [value('"y"'), value('"z"')] },
      ]);
      expect(text(result)).toBe('{"_id":"a","items":["x","y","z"],"n":"1"}');
    });

    it('creates the array, appended last, when the field is missing', () => {
      const result = applyUpdate(doc('{"_id":"a","n":"1"}'), [
        { op: 'push', path: 'items', items: [value('"y"')] },
      ]);
      expect(text(result)).toBe('{"_id":"a","n":"1","items":["y"]}');
    });

    it('appends to a nested array', () => {
      const result = applyUpdate(doc('{"_id":"a","o":{"items":["x"]}}'), [
        { op: 'push', path: 'o.items', items: [value('"y"')] },
      ]);
      expect(text(result)).toBe('{"_id":"a","o":{"items":["x","y"]}}');
    });
  });

  it('applies several operations in turn', () => {
    const ops: UpdateOp[] = [
      { op: 'set', path: 'total', value: value('{"$numberInt":"15"}') },
      { op: 'unset', path: 'note' },
      { op: 'set', path: 'qty', value: value('{"$numberInt":"3"}') },
    ];
    expect(text(applyUpdate(doc(BASE), ops))).toBe(
      '{"_id":"a","status":"open","total":{"$numberInt":"15"},"qty":{"$numberInt":"3"}}',
    );
  });

  it('does not change the document it is given', () => {
    const original = doc('{"_id":"a","o":{"k":"v"},"items":["x"]}');
    applyUpdate(original, [
      { op: 'set', path: 'o.k', value: value('"w"') },
      { op: 'unset', path: '_id' },
      { op: 'push', path: 'items', items: [value('"y"')] },
    ]);
    expect(text(original)).toBe('{"_id":"a","o":{"k":"v"},"items":["x"]}');
  });
});
