import { describe, expect, it } from 'vitest';
import { withEntry, withoutEntry } from './json-edit.util';

// withoutEntry was rewritten from spread + delete to Object.fromEntries for the strict lint;
// the editor relies on it keeping every other key, their order, and the input untouched.
describe('withoutEntry', () => {
  it('removes the key and keeps the other keys in their order', () => {
    const obj = { b: 1, a: 'x', c: null };
    const out = withoutEntry(obj, 'a');
    expect(out).toEqual({ b: 1, c: null });
    expect(Object.keys(out)).toEqual(['b', 'c']);
  });

  it('does not change the object it was given', () => {
    const nested = { deep: [1, 2] };
    const obj = { keep: nested, drop: true };
    const out = withoutEntry(obj, 'drop');
    expect(obj).toEqual({ keep: { deep: [1, 2] }, drop: true });
    expect(out).not.toBe(obj);
    // A shallow copy, as before: nested values are shared, not cloned.
    expect(out['keep']).toBe(nested);
  });

  it('returns an equal copy when the key is absent, and an empty object for the last key', () => {
    const obj = { a: 1 };
    expect(withoutEntry(obj, 'nope')).toEqual({ a: 1 });
    expect(withoutEntry(obj, 'nope')).not.toBe(obj);
    expect(withoutEntry(obj, 'a')).toEqual({});
  });

  it('keeps numeric-looking and empty keys apart from the one removed', () => {
    const out = withoutEntry({ '': 'empty', '1': 'one', '01': 'zero-one' }, '1');
    expect(out).toEqual({ '': 'empty', '01': 'zero-one' });
  });

  it('keeps a "__proto__" key from a parsed document as plain data', () => {
    const doc = JSON.parse('{"__proto__": {"polluted": true}, "name": "x"}') as Record<
      string,
      unknown
    >;
    const out = withoutEntry(doc, 'name');
    expect(Object.keys(out)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect((out as { polluted?: boolean }).polluted).toBeUndefined();
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();

    const removed = withoutEntry(doc, '__proto__');
    expect(Object.keys(removed)).toEqual(['name']);
    expect(Object.getPrototypeOf(removed)).toBe(Object.prototype);
  });

  it('undoes withEntry for a new key', () => {
    const obj = { a: 1 };
    expect(withoutEntry(withEntry(obj, 'b', 2), 'b')).toEqual(obj);
  });
});
