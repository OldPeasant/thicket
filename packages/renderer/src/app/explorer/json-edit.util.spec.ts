import { describe, expect, it } from 'vitest';
import { BsonLeaf, isBsonLeaf } from './bson-value.util';
import { blankItemLike, blankLike } from './json-edit.util';
import { objectFromEntries, orderedKeys } from './key-order.util';

describe('blankItemLike', () => {
  it('gives an array of records a record with every key, blanked', () => {
    const arr = [
      { id: 1, name: 'Ada', contact: { email: 'a@x' } },
      { id: 2, name: 'Bob', role: 'lead' },
    ];
    expect(blankItemLike(arr)).toEqual({ id: 0, name: '', contact: { email: '' }, role: '' });
  });

  it('keeps the keys in the order the table shows them as columns', () => {
    expect(Object.keys(blankItemLike([{ b: 1 }, { a: 1, b: 2, c: 3 }]) as object)).toEqual([
      'b',
      'a',
      'c',
    ]);
  });

  it('blanks a key like the first record that has it', () => {
    expect(blankItemLike([{ v: null }, { v: 'x' }])).toEqual({ v: null });
  });

  it('ignores stray non-record items in an array of records', () => {
    expect(blankItemLike(['', { a: 'x' }, 3])).toEqual({ a: '' });
  });

  it('gives an array of plain values one more of the same type', () => {
    expect(blankItemLike([1, 2])).toBe(0);
    expect(blankItemLike(['a'])).toBe('');
    expect(blankItemLike([true])).toBe(false);
  });

  it('gives an empty array an empty string, as before', () => {
    expect(blankItemLike([])).toBe('');
  });
});

describe('blankLike with BSON values', () => {
  it('keeps the BSON type of a value, blanked', () => {
    expect(blankLike(new BsonLeaf({ type: 'long', value: 42n }))).toEqual(
      new BsonLeaf({ type: 'long', value: 0n }),
    );
    expect(blankLike(new BsonLeaf({ type: 'decimal', value: '9.5' }))).toEqual(
      new BsonLeaf({ type: 'decimal', value: '0' }),
    );
    expect(blankLike(new BsonLeaf({ type: 'binary', subtype: 5, base64: 'AQI=' }))).toEqual(
      new BsonLeaf({ type: 'binary', subtype: 5, base64: '' }),
    );
  });

  it("gives a fresh ObjectId, not a copy of the other row's", () => {
    const blank = blankLike(new BsonLeaf({ type: 'objectId', hex: '65a1b2c3d4e5f60718293a4b' }));
    expect(isBsonLeaf(blank) && blank.bson.type).toBe('objectId');
    expect(isBsonLeaf(blank) && blank.bson.type === 'objectId' && blank.bson.hex).not.toBe(
      '65a1b2c3d4e5f60718293a4b',
    );
  });

  it('turns a deprecated value into a BSON null leaf', () => {
    expect(blankLike(new BsonLeaf({ type: 'symbol', value: 's' }))).toEqual(
      new BsonLeaf({ type: 'null' }),
    );
  });

  it('blanks nested BSON values in documents and arrays, keeping the field order', () => {
    const doc = objectFromEntries([
      ['b', new BsonLeaf({ type: 'int', value: 5 })],
      ['10', [new BsonLeaf({ type: 'double', value: 2.5 })]],
      ['a', 'text'],
    ]);
    const blank = blankLike(doc) as Record<string, unknown>;
    expect(orderedKeys(blank)).toEqual(['b', '10', 'a']);
    expect(blank['b']).toEqual(new BsonLeaf({ type: 'int', value: 0 }));
    expect(blank['10']).toEqual([new BsonLeaf({ type: 'double', value: 0 })]);
    expect(blank['a']).toBe('');
  });

  it('an array of BSON records gets a record of blanked BSON values', () => {
    expect(
      blankItemLike([
        { n: new BsonLeaf({ type: 'long', value: 7n }) },
        { n: new BsonLeaf({ type: 'long', value: 8n }) },
      ]),
    ).toEqual({ n: new BsonLeaf({ type: 'long', value: 0n }) });
  });
});
