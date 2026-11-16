import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../api-error';
import { THICKET_BRIDGE } from '../thicket-bridge';
import { FakeThicketBridge, provideFakeThicket } from './fake-thicket-bridge';
import * as testing from './index';

describe('FakeThicketBridge', () => {
  it('is exported from api/testing for other renderer specs', () => {
    expect(testing.FakeThicketBridge).toBe(FakeThicketBridge);
    expect(testing.provideFakeThicket).toEqual(expect.any(Function));
  });

  it('answers UNKNOWN_METHOD for methods without a handler', async () => {
    const fake = new FakeThicketBridge();
    const response = await fake.request({ id: '1', method: 'conn.close', params: {} });
    expect(response).toMatchObject({ id: '1', ok: false, error: { code: 'UNKNOWN_METHOD' } });
  });

  it('turns a thrown ApiError into an error response', async () => {
    const fake = new FakeThicketBridge().handle('conn.close', () => {
      throw new ApiError({ code: 'NOT_CONNECTED', message: 'no', detail: 'd' });
    });
    const response = await fake.request({ id: '2', method: 'conn.close', params: {} });
    expect(response).toEqual({
      id: '2',
      ok: false,
      error: { code: 'NOT_CONNECTED', message: 'no', detail: 'd' },
    });
  });

  it('passes the request to the handler and records it', async () => {
    const fake = new FakeThicketBridge().handle('conn.close', (params, request) => {
      expect(params).toEqual({ profileId: 'p' });
      expect(request.id).toBe('3');
      return {};
    });
    await expect(
      fake.request({ id: '3', method: 'conn.close', params: { profileId: 'p' } }),
    ).resolves.toEqual({ id: '3', ok: true, result: {} });
    expect(fake.requestsFor('conn.close')).toHaveLength(1);
  });

  it('answers respond() with the result and fail() with the error', async () => {
    const fake = new FakeThicketBridge()
      .respond('conn.close', {})
      .fail('conn.open', { code: 'AUTH_FAILED', message: 'bad auth', detail: { mech: 'x' } });
    await expect(fake.request({ id: 'a', method: 'conn.close', params: {} })).resolves.toEqual({
      id: 'a',
      ok: true,
      result: {},
    });
    await expect(fake.request({ id: 'b', method: 'conn.open', params: {} })).resolves.toEqual({
      id: 'b',
      ok: false,
      error: { code: 'AUTH_FAILED', message: 'bad auth', detail: { mech: 'x' } },
    });
  });

  it('replaces an earlier handler for the same method', async () => {
    const fake = new FakeThicketBridge()
      .fail('conn.close', { code: 'INTERNAL', message: 'old' })
      .respond('conn.close', {});
    await expect(fake.request({ id: 'c', method: 'conn.close', params: {} })).resolves.toEqual({
      id: 'c',
      ok: true,
      result: {},
    });
  });

  it('awaits async handlers, including rejected ones', async () => {
    const fake = new FakeThicketBridge()
      .handle('conn.close', async () => Promise.resolve({}))
      .handle('conn.open', async () => Promise.reject(new Error('socket hang up')));
    await expect(fake.request({ id: 'd', method: 'conn.close', params: {} })).resolves.toEqual({
      id: 'd',
      ok: true,
      result: {},
    });
    await expect(fake.request({ id: 'e', method: 'conn.open', params: {} })).resolves.toMatchObject(
      {
        id: 'e',
        ok: false,
        error: { code: 'INTERNAL', message: 'socket hang up' },
      },
    );
  });

  it('records cancels in order and does not throw for unknown ids', () => {
    const fake = new FakeThicketBridge();
    fake.cancel('r1');
    fake.cancel('unknown');
    expect(fake.cancels).toEqual(['r1', 'unknown']);
  });

  it('pushes typed data, end with a default payload and error events', () => {
    const fake = new FakeThicketBridge();
    const seen: unknown[] = [];
    fake.on((event) => seen.push(event));
    fake.data('docs.find', 's1', { docs: ['{}'] });
    fake.end('s1');
    fake.failStream('s2', { code: 'TIMEOUT', message: 't' });
    expect(seen).toEqual([
      { stream: 's1', kind: 'data', payload: { docs: ['{}'] } },
      { stream: 's1', kind: 'end', payload: { delivered: 0 } },
      { stream: 's2', kind: 'error', payload: { code: 'TIMEOUT', message: 't' } },
    ]);
  });

  it('lets a listener unsubscribe another during emit without skipping it this round', () => {
    const fake = new FakeThicketBridge();
    const seen: string[] = [];
    let offB: () => void = () => undefined;
    fake.on(() => {
      seen.push('a');
      offB();
    });
    offB = fake.on(() => seen.push('b'));
    fake.end('s1');
    fake.end('s2');
    expect(seen).toEqual(['a', 'b', 'a']);
    expect(fake.listenerCount).toBe(1);
  });

  it('provideFakeThicket() provides a fresh fake as THICKET_BRIDGE', () => {
    TestBed.configureTestingModule({ providers: provideFakeThicket() });
    expect(TestBed.inject(THICKET_BRIDGE)).toBeInstanceOf(FakeThicketBridge);

    const fake = new FakeThicketBridge();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: provideFakeThicket(fake) });
    expect(TestBed.inject(THICKET_BRIDGE)).toBe(fake);
  });

  it('delivers events to each listener until it unsubscribes', () => {
    const fake = new FakeThicketBridge();
    const seen: string[] = [];
    const listener = (event: { stream: string }): void => {
      seen.push(event.stream);
    };
    const offA = fake.on(listener);
    const offB = fake.on(listener);
    fake.end('s1');
    offA();
    fake.end('s2');
    offB();
    fake.end('s3');
    expect(seen).toEqual(['s1', 's1', 's2']);
    expect(fake.listenerCount).toBe(0);
  });
});
