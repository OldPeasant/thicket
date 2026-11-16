import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { StatusService } from './status.service';

/** A promise settled from the test. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('StatusService', () => {
  let status: StatusService;
  const labels = () => status.operations().map((op) => op.label);

  beforeEach(() => {
    status = TestBed.inject(StatusService);
  });

  it('starts without a connection and without operations', () => {
    expect(status.connection()).toBeNull();
    expect(status.operations()).toEqual([]);
    expect(status.current()).toBeNull();
  });

  it('sets and clears the connection', () => {
    status.setConnection({ name: 'local-dev', state: 'connecting', readonly: true });
    expect(status.connection()).toEqual({ name: 'local-dev', state: 'connecting', readonly: true });
    status.setConnection(null);
    expect(status.connection()).toBeNull();
  });

  it('the newest running operation is the current one', () => {
    const a = status.begin('Loading orders');
    status.begin('Counting documents', 0.5);
    expect(labels()).toEqual(['Loading orders', 'Counting documents']);
    expect(status.current()).toMatchObject({ label: 'Counting documents', progress: 0.5 });
    a.done();
    expect(status.current()?.label).toBe('Counting documents');
  });

  it('gives every operation its own id, also with equal labels', () => {
    const a = status.begin('Export');
    status.begin('Export');
    const [first, second] = status.operations();
    expect(first?.id).not.toBe(second?.id);
    a.done();
    expect(status.operations()).toHaveLength(1);
    expect(status.operations()[0]?.id).toBe(second?.id);
  });

  it('update changes progress and label of that operation only', () => {
    const a = status.begin('Import');
    const b = status.begin('Count');
    a.update({ progress: 0.3 });
    b.update({ label: 'Count (estimated)' });
    expect(status.operations()).toEqual([
      expect.objectContaining({ label: 'Import', progress: 0.3 }),
      expect.objectContaining({ label: 'Count (estimated)', progress: undefined }),
    ]);
  });

  it('done is idempotent and update after done does not bring the operation back', () => {
    const a = status.begin('Import');
    a.done();
    a.done();
    a.update({ progress: 1 });
    expect(status.operations()).toEqual([]);
    expect(status.current()).toBeNull();
  });

  describe('track', () => {
    it('shows the label while the work runs and resolves with its value', async () => {
      const work = deferred<number>();
      const tracked = status.track('Counting documents', work.promise);
      expect(labels()).toEqual(['Counting documents']);
      expect(status.current()?.progress).toBeUndefined();
      work.resolve(42);
      await expect(tracked).resolves.toBe(42);
      expect(status.operations()).toEqual([]);
    });

    it('removes the operation and rejects like the work when it fails', async () => {
      const work = deferred<number>();
      const tracked = status.track('Loading', work.promise);
      work.reject(new Error('timeout'));
      await expect(tracked).rejects.toThrow('timeout');
      expect(status.operations()).toEqual([]);
    });

    it('overlapping tracked work finishing in reverse order removes only its own entry', async () => {
      const older = deferred<string>();
      const newer = deferred<string>();
      const first = status.track('First', older.promise);
      const second = status.track('Second', newer.promise);
      expect(status.current()?.label).toBe('Second');
      older.resolve('a');
      await first;
      expect(labels()).toEqual(['Second']);
      newer.reject(new Error('cancelled'));
      await expect(second).rejects.toThrow('cancelled');
      expect(labels()).toEqual([]);
    });
  });
});
