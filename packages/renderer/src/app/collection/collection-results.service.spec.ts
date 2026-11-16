import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ErrorInfo, Request } from '@thicket/contract';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import { CollectionResults } from './collection-results.service';
import { EMPTY_QUERY, type ParsedQuery, parseQuery, type QueryText } from './query.util';

/** `n` documents `{_id: Int32(i), name: "doc i"}` as canonical EJSON, starting at `from`. */
function docs(from: number, n: number): string[] {
  return Array.from(
    { length: n },
    (_, i) => `{"_id":{"$numberInt":"${from + i}"},"name":"doc ${from + i}"}`,
  );
}

function query(text: Partial<QueryText>): ParsedQuery {
  const parsed = parseQuery({ ...EMPTY_QUERY, ...text });
  if (!parsed.ok) throw new Error(`invalid test query: ${JSON.stringify(parsed.errors)}`);
  return parsed.query;
}

/** A promise the test settles explicitly, to control the order answers arrive in. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const TARGET = { profileId: 'p1', db: 'shop', coll: 'orders' };

/**
 * CollectionResults on its own, with every `docs.find` stream and every count answered by the
 * test, so the order of late answers is under the test's control (no timers).
 */
describe('CollectionResults', () => {
  let fake: FakeThicketBridge;
  let results: CollectionResults;
  let estimates: ReturnType<typeof deferred<{ count: number }>>[];
  let counts: ReturnType<typeof deferred<{ count: number }>>[];

  const finds = (): Record<string, unknown>[] =>
    fake.requestsFor('docs.find').map((r: Request) => r.params as Record<string, unknown>);
  const lastFind = () => finds().at(-1) ?? {};
  /** Stream id of the n-th `docs.find` (1-based), as the fake handler names them. */
  const sid = (n: number) => `s${n}`;
  const flush = async () => {
    for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  };
  /** Answers stream `n` completely with `rows` and lets it settle. */
  const answer = async (n: number, rows: string[]) => {
    fake.data('docs.find', sid(n), { docs: rows });
    fake.end(sid(n), { delivered: rows.length });
    await flush();
  };

  beforeEach(async () => {
    fake = new FakeThicketBridge();
    let streams = 0;
    fake.handle('docs.find', () => ({ streamId: sid(++streams) }));
    estimates = [];
    counts = [];
    fake.handle('docs.estimatedCount', () => {
      const d = deferred<{ count: number }>();
      estimates.push(d);
      return d.promise;
    });
    fake.handle('docs.count', () => {
      const d = deferred<{ count: number }>();
      counts.push(d);
      return d.promise;
    });
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideFakeThicket(fake), CollectionResults],
    });
    results = TestBed.inject(CollectionResults);
    results.setTarget(TARGET);
    await flush();
  });

  /** Runs `q` and answers page 1 with `rows` (a full page of 50 by default). */
  const runAndLoad = async (q: ParsedQuery, rows = docs(1, 50)) => {
    results.run(q);
    await flush();
    await answer(finds().length, rows);
  };

  it('sends nothing before a target is set', async () => {
    const fresh = TestBed.runInInjectionContext(() => new CollectionResults());
    fresh.run(query({}));
    fresh.countExact();
    await flush();
    expect(finds()).toHaveLength(0);
    expect(fake.requestsFor('docs.estimatedCount')).toHaveLength(0);
    expect(fake.requestsFor('docs.count')).toHaveLength(0);
  });

  describe('late answers', () => {
    it('drops a slow page read superseded by a newer one, and cancels its stream', async () => {
      await runAndLoad(query({}));
      results.jump(5);
      await flush();
      results.jump(7);
      await flush();
      expect(fake.cancels).toContain(sid(2));
      // The newer read answers first, the superseded one last.
      await answer(3, docs(301, 50));
      await answer(2, docs(201, 50));
      expect(results.page()?.docs[0]).toBe(docs(301, 1)[0]);
      expect(results.page()?.firstRow).toBe(300);
      expect(results.paging().pageIndex).toBe(6);
      expect(results.loading()).toBe(false);
    });

    it('ignores the failure of a superseded page read', async () => {
      await runAndLoad(query({}));
      results.jump(5);
      await flush();
      results.jump(7);
      await flush();
      await answer(3, docs(301, 50));
      fake.failStream(sid(2), { code: 'SERVER_ERROR', message: 'late failure' });
      await flush();
      expect(results.error()).toBeNull();
      expect(results.page()?.firstRow).toBe(300);
    });

    it('keeps loading until the newest read arrives, even when an older one completes', async () => {
      await runAndLoad(query({}));
      results.jump(5);
      await flush();
      results.jump(7);
      await flush();
      await answer(2, docs(201, 50));
      expect(results.loading()).toBe(true);
      expect(results.page()?.firstRow).toBe(0); // page 1 still shown
    });

    it('drops an exact count of an older query that arrives after a new run', async () => {
      await runAndLoad(query({ filter: '{ a: 1 }' }));
      results.countExact();
      await flush();
      expect(results.counting()).toBe(true);
      await runAndLoad(query({ filter: '{ b: 2 }' }));
      counts[0]?.resolve({ count: 1234 });
      await flush();
      expect(results.count()).toBeNull();
      expect(results.counting()).toBe(false);
      expect(results.pageCount()).toBeNull();
    });

    it('drops an older estimate answering after the newer one', async () => {
      results.run(query({}));
      await flush();
      results.run(query({ projection: '{ name: 1 }' })); // empty filter again: a new estimate
      await flush();
      expect(estimates).toHaveLength(2);
      estimates[1]?.resolve({ count: 200 });
      await flush();
      estimates[0]?.resolve({ count: 99_999 });
      await flush();
      expect(results.count()).toEqual({ value: 200, exact: false });
    });

    it('drops an older estimate failing after a new run started its own count', async () => {
      results.run(query({}));
      await flush();
      results.run(query({}));
      await flush();
      estimates[0]?.reject(new Error('late'));
      await flush();
      expect(results.counting()).toBe(true); // the new estimate is still running
      estimates[1]?.resolve({ count: 10 });
      await flush();
      expect(results.counting()).toBe(false);
      expect(results.count()).toEqual({ value: 10, exact: false });
    });

    it('a second exact count supersedes the first one', async () => {
      await runAndLoad(query({ filter: '{ a: 1 }' }));
      results.countExact();
      await flush();
      const firstId = fake.requestsFor('docs.count')[0]?.id;
      results.countExact();
      await flush();
      expect(fake.cancels).toContain(firstId);
      counts[1]?.resolve({ count: 70 });
      await flush();
      counts[0]?.resolve({ count: 5 });
      await flush();
      expect(results.count()).toEqual({ value: 70, exact: true });
      expect(results.error()).toBeNull();
    });

    it('an exact count requested while the estimate runs wins over the estimate', async () => {
      results.run(query({}));
      await flush();
      results.countExact();
      await flush();
      counts[0]?.resolve({ count: 9_990 });
      await flush();
      estimates[0]?.resolve({ count: 10_000 });
      await flush();
      expect(results.count()).toEqual({ value: 9_990, exact: true });
    });
  });

  describe('limit', () => {
    it('a limit smaller than the page size reads only that many rows; one page', async () => {
      results.run(query({ limit: '10' }));
      await flush();
      expect(lastFind()).toMatchObject({ limit: 10 });
      estimates[0]?.resolve({ count: 10_000 });
      await answer(1, docs(1, 10));
      expect(results.count()).toEqual({ value: 10, exact: false });
      expect(results.pageCount()).toBe(1);
      expect(results.canNext()).toBe(false);
      expect(results.paging().page?.isLast).toBe(true);
    });

    it('a limit exactly at a page boundary ends the result on that page', async () => {
      results.run(query({ limit: '100' }));
      await flush();
      await answer(1, docs(1, 50));
      expect(results.canNext()).toBe(true);
      results.next();
      await flush();
      expect(lastFind()).toMatchObject({ limit: 50, after: '{"_id":{"$numberInt":"50"}}' });
      await answer(2, docs(51, 50));
      expect(results.canNext()).toBe(false);
      expect(results.page()?.firstRow).toBe(50);

      // A page beyond the limit is not read at all.
      results.jump(3);
      await flush();
      expect(finds()).toHaveLength(2);
      expect(results.loading()).toBe(false);
      expect(results.page()?.firstRow).toBe(50);
    });

    it('reads the last page with skip at a page boundary, not from the end', async () => {
      results.run(query({ limit: '100' }));
      estimates[0]?.resolve({ count: 10_000 });
      await flush();
      await answer(1, docs(1, 50));
      expect(results.pageCount()).toBe(2);
      results.last();
      await flush();
      // Only an estimate: the count (capped by the limit) comes first, then the skip read.
      expect(finds()).toHaveLength(1);
      expect(fake.requestsFor('docs.count')[0]?.params).toMatchObject({ limit: 100 });
      counts[0]?.resolve({ count: 100 });
      await flush();
      expect(lastFind()).toMatchObject({ skip: 50, limit: 50 });
      expect(lastFind()).not.toHaveProperty('fromEnd');
      await answer(2, docs(51, 50));
      expect(results.paging().pageIndex).toBe(1);
      expect(results.canNext()).toBe(false);
    });

    it('sends the limit with the exact count and clips the count to it', async () => {
      await runAndLoad(query({ filter: '{ a: 1 }', limit: '120' }));
      results.countExact();
      await flush();
      expect(fake.requestsFor('docs.count')[0]?.params).toMatchObject({ limit: 120 });
      counts[0]?.resolve({ count: 120 });
      await flush();
      expect(results.count()).toEqual({ value: 120, exact: true });
      expect(results.pageCount()).toBe(3);
    });

    it('last with a filter and a limit but no count counts first, then reads the last page', async () => {
      await runAndLoad(query({ filter: '{ a: 1 }', limit: '120' }));
      results.last();
      await flush();
      expect(fake.requestsFor('docs.count')[0]?.params).toMatchObject({ limit: 120 });
      counts[0]?.resolve({ count: 120 });
      await flush();
      expect(lastFind()).toMatchObject({ skip: 100, limit: 20 });
      expect(lastFind()).not.toHaveProperty('fromEnd');
    });

    it('last with a limit and an exact count reads the last page at once, without counting again', async () => {
      await runAndLoad(query({ filter: '{ a: 1 }', limit: '120' }));
      results.countExact();
      await flush();
      counts[0]?.resolve({ count: 120 });
      await flush();
      results.last();
      await flush();
      expect(fake.requestsFor('docs.count')).toHaveLength(1);
      expect(lastFind()).toMatchObject({ skip: 100, limit: 20 });
      await answer(2, docs(101, 20));
      expect(results.paging().pageIndex).toBe(2);
      expect(results.pagesFromEnd()).toBeNull();
      expect(results.canNext()).toBe(false);
    });

    it('last with a limit, counted to fewer rows than the limit, reads the real last page', async () => {
      await runAndLoad(query({ filter: '{ a: 1 }', limit: '500' }));
      results.last();
      await flush();
      counts[0]?.resolve({ count: 77 }); // fewer matches than the limit
      await flush();
      expect(results.count()).toEqual({ value: 77, exact: true });
      // The limit turns the read from the end into a skip read of page 2 (at most a full page).
      expect(lastFind()).toMatchObject({ skip: 50 });
      expect(lastFind()['limit']).toBeGreaterThanOrEqual(27);
      expect(lastFind()).not.toHaveProperty('fromEnd');
      await answer(2, docs(51, 27));
      expect(results.page()?.firstRow).toBe(50);
      expect(results.canNext()).toBe(false);
    });

    it('a pending Last is dropped when a new query runs before its count answers', async () => {
      await runAndLoad(query({ filter: '{ a: 1 }', limit: '120' }));
      results.last();
      await flush();
      const countId = fake.requestsFor('docs.count')[0]?.id;
      results.run(query({ filter: '{ b: 2 }' }));
      await flush();
      expect(fake.cancels).toContain(countId);
      counts[0]?.resolve({ count: 120 });
      await flush();
      expect(finds()).toHaveLength(2); // only page 1 of each query
      expect(results.count()).toBeNull();
      expect(results.counting()).toBe(false);
    });

    it('pressing Last again while its count runs reads the last page once', async () => {
      await runAndLoad(query({ filter: '{ a: 1 }', limit: '120' }));
      results.last();
      await flush();
      results.last();
      await flush();
      expect(fake.requestsFor('docs.count')).toHaveLength(2);
      counts[1]?.resolve({ count: 120 });
      await flush();
      counts[0]?.resolve({ count: 120 });
      await flush();
      expect(finds()).toHaveLength(2);
      expect(lastFind()).toMatchObject({ skip: 100, limit: 20 });
    });

    it('a result shorter than the limit ends where the documents end', async () => {
      await runAndLoad(query({ filter: '{ a: 1 }', limit: '500' }), docs(1, 30));
      expect(results.canNext()).toBe(false);
    });
  });

  describe('opaque sort', () => {
    const META = '{ score: { $meta: "textScore" } }';

    it('sends a $meta sort as typed and pages with skip', async () => {
      results.run(query({ sort: META }));
      estimates[0]?.resolve({ count: 1_000 });
      await flush();
      expect(lastFind()['sort']).toBe('{"score":{"$meta":"textScore"}}');
      await answer(1, docs(1, 50));
      results.next();
      await flush();
      expect(lastFind()).toMatchObject({ skip: 50, sort: '{"score":{"$meta":"textScore"}}' });
      expect(lastFind()).not.toHaveProperty('after');
      await answer(2, docs(51, 50));
      results.previous();
      await flush();
      expect(lastFind()).not.toHaveProperty('before');
      expect(lastFind()).not.toHaveProperty('skip'); // page 1
    });

    it('reads the last page of an opaque sort with skip from the count', async () => {
      results.run(query({ sort: META }));
      estimates[0]?.resolve({ count: 1_000 });
      await flush();
      await answer(1, docs(1, 50));
      results.last();
      await flush();
      expect(lastFind()).toMatchObject({ skip: 950, limit: 50 });
      expect(lastFind()).not.toHaveProperty('fromEnd');
    });
  });

  describe('collation', () => {
    it('pages with skip, never with after/before bounds', async () => {
      results.run(query({ collation: '{ locale: "en", strength: 2 }' }));
      estimates[0]?.resolve({ count: 1_000 });
      await flush();
      expect(lastFind()['collation']).toBe('{"locale":"en","strength":{"$numberInt":"2"}}');
      expect(lastFind()).not.toHaveProperty('sort'); // natural order, no implied {_id: 1}
      await answer(1, docs(1, 50));
      results.next();
      await flush();
      await answer(2, docs(51, 50));
      results.next();
      await flush();
      await answer(3, docs(101, 50));
      results.previous();
      await flush();
      await answer(4, docs(51, 50));
      results.last();
      await flush();
      for (const params of finds()) {
        expect(params).not.toHaveProperty('after');
        expect(params).not.toHaveProperty('before');
        expect(params).not.toHaveProperty('fromEnd');
      }
      expect(finds().map((p) => p['skip'])).toEqual([undefined, 50, 100, 50, 950]);
    });

    it('sends the collation with the exact count', async () => {
      await runAndLoad(query({ filter: '{ n: "a" }', collation: '{ locale: "en" }' }));
      results.countExact();
      await flush();
      expect(fake.requestsFor('docs.count')[0]?.params).toMatchObject({
        collation: '{"locale":"en"}',
      });
    });
  });

  describe('page size', () => {
    it('a new run keeps the chosen page size', async () => {
      await runAndLoad(query({}));
      results.setPageSize(20);
      await flush();
      expect(lastFind()).toMatchObject({ limit: 20 });
      expect(lastFind()).not.toHaveProperty('after');
      await answer(2, docs(1, 20));
      results.run(query({ filter: '{ a: 1 }' }));
      await flush();
      expect(lastFind()).toMatchObject({ limit: 20 });
      expect(results.paging().pageSize).toBe(20);
    });

    it('a page-size change supersedes a running page read', async () => {
      await runAndLoad(query({}));
      results.jump(4);
      await flush();
      results.setPageSize(100);
      await flush();
      expect(fake.cancels).toContain(sid(2));
      await answer(3, docs(1, 100));
      await answer(2, docs(151, 50));
      expect(results.page()?.docs).toHaveLength(100);
      expect(results.page()?.firstRow).toBe(0);
    });
  });

  describe('failures and cancel', () => {
    const fail = (n: number, error: ErrorInfo) => {
      fake.failStream(sid(n), error);
      return flush();
    };

    it('a page read failing mid-stream keeps the shown page and reports the error', async () => {
      await runAndLoad(query({}));
      results.next();
      await flush();
      fake.data('docs.find', sid(2), { docs: docs(51, 10) });
      await fail(2, { code: 'SERVER_ERROR', message: 'cursor killed' });
      expect(results.error()).toContain('cursor killed');
      expect(results.loading()).toBe(false);
      expect(results.page()?.firstRow).toBe(0);
      expect(results.page()?.docs[0]).toBe(docs(1, 1)[0]);
      // Paging can be retried; the error goes away when the next read starts.
      results.next();
      await flush();
      expect(results.error()).toBeNull();
    });

    it('a stream ending with CANCELLED is a notice, not an error', async () => {
      await runAndLoad(query({}));
      results.next();
      await flush();
      await fail(2, { code: 'CANCELLED', message: 'cancelled' });
      expect(results.error()).toBeNull();
      expect(results.notice()).toBe('Query cancelled.');
    });

    it('a failed exact count is shown and counting stops', async () => {
      await runAndLoad(query({ filter: '{ a: 1 }' }));
      results.countExact();
      await flush();
      counts[0]?.reject(new Error('count timed out'));
      await flush();
      expect(results.counting()).toBe(false);
      expect(results.error()).toContain('count timed out');
      expect(results.count()).toBeNull();
    });

    it('a failed estimate is silent; the page still loads', async () => {
      results.run(query({}));
      await flush();
      estimates[0]?.reject(new Error('no estimate'));
      await answer(1, docs(1, 50));
      expect(results.error()).toBeNull();
      expect(results.counting()).toBe(false);
      expect(results.count()).toBeNull();
      expect(results.page()?.docs).toHaveLength(50);
    });

    it('cancel with nothing running gives no notice', async () => {
      await runAndLoad(query({}));
      estimates[0]?.resolve({ count: 50 });
      await flush();
      results.cancel();
      expect(results.notice()).toBeNull();
      expect(results.busy()).toBe(false);
    });

    it('destroying the service stops the running page read and count', async () => {
      await runAndLoad(query({ filter: '{ a: 1 }' }));
      results.next();
      results.countExact();
      await flush();
      const countId = fake.requestsFor('docs.count')[0]?.id;
      results.ngOnDestroy();
      await flush();
      expect(fake.cancels).toEqual(expect.arrayContaining([sid(2), countId]));
      expect(results.busy()).toBe(false);
      expect(results.notice()).toBeNull();
      // Late answers change nothing.
      await answer(2, docs(51, 50));
      counts[0]?.resolve({ count: 10 });
      await flush();
      expect(results.page()?.firstRow).toBe(0);
      expect(results.count()).toBeNull();
    });
  });

  describe('pager guards', () => {
    it('previous on page 1, next on the last page and invalid page numbers read nothing', async () => {
      await runAndLoad(query({ filter: '{ a: 1 }' }), docs(1, 30));
      results.previous();
      results.next(); // a short page 1 is the last page
      results.jump(0);
      results.jump(-2);
      results.jump(1.5);
      results.jump(Number.NaN);
      await flush();
      expect(finds()).toHaveLength(1);
      expect(results.loading()).toBe(false);
    });
  });

  describe('last page without a count', () => {
    it('an estimate arriving after the last page was read from the end does not place it', async () => {
      results.run(query({}));
      await flush();
      await answer(1, docs(1, 50));
      results.last(); // the estimate is still running: no count yet
      await flush();
      expect(lastFind()).toMatchObject({ fromEnd: true, limit: 50 });
      await answer(2, docs(9951, 50));
      expect(results.pagesFromEnd()).toBe(0);
      estimates[0]?.resolve({ count: 10_000 });
      await flush();
      // A full page from the end is not aligned to the estimated page boundaries.
      expect(results.pagesFromEnd()).toBe(0);
      expect(results.count()).toEqual({ value: 10_000, exact: false });
      expect(finds()).toHaveLength(2); // an estimate does not read the page again
    });

    it('previous from a last page read right after page 1 reads the page before the last', async () => {
      await runAndLoad(query({ filter: '{ a: 1 }' }));
      results.last();
      await flush();
      expect(lastFind()).toMatchObject({ fromEnd: true });
      await answer(2, docs(9951, 50));
      expect(results.pagesFromEnd()).toBe(0);
      results.previous();
      await flush();
      // The page before the last one lies before the shown page's first row, not at the start.
      expect(lastFind()).toMatchObject({ before: '{"_id":{"$numberInt":"9951"}}', limit: 50 });
      await answer(3, docs(9901, 50));
      expect(results.pagesFromEnd()).toBe(1);
    });

    it('pages back by range all the way; a short page before a bound is page 1', async () => {
      await runAndLoad(query({ filter: '{ a: 1 }' }));
      results.last();
      await flush();
      await answer(2, docs(71, 50)); // 120 documents: the last 50 are 71-120
      results.previous();
      await flush();
      expect(lastFind()).toMatchObject({ before: '{"_id":{"$numberInt":"71"}}' });
      await answer(3, docs(21, 50));
      expect(results.pagesFromEnd()).toBe(1);
      expect(results.canPrevious()).toBe(true);
      results.previous();
      await flush();
      expect(lastFind()).toMatchObject({ before: '{"_id":{"$numberInt":"21"}}', limit: 50 });
      await answer(4, docs(1, 20));
      // Fewer rows than asked: the start was reached, so this is page 1 with a known position.
      expect(results.pagesFromEnd()).toBeNull();
      expect(results.paging().pageIndex).toBe(0);
      expect(results.canPrevious()).toBe(false);
    });

    it('next from one page before an unknown last page reaches the last page', async () => {
      await runAndLoad(query({ filter: '{ a: 1 }' }));
      results.last();
      await flush();
      await answer(2, docs(9951, 50));
      results.previous();
      await flush();
      await answer(3, docs(9901, 50));
      results.next();
      await flush();
      expect(lastFind()).toMatchObject({ after: '{"_id":{"$numberInt":"9950"}}' });
      await answer(4, docs(9951, 50));
      expect(results.pagesFromEnd()).toBe(0);
      expect(results.canNext()).toBe(false);
    });

    it('jumps by number after an unknown last page with skip, not from its edge rows', async () => {
      await runAndLoad(query({ filter: '{ a: 1 }' }));
      results.last(); // placeholder index 1
      await flush();
      await answer(2, docs(9951, 50));
      for (const [page, skip] of [
        [3, 100],
        [2, 50],
      ] as const) {
        results.jump(page);
        await flush();
        expect(lastFind()).toMatchObject({ skip, limit: 50 });
        expect(lastFind()).not.toHaveProperty('after');
        expect(lastFind()).not.toHaveProperty('before');
      }
      await answer(4, docs(51, 50));
      expect(results.pagesFromEnd()).toBeNull();
      expect(results.page()?.firstRow).toBe(50);
    });

    it('first, jump to page 1 and a page-size change leave the unknown position', async () => {
      for (const leave of [
        () => results.first(),
        () => results.jump(1),
        () => results.setPageSize(20),
      ]) {
        await runAndLoad(query({ filter: '{ a: 1 }' }));
        results.last();
        await flush();
        await answer(finds().length, docs(9951, 50));
        expect(results.pagesFromEnd()).toBe(0);
        leave();
        await flush();
        expect(lastFind()).not.toHaveProperty('skip');
        expect(lastFind()).not.toHaveProperty('before');
        await answer(finds().length, docs(1, results.paging().pageSize === 50 ? 50 : 20));
        expect(results.pagesFromEnd()).toBeNull();
        expect(results.paging().pageIndex).toBe(0);
        expect(results.page()?.firstRow).toBe(0);
      }
    });

    it('a cancelled read from an unknown last page keeps it named from the end', async () => {
      await runAndLoad(query({ filter: '{ a: 1 }' }));
      results.last();
      await flush();
      await answer(2, docs(9951, 50));
      results.previous();
      await flush();
      results.cancel();
      expect(results.pagesFromEnd()).toBe(0);
      expect(results.page()?.docs[0]).toBe(docs(9951, 1)[0]);
      expect(results.canPrevious()).toBe(true);
    });

    it('previous from rows that are really page 1 shows page 1, not an empty result', async () => {
      // The filter matches exactly 50 documents: page 1 is full, so Last is offered (no count).
      await runAndLoad(query({ filter: '{ a: 1 }' }));
      results.last();
      await flush();
      await answer(2, docs(1, 50)); // the same 50 rows, read from the end
      expect(results.canPrevious()).toBe(true);
      results.previous();
      await flush();
      expect(lastFind()).toMatchObject({ before: '{"_id":{"$numberInt":"1"}}' });
      await answer(3, []); // nothing lies before the first document
      // Whatever the service reads next (if anything), it must end on page 1 with its documents.
      if (finds().length > 3) await answer(finds().length, docs(1, 50));
      expect(results.paging().pageIndex).toBe(0);
      expect(results.page()?.docs).toHaveLength(50);
    });

    it('an exact count arriving during a last-page read reads it again aligned', async () => {
      await runAndLoad(query({ filter: '{ a: 1 }' }));
      results.last();
      results.countExact();
      await flush();
      counts[0]?.resolve({ count: 1_234 });
      await flush();
      // The read from the end was a full page of 50, not the remainder of 34.
      await answer(2, docs(1185, 50));
      expect(lastFind()).toMatchObject({ fromEnd: true, limit: 34 });
      expect(results.pagesFromEnd()).toBe(0);
      await answer(3, docs(1201, 34));
      expect(results.pagesFromEnd()).toBeNull();
      expect(results.page()?.firstRow).toBe(1_200);
    });
  });

  describe('last page with an estimated count', () => {
    it('is named from the end, and pages back from it by range', async () => {
      results.run(query({}));
      estimates[0]?.resolve({ count: 1_234 });
      await flush();
      await answer(1, docs(1, 50));
      results.last();
      await flush();
      expect(lastFind()).toMatchObject({ fromEnd: true, limit: 50 });
      await answer(2, docs(1185, 50));
      // Rows 1 185-1 234 are not page 25 of ~25 (rows 1 201-1 250): the position stays unknown.
      expect(results.pagesFromEnd()).toBe(0);
      results.previous();
      await flush();
      expect(lastFind()).toMatchObject({ before: '{"_id":{"$numberInt":"1185"}}' });
      await answer(3, docs(1135, 50));
      expect(results.pagesFromEnd()).toBe(1);
      // Counted exactly, the page is read again by its number: page 24 of 25.
      results.countExact();
      await flush();
      counts[0]?.resolve({ count: 1_234 });
      await flush();
      expect(lastFind()).toMatchObject({ skip: 1_150, limit: 50 });
      await answer(4, docs(1151, 50));
      expect(results.pagesFromEnd()).toBeNull();
      expect(results.paging().pageIndex).toBe(23);
    });

    it('an estimate arriving on a page before the unknown last page keeps its name', async () => {
      results.run(query({}));
      await flush();
      await answer(1, docs(1, 50));
      results.last();
      await flush();
      await answer(2, docs(1185, 50));
      results.previous();
      await flush();
      await answer(3, docs(1135, 50));
      estimates[0]?.resolve({ count: 1_234 });
      await flush();
      expect(results.pagesFromEnd()).toBe(1);
      expect(results.count()).toEqual({ value: 1_234, exact: false });
      expect(finds()).toHaveLength(3);
    });

    it('an exact count answering while Previous runs from an unknown last page keeps Previous', async () => {
      // 1 234 documents; the user is on the last page (position unknown), starts an exact count,
      // and presses Previous before the count answers.
      results.run(query({}));
      estimates[0]?.resolve({ count: 1_234 });
      await flush();
      await answer(1, docs(1, 50));
      results.last();
      await flush();
      await answer(2, docs(1185, 50));
      results.countExact();
      await flush();
      results.previous();
      await flush();
      expect(lastFind()).toMatchObject({ before: '{"_id":{"$numberInt":"1185"}}' });
      counts[0]?.resolve({ count: 1_234 });
      await flush();
      // Answer every read the service still makes, as the collection would.
      for (let guard = 0; results.loading() && guard < 5; guard++) {
        const p = lastFind();
        const limit = p['limit'] as number;
        let rows: string[];
        if (p['before'] !== undefined) rows = docs(1135, limit);
        else if (p['fromEnd']) rows = docs(1_234 - limit + 1, limit);
        else rows = docs(((p['skip'] as number | undefined) ?? 0) + 1, limit);
        await answer(finds().length, rows);
      }
      // The page the user asked for: the one before the last (page 24 of 25: rows 1 151-1 200),
      // not the last page again.
      expect(results.pagesFromEnd()).toBeNull();
      expect(results.paging().pageIndex).toBe(23);
      expect(results.page()?.docs[0]).toBe(docs(1151, 1)[0]);
    });
  });

  describe('last page in skip mode', () => {
    const COLLATED = { sort: '{ name: 1 }', collation: '{ locale: "en" }' };

    it('counts exactly first, then reads the last page with its real size', async () => {
      await runAndLoad(query({ filter: '{ a: 1 }', ...COLLATED }));
      results.last();
      await flush();
      expect(finds()).toHaveLength(1); // nothing read before the count
      expect(results.counting()).toBe(true);
      expect(fake.requestsFor('docs.count')[0]?.params).toMatchObject({
        collation: '{"locale":"en"}',
      });
      counts[0]?.resolve({ count: 1_234 });
      await flush();
      expect(lastFind()).toMatchObject({ fromEnd: true, limit: 34 });
      await answer(2, docs(1201, 34));
      expect(results.pagesFromEnd()).toBeNull();
      expect(results.paging().pageIndex).toBe(24);
      results.previous();
      await flush();
      expect(lastFind()).toMatchObject({ skip: 1_150, limit: 50 });
    });

    it('with an estimate that would read from the end, counts exactly first too', async () => {
      results.run(query(COLLATED));
      estimates[0]?.resolve({ count: 1_000 });
      await flush();
      await answer(1, docs(1, 50));
      results.last();
      await flush();
      expect(finds()).toHaveLength(1);
      expect(fake.requestsFor('docs.count')).toHaveLength(1);
    });

    it('cancelling the count, or paging meanwhile, does not read the last page', async () => {
      await runAndLoad(query({ filter: '{ a: 1 }', ...COLLATED }));
      results.last();
      await flush();
      results.cancel();
      counts[0]?.resolve({ count: 1_234 });
      await flush();
      expect(finds()).toHaveLength(1);

      results.last();
      await flush();
      results.next();
      await flush();
      expect(finds()).toHaveLength(2);
      counts[1]?.resolve({ count: 1_234 });
      await flush();
      expect(finds()).toHaveLength(2); // the count is shown, but Last was superseded by Next
      expect(results.count()).toEqual({ value: 1_234, exact: true });
    });

    it('a failed count reports the error and reads nothing', async () => {
      await runAndLoad(query({ filter: '{ a: 1 }', ...COLLATED }));
      results.last();
      await flush();
      counts[0]?.reject(new Error('count timed out'));
      await flush();
      expect(results.error()).toContain('count timed out');
      expect(finds()).toHaveLength(1);
    });
  });

  describe('page beyond the end', () => {
    it('a jump beyond the limit reads nothing and says why', async () => {
      await runAndLoad(query({ filter: '{ a: 1 }', limit: '120' }));
      expect(results.jump(10)).toBe(false);
      expect(results.notice()).toContain('limit 120');
      expect(results.jump(2)).toBe(true);
      expect(results.notice()).toBeNull();
    });
  });

  describe('page size changes take effect with their page', () => {
    it('a cancelled page-size read keeps the old size and position', async () => {
      await runAndLoad(query({}));
      results.next();
      await flush();
      await answer(2, docs(51, 50));
      results.setPageSize(100);
      await flush();
      expect(lastFind()).toMatchObject({ limit: 100 });
      results.cancel();
      expect(results.paging().pageSize).toBe(50);
      expect(results.paging().pageIndex).toBe(1);
      expect(results.canPrevious()).toBe(true);
      results.next();
      await flush();
      expect(lastFind()).toMatchObject({ limit: 50, after: '{"_id":{"$numberInt":"100"}}' });
    });

    it('a failed page-size read keeps the old size', async () => {
      await runAndLoad(query({}));
      results.setPageSize(20);
      await flush();
      fake.failStream(sid(2), { code: 'SERVER_ERROR', message: 'boom' });
      await flush();
      expect(results.paging().pageSize).toBe(50);
      expect(results.page()?.docs).toHaveLength(50);
    });

    it('with a limit, the new size clips the page', async () => {
      await runAndLoad(query({ limit: '30' }), docs(1, 30));
      results.setPageSize(20);
      await flush();
      expect(lastFind()).toMatchObject({ limit: 20 });
      await answer(2, docs(1, 20));
      expect(results.paging().pageSize).toBe(20);
      expect(results.canNext()).toBe(true);
    });
  });
});
