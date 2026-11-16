import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { Request } from '@thicket/contract';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import type { WorkspaceTab } from '../layout/workspace.service';
import { CollectionView } from './collection-view';

const TAB: WorkspaceTab = {
  id: 'p1/shop.orders',
  kind: 'collection',
  title: 'orders',
  data: { profileId: 'p1', db: 'shop', coll: 'orders', type: 'collection' },
};

/** `n` documents `{_id: Int32(i), name: "doc i"}` as canonical EJSON, starting at `from`. */
function docs(from: number, n: number): string[] {
  return Array.from(
    { length: n },
    (_, i) => `{"_id":{"$numberInt":"${from + i}"},"name":"doc ${from + i}"}`,
  );
}

describe('CollectionView', () => {
  let fake: FakeThicketBridge;
  let fixture: ComponentFixture<CollectionView>;
  let streams: number;
  /** What `docs.find` streams answer; `null`: the stream stays open (a slow query). */
  let answer: (params: Record<string, unknown>) => string[] | null;

  const el = () => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(id: string) =>
    el().querySelector<T>(`[data-testid="${id}"]`);
  /** Like `q`, but the element must exist. */
  const get = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const found = q<T>(id);
    if (found === null) throw new Error(`no element ${id}`);
    return found;
  };
  const finds = (): Record<string, unknown>[] =>
    fake.requestsFor('docs.find').map((r: Request) => r.params as Record<string, unknown>);
  const lastFind = () => finds().at(-1) ?? {};

  /** Lets requests, stream events and change detection settle. */
  const settle = async () => {
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
  };

  const type = (id: string, value: string) => {
    const input = get<HTMLInputElement>(id);
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  const click = (id: string) => get<HTMLButtonElement>(id).click();

  beforeEach(async () => {
    fake = new FakeThicketBridge();
    streams = 0;
    answer = (p) =>
      docs(((p['skip'] as number | undefined) ?? 0) + 1, (p['limit'] as number) ?? 50);
    fake.handle('docs.find', (params) => {
      const id = `s${++streams}`;
      const result = answer(params as unknown as Record<string, unknown>);
      if (result !== null) {
        setTimeout(() => {
          fake.data('docs.find', id, { docs: result });
          fake.end(id, { delivered: result.length });
        });
      }
      return { streamId: id };
    });
    fake.respond('docs.estimatedCount', { count: 10_000 });
    fake.respond('docs.count', { count: 9_990 });
    TestBed.configureTestingModule({
      imports: [CollectionView],
      providers: [provideZonelessChangeDetection(), provideFakeThicket(fake)],
    });
    fixture = TestBed.createComponent(CollectionView);
    fixture.componentRef.setInput('tab', TAB);
    await settle();
  });

  it('shows page 1 of the collection with the estimated count when opened', () => {
    expect(finds()).toHaveLength(1);
    expect(lastFind()).toMatchObject({
      profileId: 'p1',
      db: 'shop',
      coll: 'orders',
      filter: '{}',
      sort: '{"_id":1}',
      limit: 50,
    });
    expect(fake.requestsFor('docs.estimatedCount')).toHaveLength(1);
    expect(q('pager-rows')?.textContent).toMatch(/1–50\s+of ~10,000 documents \(estimated\)/);
    expect(q('pager-pages')?.textContent).toContain('of ~200');
    // One row per document (the explorer's root table is horizontal here).
    expect(
      el().querySelectorAll('app-json-explorer .json-output > app-json-table > .tw tbody > tr'),
    ).toHaveLength(50);
  });

  it('shows the parse error of an invalid filter and does not run the query', async () => {
    type('query-filter', '{ status: "open", total: { $gt: 100 }');
    click('query-run');
    await settle();
    expect(finds()).toHaveLength(1);
    const error = q('query-error-filter');
    expect(error?.textContent).toContain('Filter:');
    expect(error?.textContent).toMatch(/line 1, column \d+/);
    expect(q('query-filter')?.getAttribute('aria-invalid')).toBe('true');
    expect(q('query-filter')?.getAttribute('aria-describedby')).toBe(error?.id);
    // The shown page stays.
    expect(q('pager-rows')?.textContent).toContain('1–50');

    // Calling code is refused too (the parser never evaluates).
    type('query-filter', '{ a: process.exit() }');
    click('query-run');
    await settle();
    expect(finds()).toHaveLength(1);
    expect(q('query-error-filter')).not.toBeNull();

    // Editing the field clears its error; a valid filter runs.
    type('query-filter', '{ status: "open" }');
    await settle();
    expect(q('query-error-filter')).toBeNull();
    click('query-run');
    await settle();
    expect(finds()).toHaveLength(2);
    expect(lastFind()['filter']).toBe('{"status":"open"}');
  });

  it('reports errors of every invalid field at once', async () => {
    type('query-sort', '{ a: }');
    type('query-limit', '-3');
    click('query-run');
    await settle();
    expect(q('query-error-sort')).not.toBeNull();
    expect(q('query-error-limit')?.textContent).toContain('whole number');
    expect(finds()).toHaveLength(1);
  });

  it('sends filter, projection, sort and collation as canonical EJSON', async () => {
    type(
      'query-filter',
      '{ total: { $gt: NumberLong(100) }, at: ISODate("2024-01-01T00:00:00Z") }',
    );
    type('query-projection', '{ name: 1 }');
    type('query-sort', '{ name: -1 }');
    type('query-collation', "{ locale: 'en', strength: 2 }");
    click('query-run');
    await settle();
    const p = lastFind();
    expect(p['filter']).toBe(
      '{"total":{"$gt":{"$numberLong":"100"}},"at":{"$date":{"$numberLong":"1704067200000"}}}',
    );
    expect(p['projection']).toBe('{"name":{"$numberInt":"1"}}');
    expect(p['sort']).toBe('{"name":-1}');
    expect(p['collation']).toBe('{"locale":"en","strength":{"$numberInt":"2"}}');
    // A filter: no estimate (it would count the whole collection).
    expect(fake.requestsFor('docs.estimatedCount')).toHaveLength(1);
    expect(q('pager-pages')).toBeNull();
  });

  it('pages with range bounds, jumps with skip, reads the last page from the end', async () => {
    click('pager-next');
    await settle();
    expect(lastFind()).toMatchObject({ after: '{"_id":{"$numberInt":"50"}}', limit: 50 });
    expect(q<HTMLInputElement>('pager-page')?.value).toBe('2');

    click('pager-prev');
    await settle();
    expect(lastFind()).not.toHaveProperty('before'); // page 1 is read without a bound
    expect(q<HTMLInputElement>('pager-page')?.value).toBe('1');

    const page = get<HTMLInputElement>('pager-page');
    page.value = '5';
    page.dispatchEvent(new Event('change'));
    await settle();
    expect(lastFind()).toMatchObject({ skip: 200, limit: 50 });
    expect(q('pager-rows')?.textContent).toContain('201–250');

    answer = () => docs(9951, 50);
    click('pager-last');
    await settle();
    expect(lastFind()).toMatchObject({ fromEnd: true, limit: 50, sort: '{"_id":1}' });
    expect(q<HTMLInputElement>('pager-page')?.value).toBe('200');
    expect(q<HTMLButtonElement>('pager-next')?.disabled).toBe(true);

    click('pager-first');
    await settle();
    expect(lastFind()).not.toHaveProperty('skip');
    expect(q<HTMLButtonElement>('pager-prev')?.disabled).toBe(true);
  });

  it('counts exactly on request', async () => {
    click('pager-count');
    await settle();
    expect(fake.requestsFor('docs.count')).toHaveLength(1);
    expect(fake.requestsFor('docs.count')[0]?.params).toMatchObject({ filter: '{}' });
    expect(q('pager-rows')?.textContent).toMatch(/of 9,990 documents/);
    expect(q('pager-pages')?.textContent).toContain('of 200');
    expect(q('pager-count')).toBeNull();
  });

  it('gives the last page read before the count its index once counted exactly', async () => {
    type('query-filter', '{ a: 1 }');
    click('query-run');
    await settle();
    click('pager-last');
    await settle();
    expect(lastFind()).toMatchObject({ fromEnd: true });
    // Without a count the page's number is unknown: the pager says so instead of guessing.
    expect(q<HTMLInputElement>('pager-page')?.value).toBe('');
    expect(q('pager-rows')?.textContent).toContain('Last 50');
    answer = () => docs(9951, 40);
    click('pager-count');
    await settle();
    // Counted 9 990: the last page is read again with its real size, 40 rows.
    expect(lastFind()).toMatchObject({ fromEnd: true, limit: 40 });
    expect(q<HTMLInputElement>('pager-page')?.value).toBe('200');
    expect(q('pager-rows')?.textContent).toContain('9,951–9,990');
  });

  it('counts pages paged back from an unknown last page from the end', async () => {
    type('query-filter', '{ a: 1 }');
    click('query-run');
    await settle();
    click('pager-next');
    await settle();
    click('pager-next');
    await settle();
    click('pager-last');
    await settle();
    click('pager-prev');
    await settle();
    expect(lastFind()).toHaveProperty('before');
    expect(q('pager-rows')?.textContent).toContain('50, 1 page before the last');
    click('pager-count');
    await settle();
    expect(lastFind()).toMatchObject({ skip: 9900, limit: 50 });
    expect(q<HTMLInputElement>('pager-page')?.value).toBe('199');
    expect(q('pager-rows')?.textContent).toContain('9,901–9,950');
  });

  it('changes the page size and goes back to page 1', async () => {
    click('pager-next');
    await settle();
    const size = get<HTMLSelectElement>('pager-size');
    expect([...size.options].map((o) => o.value)).toEqual(['20', '50', '100', '500']);
    size.value = '100';
    size.dispatchEvent(new Event('change'));
    await settle();
    expect(lastFind()).toMatchObject({ limit: 100 });
    expect(lastFind()).not.toHaveProperty('after');
    expect(q('pager-rows')?.textContent).toContain('1–100');
  });

  it('cancels a slow page read: the stream is cancelled and the shown page stays', async () => {
    answer = () => null;
    click('pager-next');
    await settle();
    expect(q('query-cancel')).not.toBeNull();
    expect(q('results')?.getAttribute('aria-busy')).toBe('true');
    const streamId = `s${streams}`;

    click('query-cancel');
    await settle();
    expect(fake.cancels).toContain(streamId);
    expect(q('query-cancel')).toBeNull();
    expect(q('results-notice')?.textContent).toContain('Query cancelled');
    expect(q('results')?.getAttribute('aria-busy')).toBe('false');
    // Late data of the cancelled stream is ignored; page 1 stays.
    fake.data('docs.find', streamId, { docs: docs(900, 1) });
    fake.end(streamId);
    await settle();
    expect(q('pager-rows')?.textContent).toContain('1–50');
    expect(q<HTMLInputElement>('pager-page')?.value).toBe('1');
  });

  it('cancels a slow new query', async () => {
    answer = () => null;
    type('query-filter', '{ slow: true }');
    click('query-run');
    await settle();
    expect(q('results-loading')).not.toBeNull();
    click('query-cancel');
    await settle();
    expect(fake.cancels).toContain(`s${streams}`);
    expect(q('results-loading')).toBeNull();
    expect(q('results-notice')?.textContent).toContain('Query cancelled');
  });

  it('cancels a slow exact count', async () => {
    let countId = '';
    fake.handle('docs.count', (_p, request) => {
      countId = request.id;
      return new Promise(() => undefined);
    });
    click('pager-count');
    await settle();
    expect(q('pager-count')?.textContent).toContain('Counting');
    click('query-cancel');
    await settle();
    expect(fake.cancels).toContain(countId);
    expect(q('pager-count')?.textContent).toContain('Count exactly');
  });

  it('shows a failed query as an error', async () => {
    fake.handle('docs.find', () => ({
      error: { code: 'SERVER_ERROR', message: 'unknown operator: $foo' },
    }));
    type('query-filter', '{ $foo: 1 }');
    click('query-run');
    await settle();
    expect(q('results-error')?.textContent).toContain('unknown operator: $foo');
  });

  it('ends the result at the limit', async () => {
    type('query-limit', '120');
    click('query-run');
    await settle();
    click('pager-next');
    await settle();
    click('pager-next');
    await settle();
    expect(lastFind()).toMatchObject({ limit: 20 });
    expect(q<HTMLButtonElement>('pager-next')?.disabled).toBe(true);
    // The estimated count is clipped to the limit; the last page is read with skip.
    click('pager-first');
    await settle();
    click('pager-last');
    await settle();
    expect(lastFind()).toMatchObject({ skip: 100, limit: 20 });
    expect(lastFind()).not.toHaveProperty('fromEnd');
  });

  it('shows the documents as a list and as raw shell syntax or EJSON', async () => {
    click('view-list');
    await settle();
    expect(el().querySelectorAll('[data-testid="result-doc"]')).toHaveLength(50);
    expect(el().querySelector('app-json-form')).not.toBeNull();

    click('view-raw');
    await settle();
    expect(q('raw-text')?.textContent).toContain('_id: 1,');
    expect(q('raw-text')?.textContent).toContain('name: "doc 1"');
    click('raw-ejson');
    await settle();
    expect(q('raw-text')?.textContent?.split('\n')[0]).toBe(docs(1, 1)[0]);
  });

  it('shows an empty result with a way back', async () => {
    answer = () => [];
    type('query-filter', '{ none: 1 }');
    click('query-run');
    await settle();
    expect(q('results-empty')?.textContent).toContain('No documents match');
    expect(q('pager-rows')?.textContent).toContain('No documents');
    answer = (p) => docs(1, p['limit'] as number);
    click('query-reset');
    await settle();
    expect(lastFind()['filter']).toBe('{}');
    expect(q<HTMLInputElement>('query-filter')?.value).toBe('');
  });

  it('keeps the query when the tab is opened again', async () => {
    type('query-filter', '{ a: 1 }');
    click('query-run');
    await settle();
    fixture.componentRef.setInput('tab', { ...TAB, data: { ...TAB.data } });
    await settle();
    expect(finds()).toHaveLength(2);
  });

  it('shows a document that cannot be read in every view without dropping the others', async () => {
    // Valid JSON, but not valid canonical EJSON (an Int32 wrapper holding no number).
    const unreadable = '{"_id":{"$numberInt":"not a number"}}';
    answer = () => [docs(1, 1)[0] ?? '', unreadable, docs(3, 1)[0] ?? ''];
    type('query-filter', '{ a: 1 }');
    click('query-run');
    await settle();
    expect(q('results-error')).toBeNull();
    expect(q('pager-rows')?.textContent).toContain('1–3');

    click('view-list');
    await settle();
    const items = el().querySelectorAll('[data-testid="result-doc"]');
    expect(items).toHaveLength(3);
    expect(items[1]?.textContent).toContain('could not be read');
    expect(items[0]?.querySelector('app-json-form')).not.toBeNull();

    click('view-raw');
    await settle();
    const raw = q('raw-text')?.textContent ?? '';
    expect(raw).toContain('// unreadable document');
    expect(raw).toContain('name: "doc 1"');
    expect(raw).toContain('name: "doc 3"');
    click('raw-ejson');
    await settle();
    // The EJSON view shows the text as received, the unreadable document included.
    expect(q('raw-text')?.textContent?.split('\n')).toEqual([
      docs(1, 1)[0],
      unreadable,
      docs(3, 1)[0],
    ]);

    click('view-table');
    await settle();
    expect(el().querySelector('app-json-explorer')).not.toBeNull();
  });

  it('closing the tab cancels a running page read and count', async () => {
    let countId = '';
    fake.handle('docs.count', (_p, request) => {
      countId = request.id;
      return new Promise(() => undefined);
    });
    answer = () => null;
    click('pager-next');
    click('pager-count');
    await settle();
    const streamId = `s${streams}`;
    expect(fake.cancels).not.toContain(streamId);
    fixture.destroy();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.cancels).toContain(streamId);
    expect(fake.cancels).toContain(countId);
  });

  it('previous on a last page read straight from page 1 shows the page before the last', async () => {
    type('query-filter', '{ a: 1 }');
    click('query-run');
    await settle();
    answer = () => docs(9951, 50);
    click('pager-last');
    await settle();
    expect(q('pager-rows')?.textContent).toContain('Last 50');
    expect(q<HTMLButtonElement>('pager-prev')?.disabled).toBe(false);
    answer = () => docs(9901, 50);
    click('pager-prev');
    await settle();
    expect(lastFind()).toHaveProperty('before');
    expect(q('pager-rows')?.textContent).toContain('50, 1 page before the last');
  });

  it('a page number beyond the limit is not read and the field shows the current page again', async () => {
    type('query-filter', '{ a: 1 }');
    type('query-limit', '120');
    click('query-run');
    await settle();
    const page = get<HTMLInputElement>('pager-page');
    page.value = '10';
    page.dispatchEvent(new Event('change'));
    await settle();
    expect(finds()).toHaveLength(2); // opening + run, nothing for page 10
    expect(q('pager-rows')?.textContent).toContain('1–50');
    expect(get<HTMLInputElement>('pager-page').value).toBe('1');
  });

  it('a page number past the last page (exact count) shows the last page number', async () => {
    click('pager-count'); // 9 990 documents: 200 pages
    await settle();
    answer = () => docs(9951, 40);
    click('pager-last');
    await settle();
    expect(get<HTMLInputElement>('pager-page').value).toBe('200');
    const page = get<HTMLInputElement>('pager-page');
    page.value = '999';
    page.dispatchEvent(new Event('change'));
    await settle();
    expect(q('pager-rows')?.textContent).toContain('9,951–9,990');
    expect(get<HTMLInputElement>('pager-page').value).toBe('200');
  });

  it('an invalid page number is not read and the field shows the current page again', async () => {
    const page = get<HTMLInputElement>('pager-page');
    for (const bad of ['0', '-1', '2.5']) {
      page.value = bad;
      page.dispatchEvent(new Event('change'));
      await settle();
      expect(get<HTMLInputElement>('pager-page').value).toBe('1');
    }
    expect(finds()).toHaveLength(1);
  });

  it('names a page several pages before an unknown last page', async () => {
    type('query-filter', '{ a: 1 }');
    click('query-run');
    await settle();
    for (let i = 0; i < 3; i++) {
      click('pager-next');
      await settle();
    }
    click('pager-last');
    await settle();
    click('pager-prev');
    await settle();
    click('pager-prev');
    await settle();
    expect(q('pager-rows')?.textContent).toContain('50, 2 pages before the last');
    expect(q<HTMLInputElement>('pager-page')?.value).toBe('');
  });

  it('shows the explorer read-only', () => {
    const toggle = el().querySelector<HTMLButtonElement>('.mode-toggle');
    expect(toggle?.disabled).toBe(true);
  });
});
