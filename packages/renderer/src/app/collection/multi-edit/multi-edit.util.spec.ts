import { type BsonDocument, parseEJsonDocument, stringifyEJson } from '@thicket/core/bson';
import { ShellSyntaxError } from '@thicket/core/shellsyntax';
import { describe, expect, it } from 'vitest';

import {
  type FieldEditPlan,
  fieldPathError,
  parseFieldValue,
  planFieldEdit,
} from './multi-edit.util';

const doc = (ejson: string): BsonDocument => parseEJsonDocument(ejson);
const str = (value: string) => ({ type: 'string', value }) as const;

/** The plan with `update` / `expected` as canonical EJSON, so expectations read like the wire. */
function wire(plan: FieldEditPlan) {
  if (plan.kind !== 'update') return plan;
  return {
    kind: plan.kind,
    update: stringifyEJson(plan.update),
    expected: stringifyEJson(plan.expected),
  };
}

describe('fieldPathError', () => {
  it('accepts top-level and dotted paths', () => {
    expect(fieldPathError('status')).toBeNull();
    expect(fieldPathError('address.city')).toBeNull();
    expect(fieldPathError('a.b.c.d')).toBeNull();
    // Only the field named exactly _id is protected.
    expect(fieldPathError('_idx')).toBeNull();
    expect(fieldPathError('meta._id')).toBeNull();
  });

  it('asks for a field when the path is empty or blank', () => {
    expect(fieldPathError('')).toMatch(/Enter the field/);
    expect(fieldPathError('   ')).toMatch(/Enter the field/);
  });

  it('refuses empty segments and operator-like segments', () => {
    for (const path of ['.a', 'a.', 'a..b', '$set', 'a.$b', '$']) {
      expect(fieldPathError(path), path).toMatch(/is not a field path/);
    }
  });

  it('refuses _id and paths below it', () => {
    expect(fieldPathError('_id')).toMatch(/_id/);
    expect(fieldPathError('_id.sub')).toMatch(/_id/);
  });
});

describe('parseFieldValue', () => {
  it('parses shell syntax values', () => {
    expect(parseFieldValue('"shipped"')).toEqual(str('shipped'));
    expect(parseFieldValue('true')).toEqual({ type: 'bool', value: true });
    expect(parseFieldValue('null')).toEqual({ type: 'null' });
    expect(parseFieldValue('{ a: 1 }').type).toBe('object');
    expect(parseFieldValue('ISODate("2026-01-01T00:00:00Z")').type).toBe('date');
  });

  it('refuses an empty or blank value with a ShellSyntaxError', () => {
    expect(() => parseFieldValue('')).toThrow(ShellSyntaxError);
    expect(() => parseFieldValue('  ')).toThrow(/Enter a value/);
  });

  it('refuses code instead of evaluating it', () => {
    expect(() => parseFieldValue('process.exit()')).toThrow(ShellSyntaxError);
    expect(() => parseFieldValue('{ a: ')).toThrow(ShellSyntaxError);
  });
});

