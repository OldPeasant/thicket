import { TestBed } from '@angular/core/testing';
import { BROADCAST_STREAMS, type DocsBatch, type ResultOf } from '@thicket/contract';
import { firstValueFrom, toArray } from 'rxjs';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { ApiError } from './api-error';
import { ApiService, MAX_EARLY_EVENTS } from './api.service';
import { FakeThicketBridge, provideFakeThicket } from './testing';
import { THICKET_BRIDGE, type ThicketBridge } from './thicket-bridge';

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

  describe('request edge cases', () => {
    it('removes its abort listener once the request settles', async () => {
      fake.respond('conn.close', {});
      const controller = new AbortController();
      const remove = vi.spyOn(controller.signal, 'removeEventListener');

      await api.request('conn.close', PROFILE, { signal: controller.signal });

      expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    });

    it('ignores the late response of an aborted request', async () => {
      let answer: (value: ResultOf<'conn.close'>) => void = () => undefined;
      fake.handle('conn.close', () => new Promise((resolve) => (answer = resolve)));
      const controller = new AbortController();

      const settled = api.request('conn.close', PROFILE, { signal: controller.signal }).then(
        (result) => ({ result }),
        (error: unknown) => ({ error }),
      );
      await flush();
      controller.abort();
      answer({});
      await flush();

      expect(await settled).toEqual({ error: expect.objectContaining({ code: 'CANCELLED' }) });
      expect(fake.cancels).toEqual([fake.requests[0]?.id]);
    });

    it('keeps the original error and does not cancel when aborted after a failure', async () => {
      fake.fail('conn.close', { code: 'NOT_FOUND', message: 'gone' });
      const controller = new AbortController();

      const pending = api.request('conn.close', PROFILE, { signal: controller.signal });
      await expect(pending).rejects.toMatchObject({ code: 'NOT_FOUND' });
      controller.abort();

      expect(fake.cancels).toEqual([]);
    });

    it('resolves overlapping requests independently in reverse order', async () => {
      const answers: ((value: ResultOf<'conn.status'>) => void)[] = [];
      fake.handle('conn.status', () => new Promise((resolve) => answers.push(resolve)));

      const first = api.request('conn.status', { profileId: 'p1' });
      const second = api.request('conn.status', { profileId: 'p2' });
      await flush();
      answers[1]?.({ connections: [{ profileId: 'p2', state: 'connected' }] });
      answers[0]?.({ connections: [{ profileId: 'p1', state: 'disconnected' }] });

      await expect(second).resolves.toEqual({
        connections: [{ profileId: 'p2', state: 'connected' }],
      });
      await expect(first).resolves.toEqual({
        connections: [{ profileId: 'p1', state: 'disconnected' }],
      });
    });

    it('rejects with INTERNAL when the bridge throws synchronously', async () => {
      fake.request = () => {
        throw new Error('bridge gone');
      };
      await expect(api.request('conn.close', PROFILE)).rejects.toMatchObject({
        code: 'INTERNAL',
        message: 'bridge gone',
      });
    });

    it('rejects with INTERNAL when an error response carries a malformed error', async () => {
      fake.request = (request) =>
        Promise.resolve({ id: request.id, ok: false, error: 'boom' } as never);
      const error = await api.request('conn.close', PROFILE).catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ code: 'INTERNAL', detail: 'boom' });
    });

    it.each([
      ['undefined', undefined],
      ['null', null],
    ])('rejects with an INTERNAL ApiError when the bridge resolves %s', async (_what, response) => {
      fake.request = () => Promise.resolve(response as never);
      const error = await api.request('conn.close', PROFILE).catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ code: 'INTERNAL' });
    });

    it.each([
      ['a string', 'oops'],
      ['an object without ok', { id: 'x', result: {} }],
    ])(
      'rejects with a malformed-response INTERNAL error when the bridge resolves %s',
      async (_what, response) => {
        fake.request = () => Promise.resolve(response as never);
        const error = await api.request('conn.close', PROFILE).catch((thrown: unknown) => thrown);
        expect(error).toBeInstanceOf(ApiError);
        expect(error).toMatchObject({
          code: 'INTERNAL',
          message: 'Malformed response from the bridge for conn.close',
          detail: response,
        });
      },
    );

    it('does not resolve when ok is truthy but not true', async () => {
      fake.request = (request) =>
        Promise.resolve({ id: request.id, ok: 'yes', result: { connections: [] } } as never);
      const error = await api.request('conn.status', PROFILE).catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ code: 'INTERNAL' });
    });

    it('falls back to unique generated ids without crypto.randomUUID', async () => {
      vi.stubGlobal('crypto', {});
      try {
        fake.respond('conn.close', {});
        await api.request('conn.close', PROFILE);
        await api.request('conn.close', PROFILE);
      } finally {
        vi.unstubAllGlobals();
      }
      const ids = fake.requests.map((request) => request.id);
      expect(ids).toEqual([expect.stringMatching(/^r-/), expect.stringMatching(/^r-/)]);
      expect(new Set(ids).size).toBe(2);
    });
  });

  describe('stream edge cases', () => {
    const FIND = { profileId: 'p1', db: 'd', coll: 'c', filter: '{}' };

    it('ignores data and error events after end', async () => {
      fake.respond('docs.find', { streamId: 's1' });
      const received: DocsBatch[] = [];
      let errored = false;
      let completed = false;
      api.stream('docs.find', FIND).subscribe({
        next: (b) => received.push(b),
        error: () => (errored = true),
        complete: () => (completed = true),
      });
      await flush();
      fake.end('s1');
      fake.data('docs.find', 's1', batch('{"late":1}'));
      fake.failStream('s1', { code: 'INTERNAL', message: 'late' });

      expect(completed).toBe(true);
      expect(errored).toBe(false);
      expect(received).toEqual([]);
    });

    it('does not cancel when unsubscribed after an error event', async () => {
      fake.respond('docs.find', { streamId: 's1' });
      const subscription = api.stream('docs.find', FIND).subscribe({ error: () => undefined });
      await flush();
      fake.failStream('s1', { code: 'TIMEOUT', message: 't' });
      subscription.unsubscribe();
      expect(fake.cancels).toEqual([]);
    });

    it('completes after the response when end arrived before it', async () => {
      fake.handle('docs.find', () => {
        fake.data('docs.find', 's1', batch('{"a":1}'));
        fake.end('s1', { delivered: 1 });
        fake.data('docs.find', 's1', batch('{"after-end":1}'));
        return { streamId: 's1' };
      });

      const all = await firstValueFrom(api.stream('docs.find', FIND).pipe(toArray()));

      expect(all).toEqual([batch('{"a":1}')]);
      expect(fake.cancels).toEqual([]);
      expect(fake.listenerCount).toBe(0);
    });

    it('errors after the response when an error event arrived before it', async () => {
      fake.handle('docs.find', () => {
        fake.failStream('s1', { code: 'NOT_CONNECTED', message: 'dropped' });
        return { streamId: 's1' };
      });
      await expect(firstValueFrom(api.stream('docs.find', FIND))).rejects.toMatchObject({
        code: 'NOT_CONNECTED',
        message: 'dropped',
      });
      expect(fake.listenerCount).toBe(0);
    });

    it('turns a malformed error event into an INTERNAL ApiError', async () => {
      fake.respond('docs.find', { streamId: 's1' });
      const done = firstValueFrom(api.stream('docs.find', FIND)).catch((e: unknown) => e);
      await flush();
      fake.emit({ stream: 's1', kind: 'error', payload: { reason: 'x' } } as never);
      const error = await done;
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ code: 'INTERNAL' });
    });

    it.each([
      ['null', null],
      ['an empty streamId', { streamId: '' }],
      ['a numeric streamId', { streamId: 7 }],
    ])('errors with INTERNAL and cleans up when the result is %s', async (_what, result) => {
      fake.handle('docs.find', () => result as never);
      await expect(firstValueFrom(api.stream('docs.find', FIND))).rejects.toMatchObject({
        code: 'INTERNAL',
        message: 'docs.find did not return a streamId',
      });
      expect(fake.listenerCount).toBe(0);
      expect(fake.cancels).toEqual([]);
    });

    it('errors with INTERNAL when the bridge rejects', async () => {
      fake.request = () => Promise.reject(new Error('port closed'));
      await expect(firstValueFrom(api.stream('docs.find', FIND))).rejects.toMatchObject({
        code: 'INTERNAL',
        message: 'port closed',
      });
      expect(fake.listenerCount).toBe(0);
    });

    it('errors with a malformed-response INTERNAL error when the bridge resolves undefined', async () => {
      fake.request = () => Promise.resolve(undefined as never);
      await expect(firstValueFrom(api.stream('docs.find', FIND))).rejects.toMatchObject({
        code: 'INTERNAL',
        message: 'Malformed response from the bridge for docs.find',
      });
      expect(fake.listenerCount).toBe(0);
      expect(fake.cancels).toEqual([]);
    });

    it('removes its listener at once when unsubscribed before the response', () => {
      fake.handle('docs.find', () => new Promise(() => undefined));
      const subscription = api.stream('docs.find', FIND).subscribe();
      expect(fake.listenerCount).toBe(1);
      subscription.unsubscribe();
      expect(fake.listenerCount).toBe(0);
    });

    it('does not surface a failed response after unsubscribing', async () => {
      let fail: (reason: unknown) => void = () => undefined;
      fake.handle('docs.find', () => new Promise((_resolve, reject) => (fail = reject)));
      const errors: unknown[] = [];
      const subscription = api
        .stream('docs.find', FIND)
        .subscribe({ error: (e: unknown) => errors.push(e) });
      await flush();
      subscription.unsubscribe();
      fail(new ApiError({ code: 'NOT_CONNECTED', message: 'late' }));
      await flush();

      expect(errors).toEqual([]);
      expect(fake.cancels).toEqual([fake.requests[0]?.id]);
    });

    it('does not cancel a stream when the late response has no streamId', async () => {
      let answer: (value: ResultOf<'docs.find'>) => void = () => undefined;
      fake.handle('docs.find', () => new Promise((resolve) => (answer = resolve)));
      const subscription = api.stream('docs.find', FIND).subscribe({ error: () => undefined });
      await flush();
      subscription.unsubscribe();
      answer({} as never);
      await flush();
      expect(fake.cancels).toEqual([fake.requests[0]?.id]);
    });

    it('cancels the stream when a consumer unsubscribes from inside next (first value)', async () => {
      fake.respond('docs.find', { streamId: 's1' });
      const first = firstValueFrom(api.stream('docs.find', FIND));
      await flush();
      fake.data('docs.find', 's1', batch('{"a":1}'));
      fake.data('docs.find', 's1', batch('{"b":2}'));

      expect(await first).toEqual(batch('{"a":1}'));
      expect(fake.cancels).toEqual(['s1']);
      expect(fake.listenerCount).toBe(0);
    });

    it('stops replaying buffered events when unsubscribed from inside next', async () => {
      fake.handle('docs.find', () => {
        fake.data('docs.find', 's1', batch('{"a":1}'));
        fake.data('docs.find', 's1', batch('{"b":2}'));
        return { streamId: 's1' };
      });
      const first = firstValueFrom(api.stream('docs.find', FIND));

      expect(await first).toEqual(batch('{"a":1}'));
      expect(fake.cancels).toEqual(['s1']);
      expect(fake.listenerCount).toBe(0);
    });

    it('keeps concurrent streams apart', async () => {
      let n = 0;
      fake.handle('docs.find', () => ({ streamId: `s${++n}` }));
      const one = firstValueFrom(api.stream('docs.find', FIND).pipe(toArray()));
      const two = firstValueFrom(api.stream('docs.find', FIND).pipe(toArray()));
      await flush();
      fake.data('docs.find', 's2', batch('{"two":1}'));
      fake.data('docs.find', 's1', batch('{"one":1}'));
      fake.end('s2');
      fake.data('docs.find', 's1', batch('{"one":2}'));
      fake.end('s1');

      expect(await one).toEqual([batch('{"one":1}'), batch('{"one":2}')]);
      expect(await two).toEqual([batch('{"two":1}')]);
    });

    it('ignores events addressed to the request id instead of the streamId', async () => {
      fake.respond('docs.find', { streamId: 's1' });
      const all = firstValueFrom(api.stream('docs.find', FIND).pipe(toArray()));
      await flush();
      const requestId = fake.requests[0]?.id ?? '';
      fake.data('docs.find', requestId, batch('{"wrong":1}'));
      fake.end(requestId);
      fake.end('s1');
      expect(await all).toEqual([]);
    });
  });

  describe('stream start result', () => {
    const EXPORT = {
      profileId: 'p1',
      db: 'd',
      coll: 'c',
      source: { kind: 'find', filter: '{}' },
      format: 'jsonl',
    } as const;
    const progress = { processed: 1, failed: 0, errors: [] };

    it('completes without emitting when io.export answers streamId null (dialog cancelled)', async () => {
      fake.respond('io.export', { streamId: null, path: null });
      const starts: ResultOf<'io.export'>[] = [];
      const all = firstValueFrom(
        api
          .stream('io.export', EXPORT, { onStart: (result) => starts.push(result) })
          .pipe(toArray()),
      );

      expect(await all).toEqual([]);
      expect(starts).toEqual([{ streamId: null, path: null }]);
      expect(fake.cancels).toEqual([]);
      expect(fake.listenerCount).toBe(0);
    });

    it('calls onStart once with the result before the first data, also for buffered data', async () => {
      const log: unknown[] = [];
      fake.handle('io.export', () => {
        fake.data('io.export', 'e1', progress);
        return { streamId: 'e1', path: '/tmp/out.jsonl' };
      });
      const done = firstValueFrom(
        api
          .stream('io.export', EXPORT, {
            onStart: (result) => {
              expectTypeOf(result).toEqualTypeOf<ResultOf<'io.export'>>();
              log.push(['start', result.path]);
            },
          })
          .pipe(toArray()),
      );
      await flush();
      log.push('after response');
      fake.data('io.export', 'e1', progress);
      fake.end('e1');

      const data = await done;
      expect(data).toEqual([progress, progress]);
      expect(log).toEqual([['start', '/tmp/out.jsonl'], 'after response']);
    });

    it('does not call onStart when the request fails or was unsubscribed', async () => {
      const onStart = vi.fn();
      fake.fail('io.export', { code: 'NOT_CONNECTED', message: 'not connected' });
      await expect(
        firstValueFrom(api.stream('io.export', EXPORT, { onStart })),
      ).rejects.toMatchObject({ code: 'NOT_CONNECTED' });

      fake.respond('io.export', { streamId: 'e2', path: '/x' });
      api.stream('io.export', EXPORT, { onStart }).subscribe().unsubscribe();
      await flush();

      expect(onStart).not.toHaveBeenCalled();
      expect(fake.cancels).toEqual([fake.requests[1]?.id, 'e2']);
    });

    it('errors and cancels the stream when onStart throws', async () => {
      fake.respond('io.export', { streamId: 'e1', path: '/x' });
      const boom = new Error('boom');
      const error = await firstValueFrom(
        api.stream('io.export', EXPORT, {
          onStart: () => {
            throw boom;
          },
        }),
      ).catch((thrown: unknown) => thrown);

      expect(error).toBe(boom);
      expect(fake.cancels).toEqual(['e1']);
      expect(fake.listenerCount).toBe(0);
    });

    it('cancels the stream, not the request, when unsubscribed from inside onStart', async () => {
      fake.respond('io.export', { streamId: 'e1', path: '/x' });
      const stream = api.stream('io.export', EXPORT, {
        onStart: () => subscription.unsubscribe(),
      });
      const subscription = stream.subscribe();
      await flush();

      expect(fake.cancels).toEqual(['e1']);
      expect(fake.listenerCount).toBe(0);
    });
  });

  describe('stream start result edge cases', () => {
    const EXPORT = {
      profileId: 'p1',
      db: 'd',
      coll: 'c',
      source: { kind: 'find', filter: '{}' },
      format: 'jsonl',
    } as const;
    const progress = { processed: 1, failed: 0, errors: [] };

    it('completes on streamId null without options', async () => {
      fake.respond('io.export', { streamId: null, path: null });
      expect(await firstValueFrom(api.stream('io.export', EXPORT).pipe(toArray()))).toEqual([]);
      expect(fake.cancels).toEqual([]);
      expect(fake.listenerCount).toBe(0);
    });

    it('drops events buffered before a streamId null response', async () => {
      fake.handle('io.export', () => {
        fake.data('io.export', 'e1', progress);
        fake.end('e1');
        return { streamId: null, path: null };
      });
      expect(await firstValueFrom(api.stream('io.export', EXPORT).pipe(toArray()))).toEqual([]);
      expect(fake.cancels).toEqual([]);
    });

    it('sends only the request cancel when a streamId null response arrives after unsubscribe', async () => {
      let answer: (value: ResultOf<'io.export'>) => void = () => undefined;
      fake.handle('io.export', () => new Promise((resolve) => (answer = resolve)));
      const onStart = vi.fn();
      const subscription = api.stream('io.export', EXPORT, { onStart }).subscribe();
      await flush();
      subscription.unsubscribe();
      answer({ streamId: null, path: null });
      await flush();

      expect(onStart).not.toHaveBeenCalled();
      expect(fake.cancels).toEqual([fake.requests[0]?.id]);
    });

    it('errors without a cancel when onStart throws for a streamId null result', async () => {
      fake.respond('io.export', { streamId: null, path: null });
      const boom = new Error('boom');
      const error = await firstValueFrom(
        api.stream('io.export', EXPORT, {
          onStart: () => {
            throw boom;
          },
        }),
      ).catch((thrown: unknown) => thrown);

      expect(error).toBe(boom);
      expect(fake.cancels).toEqual([]);
      expect(fake.listenerCount).toBe(0);
    });

    it('does not surface an onStart error after onStart unsubscribed', async () => {
      fake.respond('io.export', { streamId: 'e1', path: '/x' });
      const errors: unknown[] = [];
      const stream = api.stream('io.export', EXPORT, {
        onStart: () => {
          subscription.unsubscribe();
          throw new Error('after unsubscribe');
        },
      });
      const subscription = stream.subscribe({ error: (e: unknown) => errors.push(e) });
      await flush();

      expect(errors).toEqual([]);
      expect(fake.cancels).toEqual(['e1']);
      expect(fake.listenerCount).toBe(0);
    });

    it('sends no cancel and does not complete when onStart unsubscribes for a streamId null result', async () => {
      fake.respond('io.export', { streamId: null, path: null });
      let completed = false;
      const stream = api.stream('io.export', EXPORT, {
        onStart: () => subscription.unsubscribe(),
      });
      const subscription = stream.subscribe({ complete: () => (completed = true) });
      await flush();

      expect(completed).toBe(false);
      expect(fake.cancels).toEqual([]);
      expect(fake.listenerCount).toBe(0);
    });

    it('does not call onStart when the result has no streamId field', async () => {
      fake.handle('io.export', () => ({ path: '/x' }) as never);
      const onStart = vi.fn();
      await expect(
        firstValueFrom(api.stream('io.export', EXPORT, { onStart })),
      ).rejects.toMatchObject({ code: 'INTERNAL', message: 'io.export did not return a streamId' });
      expect(onStart).not.toHaveBeenCalled();
    });
  });

  describe('early event buffer', () => {
    const FIND = { profileId: 'p1', db: 'd', coll: 'c', filter: '{}' };

    it('does not buffer broadcast events while the request is pending', async () => {
      let answer: (value: { streamId: string }) => void = () => undefined;
      fake.handle('docs.find', () => new Promise((resolve) => (answer = resolve)));
      const errors: unknown[] = [];
      const received: DocsBatch[] = [];
      api.stream('docs.find', FIND).subscribe({
        next: (b) => received.push(b),
        error: (e: unknown) => errors.push(e),
      });
      await flush();
      for (let i = 0; i <= MAX_EARLY_EVENTS; i++) {
        fake.emit({
          stream: BROADCAST_STREAMS.connStatus,
          kind: 'data',
          payload: { profileId: 'p1', state: 'connected' },
        });
      }
      fake.emit({ stream: BROADCAST_STREAMS.theme, kind: 'end', payload: { delivered: 0 } });
      answer({ streamId: 's1' });
      await flush();
      fake.data('docs.find', 's1', batch('{"a":1}'));

      expect(errors).toEqual([]);
      expect(received).toEqual([batch('{"a":1}')]);
      expect(fake.cancels).toEqual([]);
    });

    it('fails with INTERNAL and cancels when too many events arrive before the response', async () => {
      let answer: (value: { streamId: string }) => void = () => undefined;
      fake.handle('docs.find', () => new Promise((resolve) => (answer = resolve)));
      const errors: unknown[] = [];
      api.stream('docs.find', FIND).subscribe({ error: (e: unknown) => errors.push(e) });
      await flush();
      for (let i = 0; i < MAX_EARLY_EVENTS; i++) {
        fake.data('docs.find', 'other', batch('{}'));
      }
      expect(errors).toEqual([]);

      fake.data('docs.find', 'other', batch('{}'));
      expect(errors).toHaveLength(1);
      expect(errors[0]).toBeInstanceOf(ApiError);
      expect(errors[0]).toMatchObject({ code: 'INTERNAL' });
      expect(fake.cancels).toEqual([fake.requests[0]?.id]);
      expect(fake.listenerCount).toBe(0);

      answer({ streamId: 's1' });
      await flush();
      expect(fake.cancels).toEqual([fake.requests[0]?.id, 's1']);
      expect(errors).toHaveLength(1);
    });
  });

  describe('early event buffer edge cases', () => {
    const FIND = { profileId: 'p1', db: 'd', coll: 'c', filter: '{}' };

    it('delivers MAX_EARLY_EVENTS buffered events of its own stream in order', async () => {
      let answer: (value: { streamId: string }) => void = () => undefined;
      fake.handle('docs.find', () => new Promise((resolve) => (answer = resolve)));
      const all = firstValueFrom(api.stream('docs.find', FIND).pipe(toArray()));
      await flush();
      // MAX_EARLY_EVENTS - 1 data events plus the end event fill the buffer exactly.
      for (let i = 0; i < MAX_EARLY_EVENTS - 1; i++) {
        fake.data('docs.find', 's1', batch(String(i)));
      }
      fake.end('s1', { delivered: MAX_EARLY_EVENTS - 1 });
      answer({ streamId: 's1' });

      const received = await all;
      expect(received).toHaveLength(MAX_EARLY_EVENTS - 1);
      expect(received[0]).toEqual(batch('0'));
      expect(received.at(-1)).toEqual(batch(String(MAX_EARLY_EVENTS - 2)));
      expect(fake.cancels).toEqual([]);
      expect(fake.listenerCount).toBe(0);
    });

    it('ignores a failed late response and a later unsubscribe after an overflow', async () => {
      let fail: (reason: unknown) => void = () => undefined;
      fake.handle('docs.find', () => new Promise((_resolve, reject) => (fail = reject)));
      const errors: unknown[] = [];
      const subscription = api
        .stream('docs.find', FIND)
        .subscribe({ error: (e: unknown) => errors.push(e) });
      await flush();
      for (let i = 0; i <= MAX_EARLY_EVENTS; i++) fake.data('docs.find', 'other', batch('{}'));
      expect(errors).toHaveLength(1);

      fail(new ApiError({ code: 'NOT_CONNECTED', message: 'late' }));
      await flush();
      subscription.unsubscribe();

      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ code: 'INTERNAL' });
      expect(fake.cancels).toEqual([fake.requests[0]?.id]);
    });

    it('does not count events against the limit once the stream is running', async () => {
      fake.respond('docs.find', { streamId: 's1' });
      const errors: unknown[] = [];
      let received = 0;
      api.stream('docs.find', FIND).subscribe({
        next: () => received++,
        error: (e: unknown) => errors.push(e),
      });
      await flush();
      for (let i = 0; i <= MAX_EARLY_EVENTS; i++) fake.data('docs.find', 'other', batch('{}'));
      fake.data('docs.find', 's1', batch('{}'));

      expect(errors).toEqual([]);
      expect(received).toBe(1);
      expect(fake.cancels).toEqual([]);
    });
  });

  describe('broadcast edge cases', () => {
    it('ignores non-data events of a broadcast stream', () => {
      const dark = { style: 'business', mode: 'system', effective: 'dark' } as const;
      const seen: unknown[] = [];
      const subscription = api.broadcasts(BROADCAST_STREAMS.theme).subscribe((t) => seen.push(t));
      fake.emit({ stream: BROADCAST_STREAMS.theme, kind: 'end', payload: { delivered: 0 } });
      fake.emit({ stream: BROADCAST_STREAMS.theme, kind: 'data', payload: dark });
      subscription.unsubscribe();
      expect(seen).toEqual([dark]);
    });

    it('keeps one bridge listener per subscriber and removes each', () => {
      const a = api.events('x').subscribe();
      const b = api.events('x').subscribe();
      expect(fake.listenerCount).toBe(2);
      a.unsubscribe();
      expect(fake.listenerCount).toBe(1);
      b.unsubscribe();
      expect(fake.listenerCount).toBe(0);
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

describe('THICKET_BRIDGE default', () => {
  afterEach(() => {
    delete window.thicket;
  });

  it('uses window.thicket when the preload exposed it', async () => {
    const fake = new FakeThicketBridge().respond('conn.close', {});
    window.thicket = fake;
    TestBed.configureTestingModule({});

    expect(TestBed.inject(THICKET_BRIDGE)).toBe(fake);
    await expect(TestBed.inject(ApiService).request('conn.close', PROFILE)).resolves.toEqual({});
    expect(fake.requestsFor('conn.close')).toHaveLength(1);
  });

  it('streams, cancels and listens without crashing when window.thicket is missing', async () => {
    TestBed.configureTestingModule({});
    const api = TestBed.inject(ApiService);
    const bridge: ThicketBridge = TestBed.inject(THICKET_BRIDGE);
    const find = { profileId: 'p1', db: 'd', coll: 'c', filter: '{}' };

    await expect(firstValueFrom(api.stream('docs.find', find))).rejects.toMatchObject({
      code: 'INTERNAL',
    });
    expect(() => bridge.cancel('x')).not.toThrow();
    const subscription = api.events('x').subscribe();
    expect(() => subscription.unsubscribe()).not.toThrow();
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
