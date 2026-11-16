import { describe, expect, it } from 'vitest';

import { ApiError } from '../api-error';
import { FakeThicketBridge } from './fake-thicket-bridge';
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