describe('planFieldEdit', () => {
  const order = doc(
    '{"_id":{"$numberInt":"1"},"status":"open","address":{"city":"Gent","zip":"9000"}}',
  );

  it('set of an existing top-level field: $set with the old value as the conflict check', () => {
    const plan = planFieldEdit(order, { action: 'set', path: 'status', value: str('shipped') });
    expect(wire(plan)).toEqual({
      kind: 'update',
      update: '{"$set":{"status":"shipped"}}',
      expected: '{"status":{"$eq":"open"}}',
    });
  });

  it('set of a missing top-level field: the conflict check expects it to be absent', () => {
    const plan = planFieldEdit(order, { action: 'set', path: 'priority', value: str('high') });
    expect(plan.kind).toBe('update');
    const w = wire(plan) as { update: string; expected: string };
    expect(w.update).toBe('{"$set":{"priority":"high"}}');
    expect(w.expected).toContain('priority');
  });

  it('set of a nested field changes only that field', () => {
    const plan = planFieldEdit(order, {
      action: 'set',
      path: 'address.city',
      value: str('Brugge'),
    });
    const w = wire(plan) as { kind: string; update: string; expected: string };
    expect(w.kind).toBe('update');
    expect(w.update).toBe('{"$set":{"address.city":"Brugge"}}');
    // Same conflict filter as a single Save: the original value of the top-level field.
    expect(w.expected).toContain('address');
    expect(w.expected).toContain('Gent');
  });

  it('set below a missing field creates the parent documents', () => {
    const plan = planFieldEdit(order, { action: 'set', path: 'meta.tags.first', value: str('x') });
    expect(plan.kind).toBe('update');
    expect((wire(plan) as { update: string }).update).toContain('"x"');
    expect((wire(plan) as { update: string }).update).toContain('meta');
  });

  it('set to the value the document already has is unchanged', () => {
    expect(planFieldEdit(order, { action: 'set', path: 'status', value: str('open') })).toEqual({
      kind: 'unchanged',
    });
    expect(
      planFieldEdit(order, { action: 'set', path: 'address.city', value: str('Gent') }),
    ).toEqual({ kind: 'unchanged' });
  });

  it('set with a different type of the same number is a change', () => {
    const n = doc('{"_id":{"$numberInt":"1"},"qty":{"$numberInt":"5"}}');
    const plan = planFieldEdit(n, {
      action: 'set',
      path: 'qty',
      value: { type: 'double', value: 5 },
    });
    expect(plan.kind).toBe('update');
  });

  it('unset of an existing field: $unset', () => {
    const plan = planFieldEdit(order, { action: 'unset', path: 'status' });
    const w = wire(plan) as { kind: string; update: string; expected: string };
    expect(w.kind).toBe('update');
    expect(w.update).toContain('$unset');
    expect(w.update).toContain('status');
    expect(w.expected).toBe('{"status":{"$eq":"open"}}');
  });

  it('unset of a nested field: $unset of the dotted path', () => {
    const plan = planFieldEdit(order, { action: 'unset', path: 'address.zip' });
    const w = wire(plan) as { kind: string; update: string };
    expect(w.kind).toBe('update');
    expect(w.update).toContain('$unset');
    expect(w.update).toContain('address.zip');
  });

  it('unset of a missing field, or below a missing parent, is unchanged', () => {
    expect(planFieldEdit(order, { action: 'unset', path: 'nothing' })).toEqual({
      kind: 'unchanged',
    });
    expect(planFieldEdit(order, { action: 'unset', path: 'address.nothing' })).toEqual({
      kind: 'unchanged',
    });
    expect(planFieldEdit(order, { action: 'unset', path: 'missing.deeper.still' })).toEqual({
      kind: 'unchanged',
    });
  });

  it('refuses a path through a value that is not a document, naming the full prefix', () => {
    expect(planFieldEdit(order, { action: 'set', path: 'status.code', value: str('x') })).toEqual({
      kind: 'invalid',
      reason: 'status is not a document',
    });
    const deep = doc('{"_id":{"$numberInt":"1"},"a":{"b":{"$numberInt":"3"}}}');
    expect(planFieldEdit(deep, { action: 'set', path: 'a.b.c', value: str('x') })).toEqual({
      kind: 'invalid',
      reason: 'a.b is not a document',
    });
  });

  it('refuses a path through an array (not addressed by index here)', () => {
    const withArray = doc('{"_id":{"$numberInt":"1"},"items":[{"n":{"$numberInt":"1"}}]}');
    const plan = planFieldEdit(withArray, { action: 'set', path: 'items.0', value: str('x') });
    expect(plan).toEqual({ kind: 'invalid', reason: 'items is not a document' });
  });

  it('never plans a whole-document replace when a key repeats on the path', () => {
    // A document with two "a" fields (legal in BSON): the edit of the first one is not
    // expressible as an update, and the batch must not replace the whole document.
    const repeated: BsonDocument = {
      type: 'object',
      fields: [
        { key: '_id', value: { type: 'int', value: 1 } },
        { key: 'a', value: { type: 'object', fields: [{ key: 'b', value: str('x') }] } },
        { key: 'a', value: str('second') },
      ],
    };
    const plan = planFieldEdit(repeated, { action: 'set', path: 'a.b', value: str('y') });
    expect(plan).toEqual({ kind: 'invalid', reason: 'its fields repeat a name on this path' });
  });

  it('does not mutate the loaded document', () => {
    const before = stringifyEJson(order);
    planFieldEdit(order, { action: 'set', path: 'address.city', value: str('Brugge') });
    planFieldEdit(order, { action: 'unset', path: 'status' });
    planFieldEdit(order, { action: 'set', path: 'new.deep', value: str('v') });
    expect(stringifyEJson(order)).toBe(before);
  });
});
