import { TestBed } from '@angular/core/testing';
import { BROADCAST_STREAMS, type DocsBatch, type ResultOf } from '@thicket/contract';
import { firstValueFrom, toArray } from 'rxjs';
import { beforeEach, describe, expect, expectTypeOf, it } from 'vitest';

import { ApiError } from './api-error';
import { ApiService } from './api.service';
import { FakeThicketBridge, provideFakeThicket } from './testing';
import { THICKET_BRIDGE } from './thicket-bridge';

const PROFILE = { profileId: 'p1' };

/** Lets pending promise callbacks run. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const batch = (...docs: string[]): DocsBatch => ({ docs });

describe('ApiService', () => {
  let fake: FakeThicketBridge;
  let api: ApiService;

  beforeEach(() => {
    fake = new FakeThicketBridge();
    TestBed.configureTestingModule({ providers: provideFakeThicket(fake) });
    api = TestBed.inject(ApiService);
  });

  describe('request', () => {
    it('sends method and params and resolves with the typed result', async () => {
      const status: ResultOf<'conn.status'> = {
        connections: [{ profileId: 'p1', state: 'connected' }],
      };
      fake.handle('conn.status', (params) => {
        expect(params).toEqual(PROFILE);
        return status;
      });

      const result = await api.request('conn.status', PROFILE);

      expectTypeOf(result).toEqualTypeOf<ResultOf<'conn.status'>>();
      expect(result).toEqual(status);
      const [sent] = fake.requests;
      expect(sent).toMatchObject({ method: 'conn.status', params: PROFILE });
      expect(sent?.id).toEqual(expect.any(String));
    });

    it('uses a new id for every request', async () => {
      fake.respond('conn.close', {});
      await Promise.all([api.request('conn.close', PROFILE), api.request('conn.close', PROFILE)]);
      const ids = fake.requests.map((request) => request.id);
      expect(new Set(ids).size).toBe(2);
    });

    it('rejects with an ApiError carrying code, message and detail', async () => {
      fake.fail('conn.open', {
        code: 'CONFLICT',
        message: 'changed on server',
        detail: { current: null },
      });

      const error = await api.request('conn.open', PROFILE).catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        code: 'CONFLICT',
        message: 'changed on server',
        detail: { current: null },
      });
    });

    it('rejects with INTERNAL when the bridge itself fails', async () => {
      const broken = TestBed.inject(THICKET_BRIDGE) as FakeThicketBridge;
      broken.request = () => Promise.reject(new Error('port closed'));

      await expect(api.request('conn.close', PROFILE)).rejects.toMatchObject({
        code: 'INTERNAL',
        message: 'port closed',
      });
    });

    it('cancels the request when the signal aborts and rejects with CANCELLED', async () => {
      fake.handle('conn.close', () => new Promise(() => undefined));
      const controller = new AbortController();

      const pending = api.request('conn.close', PROFILE, { signal: controller.signal });
      controller.abort();

      await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
      expect(fake.cancels).toEqual([fake.requests[0]?.id]);
    });

    it('does not send a request for an already aborted signal', async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(
        api.request('conn.close', PROFILE, { signal: controller.signal }),
      ).rejects.toMatchObject({ code: 'CANCELLED' });
      expect(fake.requests).toEqual([]);
    });

    it('does not cancel after the request finished', async () => {
      fake.respond('conn.close', {});
      const controller = new AbortController();
      await api.request('conn.close', PROFILE, { signal: controller.signal });
      controller.abort();
      expect(fake.cancels).toEqual([]);
    });
  });

  describe('stream', () => {
    const FIND = { profileId: 'p1', db: 'd', coll: 'c', filter: '{}' };

    it('emits data payloads and completes on end', async () => {
      fake.respond('docs.find', { streamId: 's1' });
      const stream = api.stream('docs.find', FIND);
      expectTypeOf(stream).toEqualTypeOf<import('rxjs').Observable<DocsBatch>>();

      const all = firstValueFrom(stream.pipe(toArray()));
      await flush();
      fake.data('docs.find', 's1', batch('{"a":1}'));
      fake.data('docs.find', 's2', batch('{"other":1}'));
      fake.data('docs.find', 's1', batch('{"a":2}'));
      fake.end('s1', { delivered: 2 });

      expect(await all).toEqual([batch('{"a":1}'), batch('{"a":2}')]);
      expect(fake.cancels).toEqual([]);
      expect(fake.listenerCount).toBe(0);
    });

    it('delivers events that arrive before the response', async () => {
      fake.handle('docs.find', () => {
        fake.data('docs.find', 's1', batch('{"early":1}'));
        fake.data('docs.find', 'other', batch('{"x":1}'));
        return { streamId: 's1' };
      });

      const all = firstValueFrom(api.stream('docs.find', FIND).pipe(toArray()));
      await flush();
      fake.end('s1');

      expect(await all).toEqual([batch('{"early":1}')]);
    });

    it('errors with an ApiError on an error event', async () => {
      fake.respond('docs.find', { streamId: 's1' });
      const done = firstValueFrom(api.stream('docs.find', FIND)).catch((e: unknown) => e);
      await flush();
      fake.failStream('s1', { code: 'TIMEOUT', message: 'maxTimeMS expired' });

      const error = await done;
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ code: 'TIMEOUT', message: 'maxTimeMS expired' });
      expect(fake.listenerCount).toBe(0);
    });

    it('errors when the request fails', async () => {
      fake.fail('docs.find', { code: 'NOT_CONNECTED', message: 'not connected' });
      await expect(firstValueFrom(api.stream('docs.find', FIND))).rejects.toMatchObject({
        code: 'NOT_CONNECTED',
      });
      expect(fake.listenerCount).toBe(0);
    });

    it('errors with INTERNAL when the result has no streamId', async () => {
      fake.handle('docs.find', () => ({}) as never);
      await expect(firstValueFrom(api.stream('docs.find', FIND))).rejects.toMatchObject({
        code: 'INTERNAL',
      });
    });

    it('sends cancel with the streamId when unsubscribed while running', async () => {
      fake.respond('docs.find', { streamId: 's1' });
      const received: DocsBatch[] = [];
      const subscription = api.stream('docs.find', FIND).subscribe((b) => received.push(b));
      await flush();
      fake.data('docs.find', 's1', batch('{"a":1}'));

      subscription.unsubscribe();
      fake.data('docs.find', 's1', batch('{"late":1}'));

      expect(fake.cancels).toEqual(['s1']);
      expect(received).toEqual([batch('{"a":1}')]);
      expect(fake.listenerCount).toBe(0);
    });

    it('cancels the request id when unsubscribed before the response, and the late stream', async () => {
      let answer: (value: { streamId: string }) => void = () => undefined;
      fake.handle('docs.find', () => new Promise((resolve) => (answer = resolve)));

      const subscription = api.stream('docs.find', FIND).subscribe();
      await flush();
      subscription.unsubscribe();
      expect(fake.cancels).toEqual([fake.requests[0]?.id]);

      answer({ streamId: 's9' });
      await flush();
      expect(fake.cancels).toEqual([fake.requests[0]?.id, 's9']);
    });

    it('does not cancel after the stream ended', async () => {
      fake.respond('docs.find', { streamId: 's1' });
      const subscription = api.stream('docs.find', FIND).subscribe();
      await flush();
      fake.end('s1');
      subscription.unsubscribe();
      expect(fake.cancels).toEqual([]);
    });

    it('sends one request per subscription', async () => {
      let n = 0;
      fake.handle('docs.find', () => ({ streamId: `s${++n}` }));
      const stream = api.stream('docs.find', FIND);
      stream.subscribe().unsubscribe();
      stream.subscribe().unsubscribe();
      await flush();
      expect(fake.requestsFor('docs.find')).toHaveLength(2);
    });
  });

  describe('broadcasts and events', () => {
    it('emits typed payloads of a broadcast stream', () => {
      const seen: unknown[] = [];
      const subscription = api
        .broadcasts(BROADCAST_STREAMS.connStatus)
        .subscribe((status) => seen.push(status.state));

      fake.emit({
        stream: BROADCAST_STREAMS.connStatus,
        kind: 'data',
        payload: { profileId: 'p1', state: 'connected' },
      });
      fake.emit({ stream: 'other', kind: 'data', payload: {} });
      subscription.unsubscribe();
      fake.emit({
        stream: BROADCAST_STREAMS.connStatus,
        kind: 'data',
        payload: { profileId: 'p1', state: 'disconnected' },
      });

      expect(seen).toEqual(['connected']);
      expect(fake.listenerCount).toBe(0);
    });

    it('emits every event of a named stream', () => {
      const seen: string[] = [];
      const subscription = api.events('backend.restarted').subscribe((e) => seen.push(e.kind));
      fake.emit({ stream: 'backend.restarted', kind: 'data', payload: null });
      subscription.unsubscribe();
      expect(seen).toEqual(['data']);
    });
  });
});

describe('ApiService without window.thicket', () => {
  it('answers with a readable INTERNAL error instead of crashing', async () => {
    TestBed.configureTestingModule({});
    const api = TestBed.inject(ApiService);
    await expect(api.request('conn.status', {})).rejects.toMatchObject({
      code: 'INTERNAL',
      message: expect.stringContaining('window.thicket'),
    });
  });
});
