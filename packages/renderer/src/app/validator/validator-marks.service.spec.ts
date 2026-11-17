import { computed, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAX_VALIDATOR_CHECK_IDS, type ResultOf } from '@thicket/contract';
import { stringifyEJson } from '@thicket/core/bson';
import { beforeEach, describe, expect, it } from 'vitest';

import { ApiError } from '../api/api-error';
import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import { invalidKeys, ValidatorChanges, ValidatorMarks } from './validator-marks.service';

const T = { profileId: 'p1', db: 'shop', coll: 'orders' };

type CheckResult = ResultOf<'coll.validator.check'>;

/** A promise with its resolve function, to answer requests in a chosen order. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const int = (n: number) => `{"$numberInt":"${n}"}`;

describe('invalidKeys', () => {
  it('turns the invalid array into the keys documentKey prints', () => {
    expect(invalidKeys(`[${int(1)},"a",{"$oid":"64b7f0c2a1b2c3d4e5f60718"}]`)).toEqual(
      new Set([int(1), '"a"', '{"$oid":"64b7f0c2a1b2c3d4e5f60718"}']),
    );
  });

  it('normalizes the server spelling of a value to the renderer one', () => {
    // The driver writes the double 1 as "1.0"; the renderer's documentKey prints its own form.
    const keys = invalidKeys('[{"$numberDouble":"1.0"}, {"b":"x","a":"y"}]');
    expect(keys).toEqual(
      new Set([
        stringifyEJson({ type: 'double', value: 1 }),
        stringifyEJson({
          type: 'object',
          fields: [
            { key: 'b', value: { type: 'string', value: 'x' } },
            { key: 'a', value: { type: 'string', value: 'y' } },
          ],
        }),
      ]),
    );
  });

  it('is empty for an empty array or a value that is not an array', () => {
    expect(invalidKeys('[]')).toEqual(new Set());
    expect(invalidKeys('{"a":1}')).toEqual(new Set());
  });
});

describe('ValidatorChanges', () => {
  it('counts changes per collection', () => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    const changes = TestBed.inject(ValidatorChanges);
    const other = { ...T, coll: 'items' };
    expect(changes.version(T)).toBe(0);
    changes.changed(T);
    changes.changed(T);
    expect(changes.version(T)).toBe(2);
    expect(changes.version(other)).toBe(0);
    expect(changes.version({ ...T, profileId: 'p2' })).toBe(0);
    changes.changed(other);
    expect(changes.version(other)).toBe(1);
    expect(changes.version(T)).toBe(2);
  });

  it('notifies readers of the changed collection only', () => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    const changes = TestBed.inject(ValidatorChanges);
    let runs = 0;
    const watched = computed(() => {
      runs++;
      return changes.version(T);
    });
    expect(watched()).toBe(0);
    changes.changed({ ...T, coll: 'items' });
    expect(watched()).toBe(0);
    expect(runs).toBe(1);
    changes.changed(T);
    expect(watched()).toBe(1);
    expect(runs).toBe(2);
  });

  it('does not confuse names that join to the same text', () => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    const changes = TestBed.inject(ValidatorChanges);
    changes.changed({ profileId: 'p1', db: 'a.b', coll: 'c' });
    expect(changes.version({ profileId: 'p1', db: 'a', coll: 'b.c' })).toBe(0);
  });
});

describe('ValidatorMarks', () => {
  let fake: FakeThicketBridge;
  let marks: ValidatorMarks;

  const checks = () =>
    fake.requestsFor('coll.validator.check').map((r) => r.params as Record<string, unknown>);

  beforeEach(() => {
    fake = new FakeThicketBridge();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideFakeThicket(fake), ValidatorMarks],
    });
    marks = TestBed.inject(ValidatorMarks);
  });

  it('asks the server about the shown _ids and marks the failing ones', async () => {
    fake.respond('coll.validator.check', { invalid: `[${int(2)}]`, hasValidator: true });
    await marks.check(T, [int(1), int(2), null, int(3)]);
    expect(checks()).toEqual([{ ...T, ids: `[${int(1)},${int(2)},${int(3)}]` }]);
    expect(marks.invalid()).toEqual(new Set([int(2)]));
    expect(marks.hasValidator()).toBe(true);
    expect(marks.error()).toBeNull();
  });

  it('marks nothing for a collection without a validator', async () => {
    fake.respond('coll.validator.check', { invalid: '[]', hasValidator: false });
    await marks.check(T, [int(1)]);
    expect(marks.invalid().size).toBe(0);
    expect(marks.hasValidator()).toBe(false);
  });

  it('matches keys of the server answer written another way', async () => {
    fake.respond('coll.validator.check', {
      invalid: '[{"$numberDouble":"1.0"}]',
      hasValidator: true,
    });
    const key = stringifyEJson({ type: 'double', value: 1 });
    await marks.check(T, [key]);
    expect(marks.invalid().has(key)).toBe(true);
  });

  it('sends no request and clears the marks without _ids', async () => {
    fake.respond('coll.validator.check', { invalid: `[${int(1)}]`, hasValidator: true });
    await marks.check(T, [int(1)]);
    expect(marks.invalid().size).toBe(1);
    await marks.check(T, [null, null]);
    await marks.check(T, []);
    expect(checks()).toHaveLength(1);
    expect(marks.invalid().size).toBe(0);
  });

  it('sends no request without a profile', async () => {
    fake.respond('coll.validator.check', { invalid: '[]', hasValidator: true });
    await marks.check({ ...T, profileId: '' }, [int(1)]);
    expect(checks()).toEqual([]);
  });

  it('asks about at most MAX_VALIDATOR_CHECK_IDS _ids', async () => {
    fake.respond('coll.validator.check', { invalid: '[]', hasValidator: true });
    const keys = Array.from({ length: MAX_VALIDATOR_CHECK_IDS + 5 }, (_, i) => int(i));
    await marks.check(T, keys);
    const sent = JSON.parse(checks()[0]?.['ids'] as string) as unknown[];
    expect(sent).toHaveLength(MAX_VALIDATOR_CHECK_IDS);
  });

  it('drops an older answer that arrives after a newer one', async () => {
    const older = deferred<CheckResult>();
    const newer = deferred<CheckResult>();
    let n = 0;
    fake.handle('coll.validator.check', () => (n++ === 0 ? older.promise : newer.promise));
    const first = marks.check(T, [int(1)]);
    const second = marks.check(T, [int(2)]);
    newer.resolve({ invalid: `[${int(2)}]`, hasValidator: true });
    await second;
    older.resolve({ invalid: `[${int(1)}]`, hasValidator: false });
    await first;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(marks.invalid()).toEqual(new Set([int(2)]));
    expect(marks.hasValidator()).toBe(true);
    expect(fake.cancels).toHaveLength(1);
  });

  it('drops an older failure that arrives after a newer answer', async () => {
    const older = deferred<CheckResult | { error: { code: 'SERVER_ERROR'; message: string } }>();
    let n = 0;
    fake.handle('coll.validator.check', () =>
      n++ === 0 ? older.promise : { invalid: `[${int(2)}]`, hasValidator: true },
    );
    const first = marks.check(T, [int(1)]);
    await marks.check(T, [int(2)]);
    older.resolve({ error: { code: 'SERVER_ERROR', message: 'too late' } });
    await first;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(marks.invalid()).toEqual(new Set([int(2)]));
    expect(marks.error()).toBeNull();
  });

  it('drops a pending answer when the page has no _ids any more', async () => {
    const answer = deferred<CheckResult>();
    fake.handle('coll.validator.check', () => answer.promise);
    const first = marks.check(T, [int(1)]);
    await marks.check(T, []);
    answer.resolve({ invalid: `[${int(1)}]`, hasValidator: true });
    await first;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(marks.invalid().size).toBe(0);
  });

  it('clears the marks and keeps the reason when the check fails', async () => {
    fake.respond('coll.validator.check', { invalid: `[${int(1)}]`, hasValidator: true });
    await marks.check(T, [int(1)]);
    fake.fail('coll.validator.check', {
      code: 'SERVER_ERROR',
      message: 'not authorized on shop to execute command { listCollections: 1 }',
    });
    await marks.check(T, [int(1)]);
    expect(marks.invalid().size).toBe(0);
    expect(marks.error()).toContain('not authorized on shop');

    // A later successful check clears the error.
    fake.respond('coll.validator.check', { invalid: '[]', hasValidator: true });
    await marks.check(T, [int(1)]);
    expect(marks.error()).toBeNull();
  });

  it('ignores a CANCELLED answer from the backend', async () => {
    fake.respond('coll.validator.check', { invalid: `[${int(1)}]`, hasValidator: true });
    await marks.check(T, [int(1)]);
    fake.handle('coll.validator.check', () => {
      throw new ApiError({ code: 'CANCELLED', message: 'The operation was cancelled' });
    });
    await marks.check(T, [int(1)]);
    expect(marks.invalid()).toEqual(new Set([int(1)]));
    expect(marks.error()).toBeNull();
  });

  it('stop() cancels a running check and its answer is dropped', async () => {
    const answer = deferred<CheckResult>();
    fake.handle('coll.validator.check', () => answer.promise);
    const pending = marks.check(T, [int(1)]);
    marks.stop();
    expect(fake.cancels).toHaveLength(1);
    answer.resolve({ invalid: `[${int(1)}]`, hasValidator: true });
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(marks.invalid().size).toBe(0);
    // Stopping again is harmless.
    marks.stop();
  });
});
