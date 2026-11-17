import { TestBed } from '@angular/core/testing';
import { computed } from '@angular/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { ArraySliceService, type SliceSource } from './array-slice.service';

/** A promise the test settles explicitly, to control when a page arrives. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = async () => {
  for (let i = 0; i < 3; i++) await Promise.resolve();
};

const range = (skip: number, limit: number) =>
  Array.from({ length: limit }, (_, i) => `item ${skip + i}`);

/** A source of `total` items that records what was read and answers when the test says. */
function source(total: number) {
  const calls: { skip: number; limit: number; answer: ReturnType<typeof deferred<unknown[]>> }[] =
    [];
  const src: SliceSource = {
    total,
    load: (skip, limit) => {
      const answer = deferred<unknown[]>();
      calls.push({ skip, limit, answer });
      return answer.promise;
    },
  };
  return { src, calls };
}

describe('ArraySliceService', () => {
  let slices: ArraySliceService;

  beforeEach(() => {
    slices = TestBed.inject(ArraySliceService);
  });

  it('knows nothing of arrays, objects or primitives that were not registered', () => {
    expect(slices.sourceOf([1, 2])).toBeUndefined();
    expect(slices.sourceOf({})).toBeUndefined();
    expect(slices.sourceOf(null)).toBeUndefined();
    expect(slices.sourceOf('x')).toBeUndefined();
    expect(slices.sourceOf(5)).toBeUndefined();
  });

  it('a page of an array that is not registered is the plain slice', () => {
    expect(slices.page(['a', 'b', 'c'], 1, 3)).toEqual({ items: ['b', 'c'], error: null });
  });

  it('serves pages within the loaded items without reading', () => {
    const { src, calls } = source(5000);
    const loaded = range(0, 100);
    slices.register(loaded, {}, 'items', src);
    expect(slices.sourceOf(loaded)).toBe(src);
    expect(slices.page(loaded, 0, 100)).toEqual({ items: loaded, error: null });
    expect(slices.page(loaded, 50, 100).items).toEqual(range(50, 50));
    expect(calls).toEqual([]);
  });

  it('gives the same page object for the same window within the loaded items', () => {
    const { src } = source(5000);
    const owner = {};
    const loaded = range(0, 100);
    slices.register(loaded, owner, 'items', src);
    const first = slices.page(loaded, 0, 100);
    expect(slices.page(loaded, 0, 100)).toBe(first);
    expect(slices.page(loaded, 0, 50)).not.toBe(first);
    // A tree rebuilt from the same document version gets pages of its own array.
    const rebuilt = range(0, 100);
    slices.register(rebuilt, owner, 'items', src);
    const again = slices.page(rebuilt, 0, 100);
    expect(again).not.toBe(first);
    expect(again.items?.[0]).toBe(rebuilt[0]);
  });

  it('reads a page past the loaded items once: loading, then the items', async () => {
    const { src, calls } = source(5000);
    const loaded = range(0, 100);
    slices.register(loaded, {}, 'items', src);
    expect(slices.page(loaded, 100, 200)).toEqual({ items: null, error: null });
    // Asked again while it loads: no second read.
    expect(slices.page(loaded, 100, 200)).toEqual({ items: null, error: null });
    expect(calls.map(({ skip, limit }) => ({ skip, limit }))).toEqual([{ skip: 100, limit: 100 }]);

    calls[0]?.answer.resolve(range(100, 100));
    await flush();
    expect(slices.page(loaded, 100, 200)).toEqual({ items: range(100, 100), error: null });
    expect(calls).toHaveLength(1);
  });

  it('a page reaching past the loaded items is read whole, also when it starts inside them', () => {
    const { src, calls } = source(5000);
    const loaded = range(0, 100);
    slices.register(loaded, {}, 'items', src);
    slices.page(loaded, 50, 150);
    expect(calls.map(({ skip, limit }) => ({ skip, limit }))).toEqual([{ skip: 50, limit: 100 }]);
  });

  it('tells views reading pages that one arrived (signal)', async () => {
    const { src, calls } = source(5000);
    const loaded = range(0, 100);
    slices.register(loaded, {}, 'items', src);
    const shown = computed(() => slices.page(loaded, 100, 200).items?.[0] ?? 'loading');
    expect(shown()).toBe('loading');
    calls[0]?.answer.resolve(range(100, 100));
    await flush();
    expect(shown()).toBe('item 100');
  });

  it('keeps a failed page with its message until retried, then reads it again', async () => {
    const { src, calls } = source(5000);
    const loaded = range(0, 100);
    slices.register(loaded, {}, 'items', src);
    slices.page(loaded, 100, 200);
    calls[0]?.answer.reject(new Error('server gone'));
    await flush();
    expect(slices.page(loaded, 100, 200)).toEqual({ items: null, error: 'server gone' });
    expect(calls).toHaveLength(1);

    slices.retry(loaded, 100, 200);
    expect(slices.page(loaded, 100, 200)).toEqual({ items: null, error: null });
    expect(calls).toHaveLength(2);
    calls[1]?.answer.resolve(range(100, 100));
    await flush();
    expect(slices.page(loaded, 100, 200).items?.[0]).toBe('item 100');
  });

  it('reports a failure that is not an Error by its text', async () => {
    const { src, calls } = source(5000);
    const loaded = range(0, 100);
    slices.register(loaded, {}, 'items', src);
    slices.page(loaded, 100, 200);
    calls[0]?.answer.reject('timed out');
    await flush();
    expect(slices.page(loaded, 100, 200).error).toBe('timed out');
  });

  it('retry leaves a loaded, loading or unknown page alone', async () => {
    const { src, calls } = source(5000);
    const loaded = range(0, 100);
    slices.register(loaded, {}, 'items', src);
    slices.page(loaded, 100, 200);
    slices.retry(loaded, 100, 200); // still loading
    calls[0]?.answer.resolve(range(100, 100));
    await flush();
    slices.retry(loaded, 100, 200); // loaded
    slices.retry(loaded, 900, 1000); // never asked
    slices.retry(range(0, 3), 0, 1); // not registered
    slices.page(loaded, 100, 200);
    expect(calls).toHaveLength(1);
  });

  it('keeps pages already read for a tree rebuilt from the same document version', async () => {
    const { src, calls } = source(5000);
    const owner = {};
    const before = range(0, 100);
    slices.register(before, owner, 'items', src);
    slices.page(before, 100, 200);
    calls[0]?.answer.resolve(range(100, 100));
    await flush();

    // An edit elsewhere in the document rebuilt the tree: a new array, same owner and path.
    const rebuilt = range(0, 100);
    slices.register(rebuilt, owner, 'items', source(5000).src);
    expect(slices.page(rebuilt, 100, 200).items?.[0]).toBe('item 100');
    expect(calls).toHaveLength(1);
  });

  it('starts over for a reloaded document (another owner)', () => {
    const first = source(5000);
    const loaded = range(0, 100);
    slices.register(loaded, {}, 'items', first.src);
    slices.page(loaded, 100, 200);

    const second = source(5000);
    const reloaded = range(0, 100);
    slices.register(reloaded, {}, 'items', second.src);
    expect(slices.sourceOf(reloaded)).toBe(second.src);
    slices.page(reloaded, 100, 200);
    expect(second.calls).toHaveLength(1);
  });

  it('starts over when the array length on the server changed', async () => {
    const first = source(5000);
    const owner = {};
    const loaded = range(0, 100);
    slices.register(loaded, owner, 'items', first.src);
    slices.page(loaded, 100, 200);
    first.calls[0]?.answer.resolve(range(100, 100));
    await flush();

    const second = source(4000);
    const again = range(0, 100);
    slices.register(again, owner, 'items', second.src);
    expect(slices.sourceOf(again)?.total).toBe(4000);
    expect(slices.page(again, 100, 200)).toEqual({ items: null, error: null });
    expect(second.calls).toHaveLength(1);
  });

  it('keeps the arrays of one document apart by path', () => {
    const items = source(5000);
    const lines = source(3000);
    const owner = {};
    const a = range(0, 100);
    const b = range(0, 100);
    slices.register(a, owner, 'items', items.src);
    slices.register(b, owner, 'lines', lines.src);
    expect(slices.sourceOf(a)?.total).toBe(5000);
    expect(slices.sourceOf(b)?.total).toBe(3000);
    slices.page(b, 100, 200);
    expect(items.calls).toHaveLength(0);
    expect(lines.calls).toHaveLength(1);
  });
});
