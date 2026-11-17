import { describe, expect, it } from 'vitest';

import { TYPE_TO_CONFIRM_ABOVE } from '../../safety/safety.types';
import { describeBulk, needsTypedName, parseUpdate } from './bulk.util';

describe('parseUpdate', () => {
  it('turns an operator document into canonical EJSON', () => {
    expect(parseUpdate('{ $set: { status: "archived" }, $inc: { n: 1 } }')).toEqual({
      ok: true,
      update: '{"$set":{"status":"archived"},"$inc":{"n":{"$numberInt":"1"}}}',
    });
  });

  it('accepts an update pipeline of documents', () => {
    expect(parseUpdate('[{ $set: { total: { $add: ["$a", "$b"] } } }, { $unset: "tmp" }]')).toEqual(
      {
        ok: true,
        update: '[{"$set":{"total":{"$add":["$a","$b"]}}},{"$unset":"tmp"}]',
      },
    );
  });

  it('keeps BSON types of shell constructors (dates, longs)', () => {
    const parsed = parseUpdate(
      '{ $set: { at: ISODate("2026-01-02T03:04:05Z"), n: NumberLong(5) } }',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(JSON.parse(parsed.update)).toEqual({
      $set: { at: { $date: { $numberLong: '1767323045000' } }, n: { $numberLong: '5' } },
    });
  });

  it.each(['', '   ', '\n\t '])('asks for an update when the text is empty (%j)', (text) => {
    const parsed = parseUpdate(text);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain('Type an update');
  });

  it('reports a syntax error with its position', () => {
    const parsed = parseUpdate('{ $set: { a: } }');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/line 1, column \d+/);
  });

  it('refuses code instead of evaluating it', () => {
    const parsed = parseUpdate('{ $set: { a: process.exit() } }');
    expect(parsed.ok).toBe(false);
  });

  it('refuses an empty update document', () => {
    expect(parseUpdate('{}')).toEqual({ ok: false, error: 'The update document is empty' });
  });

  it('refuses a replacement document, naming the plain field', () => {
    const parsed = parseUpdate('{ status: "archived" }');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain('"status" is not an update operator');
      expect(parsed.error).toContain('$set: { status:');
    }
  });

  it('refuses a plain field mixed with operators', () => {
    const parsed = parseUpdate('{ $set: { a: 1 }, b: 2 }');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain('"b" is not an update operator');
  });

  it('refuses an empty pipeline', () => {
    expect(parseUpdate('[]')).toEqual({ ok: false, error: 'The update pipeline is empty' });
  });

  it('refuses a pipeline with a stage that is not a document', () => {
    expect(parseUpdate('[{ $set: { a: 1 } }, 5]')).toEqual({
      ok: false,
      error: 'Every stage of an update pipeline must be a document',
    });
  });

  it.each(['5', '"text"', 'null', 'true'])('refuses a scalar (%s)', (text) => {
    const parsed = parseUpdate(text);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain('Expected an update document');
  });
});

describe('needsTypedName', () => {
  it('asks for the collection name only above the threshold of 1 000', () => {
    expect(TYPE_TO_CONFIRM_ABOVE).toBe(1000);
    expect(needsTypedName(0)).toBe(false);
    expect(needsTypedName(1)).toBe(false);
    expect(needsTypedName(999)).toBe(false);
    expect(needsTypedName(1000)).toBe(false);
    expect(needsTypedName(1001)).toBe(true);
    expect(needsTypedName(1500)).toBe(true);
  });
});

describe('describeBulk', () => {
  const query = { filter: '{"status":"open"}' };

  it('describes an update with the parsed update', () => {
    expect(describeBulk('orders', 'update', query, '{"$set":{"status":"archived"}}')).toBe(
      'db.orders.updateMany({ status: "open" }, { $set: { status: "archived" } })',
    );
  });

  it('shows a placeholder while the update is not valid', () => {
    expect(describeBulk('orders', 'update', query, null)).toBe(
      'db.orders.updateMany({ status: "open" }, <update>)',
    );
  });

  it('describes a delete without the update', () => {
    expect(describeBulk('orders', 'delete', query, '{"$set":{"a":1}}')).toBe(
      'db.orders.deleteMany({ status: "open" })',
    );
  });

  it('adds the collation as an option', () => {
    expect(
      describeBulk(
        'orders',
        'delete',
        { filter: '{}', collation: '{"locale":"de","strength":{"$numberInt":"2"}}' },
        null,
      ),
    ).toBe('db.orders.deleteMany({}, { collation: { locale: "de", strength: 2 } })');
  });

  it('puts the collation after the update', () => {
    expect(
      describeBulk(
        'orders',
        'update',
        { filter: '{}', collation: '{"locale":"fr"}' },
        '{"$set":{"a":true}}',
      ),
    ).toBe('db.orders.updateMany({}, { $set: { a: true } }, { collation: { locale: "fr" } })');
  });

  it.each([
    ['order-items', 'db["order-items"]'],
    ['2024_orders', 'db["2024_orders"]'],
    ['system.views', 'db["system.views"]'],
    ['with "quote"', 'db["with \\"quote\\""]'],
    ['_tmp$1', 'db._tmp$1'],
  ])('addresses collection %j as %s', (coll, target) => {
    expect(describeBulk(coll, 'delete', { filter: '{}' }, null)).toBe(`${target}.deleteMany({})`);
  });
});
