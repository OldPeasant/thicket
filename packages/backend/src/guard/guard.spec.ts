import { WRITE_METHODS, methods } from '@thicket/contract';
import { describe, expect, it, vi } from 'vitest';

import { RpcError, type Handler } from '../server/rpc';
import {
  BULK_WRITE_METHODS,
  checkWrite,
  guardWrites,
  isWrite,
  pipelineWrites,
  type GuardedProfile,
} from './guard';

const ctx = { signal: new AbortController().signal, requestId: '1' };
const OUT_PIPELINE = JSON.stringify([{ $match: {} }, { $out: 'copy' }]);

/** Params that make each write method write (agg.run needs a $out stage). */
function writeParams(method: string, confirmed?: boolean): Record<string, unknown> {
  const params: Record<string, unknown> = { profileId: 'p1', db: 'd', coll: 'c' };
  if (method === 'agg.run') params['pipeline'] = OUT_PIPELINE;
  if (confirmed !== undefined) params['confirmed'] = confirmed;
  return params;
}

function setup(profile: GuardedProfile) {
  const inner = vi.fn(() => 'ran');
  const handlers: Record<string, Handler> = {};
  for (const method of WRITE_METHODS) handlers[method] = inner;
  handlers['docs.find'] = inner;
  const lookup = vi.fn(() => profile);
  return { guarded: guardWrites(handlers, lookup), inner, lookup };
}

async function codeOf(promise: unknown): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof RpcError ? error.code : 'not an RpcError';
  }
}

describe('write guard', () => {
  it('covers every write method of the contract', () => {
    expect(WRITE_METHODS.length).toBeGreaterThan(10);
    for (const method of WRITE_METHODS) expect(methods[method]).toHaveProperty('write');
  });

  it.each(WRITE_METHODS)('read-only profile refuses %s, also when confirmed', async (method) => {
    const { guarded, inner } = setup({ readOnly: true, production: false });
    const handler = guarded[method] as Handler;
    expect(await codeOf(handler(writeParams(method) as never, ctx))).toBe('READ_ONLY');
    expect(await codeOf(handler(writeParams(method, true) as never, ctx))).toBe('READ_ONLY');
    expect(inner).not.toHaveBeenCalled();
  });

  it.each(WRITE_METHODS)(
    'production profile refuses %s without confirmed: true',
    async (method) => {
      const { guarded, inner } = setup({ readOnly: false, production: true });
      const handler = guarded[method] as Handler;
      expect(await codeOf(handler(writeParams(method) as never, ctx))).toBe(
        'CONFIRMATION_REQUIRED',
      );
      expect(await codeOf(handler(writeParams(method, false) as never, ctx))).toBe(
        'CONFIRMATION_REQUIRED',
      );
      expect(inner).not.toHaveBeenCalled();
      await expect(handler(writeParams(method, true) as never, ctx)).resolves.toBe('ran');
      expect(inner).toHaveBeenCalledTimes(1);
    },
  );

  it.each(WRITE_METHODS)(
    'an ordinary profile runs %s (bulk writes need confirmed)',
    async (method) => {
      const { guarded, inner } = setup({ readOnly: false, production: false });
      const handler = guarded[method] as Handler;
      if (BULK_WRITE_METHODS.includes(method)) {
        expect(await codeOf(handler(writeParams(method) as never, ctx))).toBe(
          'CONFIRMATION_REQUIRED',
        );
        expect(inner).not.toHaveBeenCalled();
      }
      await expect(handler(writeParams(method, true) as never, ctx)).resolves.toBe('ran');
      if (!BULK_WRITE_METHODS.includes(method)) {
        await expect(handler(writeParams(method) as never, ctx)).resolves.toBe('ran');
      }
    },
  );

  it('leaves reads alone (no profile lookup)', async () => {
    const { guarded, lookup } = setup({ readOnly: true, production: true });
    expect(guarded['docs.find']?.({ profileId: 'p1' } as never, ctx)).toBe('ran');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('lets agg.run without $out/$merge through on a read-only profile', async () => {
    const { guarded } = setup({ readOnly: true, production: true });
    const params = { profileId: 'p1', pipeline: JSON.stringify([{ $match: { a: 1 } }]) };
    await expect(guarded['agg.run']?.(params as never, ctx)).resolves.toBe('ran');
    const merge = { profileId: 'p1', pipeline: JSON.stringify([{ $merge: { into: 'x' } }]) };
    expect(await codeOf(guarded['agg.run']?.(merge as never, ctx))).toBe('READ_ONLY');
  });

  it('passes lookup errors through (unknown profile)', async () => {
    const handlers = guardWrites({ 'docs.insert': () => 'ran' }, () => {
      throw new RpcError('NOT_FOUND', 'No profile');
    });
    expect(await codeOf(handlers['docs.insert']?.({ profileId: 'x' } as never, ctx))).toBe(
      'NOT_FOUND',
    );
  });

  it('checkWrite names the method in its messages', () => {
    expect(() =>
      checkWrite('docs.insert', { readOnly: true, production: false }, { profileId: 'p' }),
    ).toThrow(/docs\.insert.*read-only/);
  });
});

describe('pipelineWrites / isWrite', () => {
  it('detects $out and $merge in any stage and fails closed on unreadable text', () => {
    expect(pipelineWrites('[]')).toBe(false);
    expect(pipelineWrites('[{"$match":{"$out":1}}]')).toBe(false);
    expect(pipelineWrites('[{"$out":"x"}]')).toBe(true);
    expect(pipelineWrites('[{"$group":{}},{"$merge":"x"}]')).toBe(true);
    expect(pipelineWrites('not json')).toBe(true);
    expect(pipelineWrites('{"$out":"x"}')).toBe(true);
    expect(pipelineWrites('[1]')).toBe(true);
  });

  it('knows which methods write', () => {
    expect(isWrite('docs.find', {})).toBe(false);
    expect(isWrite('docs.insert', {})).toBe(true);
    expect(isWrite('agg.run', { pipeline: '[]' })).toBe(false);
    expect(isWrite('agg.run', { pipeline: '[{"$out":"x"}]' })).toBe(true);
  });
});
