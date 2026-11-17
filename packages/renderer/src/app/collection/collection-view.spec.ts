import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { Request } from '@thicket/contract';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import { DocumentEdits } from '../document';
import findIxscan from '../explain/fixtures/find-ixscan-8.2.json';
import { WorkspaceService, type WorkspaceTab } from '../layout/workspace.service';
import { ConfirmService } from '../safety/confirm.service';
import { ProfileSafetyService } from '../safety/profile-safety.service';
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
    // Only an estimate: the last 50 rows are not page 200 of ~200, so no number is guessed.
    expect(q<HTMLInputElement>('pager-page')?.value).toBe('');
    expect(q('pager-rows')?.textContent).toMatch(/Last 50\s+of ~10,000/);
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

  it('an empty page past the end does not blame the filter, and the pager stays usable', async () => {
    answer = () => [];
    const page = get<HTMLInputElement>('pager-page');
    page.value = '1000';
    page.dispatchEvent(new Event('change'));
    await settle();
    expect(lastFind()).toMatchObject({ skip: 49_950 });
    expect(q('results-empty')?.textContent).toContain('No documents on this page');
    expect(q('results-empty')?.textContent).not.toContain('match this query');
    expect(get<HTMLInputElement>('pager-page').value).toBe('1000');
    expect(q<HTMLButtonElement>('pager-prev')?.disabled).toBe(false);
    expect(q<HTMLButtonElement>('pager-first')?.disabled).toBe(false);
    answer = (p) => docs(1, p['limit'] as number);
    click('pager-first');
    await settle();
    expect(q('pager-rows')?.textContent).toContain('1–50');
  });

  it('a page number beyond the limit says the result ends at the limit', async () => {
    type('query-filter', '{ a: 1 }');
    type('query-limit', '120');
    click('query-run');
    await settle();
    const page = get<HTMLInputElement>('pager-page');
    page.value = '10';
    page.dispatchEvent(new Event('change'));
    await settle();
    expect(q('results-notice')?.textContent).toContain('past the end');
  });

  it('a jump to the page already shown still shows its number', async () => {
    click('pager-next');
    await settle();
    const page = get<HTMLInputElement>('pager-page');
    page.value = '2';
    page.dispatchEvent(new Event('change'));
    await settle();
    expect(get<HTMLInputElement>('pager-page').value).toBe('2');
  });

  it('a cancelled page-size change keeps the old size and page', async () => {
    click('pager-next');
    await settle();
    answer = () => null;
    const size = get<HTMLSelectElement>('pager-size');
    size.value = '100';
    size.dispatchEvent(new Event('change'));
    await settle();
    expect(lastFind()).toMatchObject({ limit: 100 });
    click('query-cancel');
    await settle();
    expect(get<HTMLSelectElement>('pager-size').value).toBe('50');
    expect(q('pager-rows')?.textContent).toContain('51–100');
    expect(get<HTMLInputElement>('pager-page').value).toBe('2');
    expect(q<HTMLButtonElement>('pager-prev')?.disabled).toBe(false);
  });

  it('cancel moves the focus to the Run button', async () => {
    answer = () => null;
    click('pager-next');
    await settle();
    get<HTMLButtonElement>('query-cancel').focus();
    click('query-cancel');
    await settle();
    expect(q('query-cancel')).toBeNull();
    expect(document.activeElement).toBe(q('query-run'));
  });

  it('in skip mode, Last counts exactly and then shows the last page by number', async () => {
    type('query-filter', '{ a: 1 }');
    type('query-sort', '{ name: 1 }');
    type('query-collation', '{ locale: "en" }');
    click('query-run');
    await settle();
    answer = () => docs(9951, 40);
    click('pager-last');
    await settle();
    expect(fake.requestsFor('docs.count')).toHaveLength(1);
    expect(lastFind()).toMatchObject({ fromEnd: true, limit: 40 });
    expect(q('pager-rows')?.textContent).toMatch(/9,951–9,990\s+of 9,990 documents/);
    expect(get<HTMLInputElement>('pager-page').value).toBe('200');
  });

  it('with a filter and a limit, Last counts first and then shows the last page by number', async () => {
    type('query-filter', '{ a: 1 }');
    type('query-limit', '120');
    click('query-run');
    await settle();
    click('pager-last');
    await settle();
    expect(fake.requestsFor('docs.count')[0]?.params).toMatchObject({ limit: 120 });
    expect(lastFind()).toMatchObject({ skip: 100, limit: 20 });
    expect(lastFind()).not.toHaveProperty('fromEnd');
    expect(q('pager-rows')?.textContent).toMatch(/101–120\s+of 120 documents/);
    expect(get<HTMLInputElement>('pager-page').value).toBe('3');
    expect(q<HTMLButtonElement>('pager-next')?.disabled).toBe(true);
  });

  it('cancelling the count that Last waits for reads no page and keeps the shown one', async () => {
    fake.handle('docs.count', () => new Promise(() => undefined));
    type('query-filter', '{ a: 1 }');
    type('query-limit', '120');
    click('query-run');
    await settle();
    click('pager-last');
    await settle();
    expect(q('pager-count')?.textContent).toContain('Counting');
    expect(q('query-cancel')).not.toBeNull();
    click('query-cancel');
    await settle();
    expect(finds()).toHaveLength(2);
    expect(q('results-notice')?.textContent).toContain('Query cancelled');
    expect(q('pager-rows')?.textContent).toContain('1–50');
    expect(get<HTMLInputElement>('pager-page').value).toBe('1');
  });

  it('previous from a last page that is really page 1 shows its documents, not an empty result', async () => {
    // The filter matches exactly 50 documents (ids 1-50): page 1 is full, so Last is offered.
    answer = (p) => {
      if (p['before'] !== undefined) return []; // nothing lies before document 1
      return docs(1, 50);
    };
    type('query-filter', '{ a: 1 }');
    click('query-run');
    await settle();
    click('pager-last');
    await settle();
    expect(q('pager-rows')?.textContent).toContain('Last 50');
    click('pager-prev');
    await settle();
    expect(q('results-empty')).toBeNull();
    expect(q('pager-rows')?.textContent).toContain('1–50');
    expect(get<HTMLInputElement>('pager-page').value).toBe('1');
  });

  /** Answers `docs.find` like a collection of documents with ids 1..n in `_id` order. */
  const collectionOf = (n: number) => (p: Record<string, unknown>) => {
    const limit = p['limit'] as number;
    const idOf = (bound: unknown) =>
      Number((JSON.parse(bound as string) as { _id: { $numberInt: string } })._id.$numberInt);
    if (p['fromEnd']) return docs(n - limit + 1, limit);
    if (p['before'] !== undefined) {
      const before = idOf(p['before']);
      const start = Math.max(1, before - limit);
      return docs(start, before - start);
    }
    const from = p['after'] !== undefined ? idOf(p['after']) : ((p['skip'] as number) ?? 0);
    return docs(from + 1, Math.max(0, Math.min(limit, n - from)));
  };

  it('paging back from Last to the start numbers page 1 and the pages after it aligned', async () => {
    // 120 documents: Last 71-120, Previous 21-70, Previous again reaches the start (1-20 only).
    answer = collectionOf(120);
    type('query-filter', '{ a: 1 }');
    click('query-run');
    await settle();
    click('pager-last');
    await settle();
    click('pager-prev');
    await settle();
    expect(q('pager-rows')?.textContent).toContain('1 page before the last');
    click('pager-prev');
    await settle();
    expect(q('results-empty')).toBeNull();
    expect(q('pager-rows')?.textContent).toContain('1–50');
    expect(get<HTMLInputElement>('pager-page').value).toBe('1');
    expect(q<HTMLButtonElement>('pager-prev')?.disabled).toBe(true);
    click('pager-next');
    await settle();
    expect(lastFind()).toMatchObject({ after: '{"_id":{"$numberInt":"50"}}' });
    expect(q('pager-rows')?.textContent).toContain('51–100');
    expect(get<HTMLInputElement>('pager-page').value).toBe('2');
  });

  it('an exact count answering while Previous runs from an unknown last page shows the page before the last', async () => {
    answer = collectionOf(1_234);
    let resolveCount!: (value: { count: number }) => void;
    fake.handle(
      'docs.count',
      () =>
        new Promise<{ count: number }>((resolve) => {
          resolveCount = resolve;
        }),
    );
    type('query-filter', '{ a: 1 }');
    click('query-run');
    await settle();
    click('pager-last');
    await settle();
    expect(q('pager-rows')?.textContent).toContain('Last 50');
    click('pager-count');
    await settle();
    // Previous is pressed while the count runs; its stream is held open until the count answers.
    const respond = answer;
    let held: Record<string, unknown> | null = null;
    answer = (p) => {
      held = p;
      return null;
    };
    const streamId = `s${streams + 1}`;
    click('pager-prev');
    await settle();
    expect(held).toMatchObject({ before: '{"_id":{"$numberInt":"1185"}}' });
    answer = respond;
    resolveCount({ count: 1_234 });
    await settle();
    expect(fake.cancels).not.toContain(streamId);
    const rows = respond(held ?? {}) ?? [];
    fake.data('docs.find', streamId, { docs: rows });
    fake.end(streamId, { delivered: rows.length });
    await settle();
    expect(get<HTMLInputElement>('pager-page').value).toBe('24');
    expect(q('pager-rows')?.textContent).toContain('1,151–1,200');
    expect(q('pager-rows')?.textContent).toMatch(/of 1,234 documents/);
  });

  it('Aggregate… opens the aggregation tab of this collection, once', async () => {
    const workspace = TestBed.inject(WorkspaceService);
    fixture.componentRef.setInput('tab', {
      ...TAB,
      detail: 'Live / shop',
      production: true,
    });
    await settle();
    click('open-aggregation');
    await settle();
    expect(workspace.active()).toEqual({
      id: 'aggregation:p1:shop.orders',
      kind: 'aggregation',
      title: 'orders aggregation',
      detail: 'Live / shop',
      production: true,
      data: { profileId: 'p1', db: 'shop', coll: 'orders', type: 'collection' },
    });
    // Its data is a copy: the builder cannot change the collection tab's data.
    expect(workspace.active()?.data).not.toBe(TAB.data);

    click('open-aggregation');
    await settle();
    expect(workspace.tabs().filter((t) => t.kind === 'aggregation')).toHaveLength(1);
  });

  it('Indexes… opens the indexes tab of this collection, once', async () => {
    const workspace = TestBed.inject(WorkspaceService);
    fixture.componentRef.setInput('tab', {
      ...TAB,
      detail: 'Live / shop',
      production: true,
    });
    await settle();
    click('open-indexes');
    await settle();
    expect(workspace.active()).toEqual({
      id: 'indexes:p1:shop.orders',
      kind: 'indexes',
      title: 'orders indexes',
      detail: 'Live / shop',
      production: true,
      data: { profileId: 'p1', db: 'shop', coll: 'orders', type: 'collection' },
    });
    expect(workspace.active()?.data).not.toBe(TAB.data);

    click('open-indexes');
    await settle();
    expect(workspace.tabs().filter((t) => t.kind === 'indexes')).toHaveLength(1);
  });

  it('Aggregate… is offered on a read-only profile (it reads)', async () => {
    TestBed.inject(ProfileSafetyService).set({
      id: 'p1',
      name: 'Reporting',
      readOnly: true,
      production: false,
    });
    await settle();
    expect(get<HTMLButtonElement>('open-aggregation').disabled).toBe(false);
  });

  it('lets the explorer edit documents on a writable profile', () => {
    const toggle = el().querySelector<HTMLButtonElement>('.mode-toggle');
    expect(toggle?.disabled).toBe(false);
    expect(q('edit-bar')).not.toBeNull();
  });

  it('offers export and import on a writable profile', async () => {
    expect(q('io-export')).not.toBeNull();
    click('io-import');
    await settle();
    expect(q('import-panel')).not.toBeNull();
    click('io-export');
    await settle();
    expect(q('import-panel')).toBeNull();
    expect(q('export-panel')).not.toBeNull();
  });

  it('does not offer import on a read-only profile, and closes an open import panel', async () => {
    const safety = TestBed.inject(ProfileSafetyService);
    click('io-import');
    await settle();
    expect(q('import-panel')).not.toBeNull();

    safety.set({ id: 'p1', name: 'Reporting', readOnly: true, production: false });
    await settle();
    expect(q('io-import')).toBeNull();
    expect(q('import-panel')).toBeNull();
    // Export is a read: still offered.
    expect(q('io-export')).not.toBeNull();
    expect(fake.requestsFor('io.previewImport')).toHaveLength(0);
    expect(fake.requestsFor('io.import')).toHaveLength(0);
  });

  it('exports the applied query; a second click on Export… closes the panel', async () => {
    type('query-filter', '{ status: "open" }');
    click('query-run');
    await settle();
    click('io-export');
    await settle();
    expect(q('io-export')?.getAttribute('aria-pressed')).toBe('true');
    expect(q('export-command')?.textContent).toContain('db.orders.find({ status: "open" })');

    click('io-export');
    await settle();
    expect(q('export-panel')).toBeNull();
    expect(q('io-export')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('opens the bulk panel on the applied query; a second click closes it', async () => {
    type('query-filter', '{ status: "open" }');
    type('query-collation', '{ locale: "de" }');
    click('query-run');
    await settle();
    // Typed but not run: the bulk panel keeps the applied query.
    type('query-filter', '{ status: "closed" }');
    click('bulk-open');
    await settle();
    expect(q('bulk-open')?.getAttribute('aria-pressed')).toBe('true');
    expect(q('bulk-command')?.textContent).toContain(
      'db.orders.updateMany({ status: "open" }, <update>, { collation: { locale: "de" } })',
    );

    click('bulk-open');
    await settle();
    expect(q('bulk-panel')).toBeNull();
    expect(q('bulk-open')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('the bulk panel close button closes it', async () => {
    click('bulk-open');
    await settle();
    click('bulk-close');
    await settle();
    expect(q('bulk-panel')).toBeNull();
  });

  it('does not offer bulk update/delete on a read-only profile, and closes an open panel', async () => {
    click('bulk-open');
    await settle();
    expect(q('bulk-panel')).not.toBeNull();
    TestBed.inject(ProfileSafetyService).set({
      id: 'p1',
      name: 'Reporting',
      readOnly: true,
      production: false,
    });
    await settle();
    expect(q('bulk-open')).toBeNull();
    expect(q('bulk-panel')).toBeNull();
  });

  it('a bulk delete reads the shown page again', async () => {
    fake.respond('docs.previewMany', { matched: 3, sample: docs(1, 3) });
    fake.respond('docs.deleteMany', { deleted: 3 });
    const confirm = TestBed.inject(ConfirmService);
    click('bulk-open');
    await settle();
    click('bulk-mode-delete');
    await settle();
    click('bulk-preview');
    await settle();
    expect(finds()).toHaveLength(1);
    click('bulk-execute');
    await settle();
    expect(confirm.current()).not.toBeNull();
    confirm.answer(true);
    await settle();
    expect(fake.requestsFor('docs.deleteMany')).toHaveLength(1);
    expect(finds()).toHaveLength(2);
    expect(lastFind()).toMatchObject({ coll: 'orders', filter: '{}' });
  });

  it('keeps the bulk panel open while a confirmed write runs: the toolbar toggles are disabled', async () => {
    let answerDelete: (deleted: number) => void = () => undefined;
    fake.respond('docs.previewMany', { matched: 3, sample: docs(1, 3) });
    fake.handle(
      'docs.deleteMany',
      () =>
        new Promise((resolve) => {
          answerDelete = (deleted) => resolve({ deleted });
        }),
    );
    const confirm = TestBed.inject(ConfirmService);
    click('bulk-open');
    await settle();
    click('bulk-mode-delete');
    await settle();
    click('bulk-preview');
    await settle();
    click('bulk-execute');
    await settle();
    // The confirm dialog is open, nothing is sent: the toggles still work.
    expect(get<HTMLButtonElement>('bulk-open').disabled).toBe(false);
    confirm.answer(true);
    await settle();
    expect(fake.requestsFor('docs.deleteMany')).toHaveLength(1);
    for (const id of ['bulk-open', 'io-export', 'io-import', 'bulk-close']) {
      expect(get<HTMLButtonElement>(id).disabled).toBe(true);
    }
    // A click that gets through anyway changes nothing.
    (fixture.componentInstance as unknown as { toggleIo(p: string): void }).toggleIo('bulk');
    await settle();
    expect(q('bulk-panel')).not.toBeNull();
    expect(fake.cancels).toEqual([]);

    answerDelete(3);
    await settle();
    expect(finds()).toHaveLength(2);
    for (const id of ['bulk-open', 'io-export', 'io-import', 'bulk-close']) {
      expect(get<HTMLButtonElement>(id).disabled).toBe(false);
    }
    click('bulk-open');
    await settle();
    expect(q('bulk-panel')).toBeNull();
  });

  it('a profile turning read-only during a bulk write does not leave the toggles locked', async () => {
    fake.respond('docs.previewMany', { matched: 3, sample: docs(1, 3) });
    // The write never answers: the removed panel reports nothing more about it.
    fake.handle('docs.deleteMany', () => new Promise(() => undefined));
    const safety = TestBed.inject(ProfileSafetyService);
    const confirm = TestBed.inject(ConfirmService);
    click('bulk-open');
    await settle();
    click('bulk-mode-delete');
    await settle();
    click('bulk-preview');
    await settle();
    click('bulk-execute');
    await settle();
    confirm.answer(true);
    await settle();
    expect(fake.requestsFor('docs.deleteMany')).toHaveLength(1);
    expect(get<HTMLButtonElement>('io-export').disabled).toBe(true);

    safety.set({ id: 'p1', name: 'Reporting', readOnly: true, production: false });
    await settle();
    expect(q('bulk-panel')).toBeNull();
    expect(get<HTMLButtonElement>('io-export').disabled).toBe(false);
    // The sent write is not cancelled by removing the panel.
    expect(fake.cancels).toEqual([]);

    safety.set({ id: 'p1', name: 'Reporting', readOnly: false, production: false });
    await settle();
    for (const id of ['bulk-open', 'io-export', 'io-import']) {
      expect(get<HTMLButtonElement>(id).disabled).toBe(false);
    }
  });

  /** Opens the import panel, chooses a file and imports it into `coll`; the stream ends at once. */
  const importInto = async (coll: string) => {
    fake.respond('io.previewImport', {
      fileToken: 'tok-1',
      fileName: 'orders-sample.json',
      sizeBytes: 64,
      sample: docs(1, 2),
    });
    fake.handle('io.import', () => {
      setTimeout(() => {
        fake.data('io.import', 'imp1', { processed: 2, failed: 0, errors: [] });
        fake.end('imp1');
      });
      return { streamId: 'imp1' };
    });
    fake.respond('coll.list', { collections: [] });
    click('io-import');
    await settle();
    click('import-choose');
    await settle();
    type('import-coll', coll);
    click('import-start');
    await settle();
    expect(q('import-status')?.getAttribute('data-phase')).toBe('done');
  };

  it('an import into the tab collection shows the new documents (the query runs again)', async () => {
    await importInto('orders');
    expect(finds()).toHaveLength(2);
    expect(lastFind()).toMatchObject({ coll: 'orders', filter: '{}' });
    expect(lastFind()['skip'] ?? 0).toBe(0);
  });

  it('an import into another collection leaves the shown page alone', async () => {
    await importInto('orders_copy');
    expect(finds()).toHaveLength(1);
  });

  it('a cancelled import into the tab collection also runs the query again', async () => {
    fake.respond('io.previewImport', {
      fileToken: 'tok-1',
      fileName: 'orders-sample.json',
      sizeBytes: 64,
      sample: docs(1, 2),
    });
    fake.handle('io.import', () => ({ streamId: 'imp1' }));
    fake.respond('coll.list', { collections: [] });
    click('io-import');
    await settle();
    click('import-choose');
    await settle();
    click('import-start');
    await settle();
    fake.data('io.import', 'imp1', { processed: 1, failed: 0, errors: [] });
    await settle();
    click('import-cancel');
    await settle();
    expect(q('import-status')?.getAttribute('data-phase')).toBe('cancelled');
    expect(finds()).toHaveLength(2);
    expect(lastFind()).toMatchObject({ coll: 'orders' });
  });

  it('a failed import into the tab collection also runs the query again', async () => {
    fake.respond('io.previewImport', {
      fileToken: 'tok-1',
      fileName: 'orders-sample.json',
      sizeBytes: 64,
      sample: docs(1, 2),
    });
    fake.handle('io.import', () => ({ streamId: 'imp1' }));
    fake.respond('coll.list', { collections: [] });
    click('io-import');
    await settle();
    click('import-choose');
    await settle();
    click('import-start');
    await settle();
    fake.data('io.import', 'imp1', { processed: 1, failed: 0, errors: [] });
    fake.failStream('imp1', { code: 'SERVER_ERROR', message: 'not primary (fictitious)' });
    await settle();
    expect(q('import-status')?.getAttribute('data-phase')).toBe('error');
    expect(finds()).toHaveLength(2);
    expect(lastFind()).toMatchObject({ coll: 'orders' });
  });

  describe('a large document with a cut array', () => {
    const sku = (i: number) => `SKU-${String(i).padStart(6, '0')}`;
    const skus = (from: number, n: number) => Array.from({ length: n }, (_, i) => sku(from + i));
    /** `{_id: Int32(1), name, items: [first 100 skus]}`, as `docs.find` sends it cut. */
    const bigDoc = JSON.stringify({
      _id: { $numberInt: '1' },
      name: 'large order (fictitious)',
      items: skus(0, 100),
    });
    const smallDoc = docs(2, 1)[0] ?? '';
    let slices: Record<string, unknown>[];

    /** Every text shown in the explorer that is one of the skus. */
    const shownSkus = () =>
      [...el().querySelectorAll('app-json-explorer .val')]
        .map((v) => /SKU-\d{6}/.exec(v.textContent ?? '')?.[0])
        .filter((t): t is string => t !== undefined);
    const pagerButton = (id: string) =>
      el().querySelector<HTMLButtonElement>(`[data-testid="nested-pager"] [data-testid="${id}"]`);

    beforeEach(async () => {
      slices = [];
      fake.handle('docs.getSlice', (params) => {
        const p = params as unknown as Record<string, unknown>;
        slices.push(p);
        const skip = p['skip'] as number;
        const limit = p['limit'] as number;
        return { items: JSON.stringify(skus(skip, limit)), total: 50_000 };
      });
      fake.handle('docs.find', () => {
        const id = `s${++streams}`;
        setTimeout(() => {
          fake.data('docs.find', id, {
            docs: [bigDoc, smallDoc],
            sliced: [{ index: 0, arrays: [{ path: 'items', total: 50_000, loaded: 100 }] }],
          });
          fake.end(id, { delivered: 2 });
        });
        return { streamId: id };
      });
      type('query-filter', '{ big: true }');
      click('query-run');
      await settle();
    });

    it('asks docs.find for cut arrays and shows the cut one with a pager over its whole length', () => {
      expect(lastFind()['slice']).toEqual({ above: 100, docBytes: 1024 * 1024 });
      expect(
        el().querySelector('[data-testid="nested-pager"] [data-testid="nested-pager-range"]')
          ?.textContent,
      ).toContain('1–100 of 50,000');
      expect(shownSkus()[0]).toBe(sku(0));
      expect(slices).toEqual([]);
    });

    it('reads another page of the array with docs.getSlice by _id and path', async () => {
      pagerButton('nested-pager-next')?.click();
      await settle();
      expect(slices).toEqual([
        {
          profileId: 'p1',
          db: 'shop',
          coll: 'orders',
          id: '{"$numberInt":"1"}',
          path: 'items',
          skip: 100,
          limit: 100,
        },
      ]);
      expect(shownSkus()[0]).toBe(sku(100));
      pagerButton('nested-pager-last')?.click();
      await settle();
      expect(slices.at(-1)).toMatchObject({ skip: 49_900, limit: 100 });
      expect(shownSkus().at(-1)).toBe(sku(49_999));
    });

    it('marks an edit of the large document partial, and leaves the cut array out of the update', async () => {
      el().querySelector<HTMLButtonElement>('.mode-toggle')?.click();
      await settle();
      const name = [...el().querySelectorAll<HTMLInputElement>('input.val-input.str')].find(
        (i) => i.value === 'large order (fictitious)',
      );
      if (!name) throw new Error('name of the large document not editable');
      name.value = 'renamed order';
      name.dispatchEvent(new Event('blur'));
      await settle();

      const edits = fixture.debugElement.injector.get(DocumentEdits);
      const entry = edits.get('{"$numberInt":"1"}');
      expect(entry?.partial).toBe(true);
      const pending = edits.pending().get('{"$numberInt":"1"}');
      expect(pending?.ok).toBe(true);
      // Only `name` changes: the 100 loaded items must never replace the 50 000 on the server.
      expect(JSON.stringify(pending)).toContain('renamed order');
      expect(JSON.stringify(pending)).not.toContain('items');
    });

    /** Renames the large document in the explorer and saves it with the edit bar. */
    const renameAndSave = async () => {
      el().querySelector<HTMLButtonElement>('.mode-toggle')?.click();
      await settle();
      const name = [...el().querySelectorAll<HTMLInputElement>('input.val-input.str')].find(
        (i) => i.value === 'large order (fictitious)',
      );
      if (!name) throw new Error('name of the large document not editable');
      name.value = 'renamed order';
      name.dispatchEvent(new Event('blur'));
      await settle();
      get<HTMLButtonElement>('edit-save').click();
      await settle();
    };
    const pagerRange = () =>
      el().querySelector('[data-testid="nested-pager"] [data-testid="nested-pager-range"]')
        ?.textContent;

    it('reads a saved large document back with its arrays cut, and keeps paging them', async () => {
      const gets: Record<string, unknown>[] = [];
      fake.respond('docs.update', { modified: true });
      fake.handle('docs.get', (params) => {
        gets.push(params as unknown as Record<string, unknown>);
        return {
          doc: bigDoc.replace('large order (fictitious)', 'renamed order'),
          sliced: [{ path: 'items', total: 50_000, loaded: 100 }],
        };
      });
      await renameAndSave();
      expect(fake.requestsFor('docs.update')).toHaveLength(1);
      expect(gets).toEqual([
        {
          profileId: 'p1',
          db: 'shop',
          coll: 'orders',
          id: '{"$numberInt":"1"}',
          sliceAbove: 100,
        },
      ]);
      // Still a partly loaded array: the pager spans the whole length and reads by getSlice.
      expect(pagerRange()).toContain('1–100 of 50,000');
      pagerButton('nested-pager-next')?.click();
      await settle();
      expect(slices.at(-1)).toMatchObject({ path: 'items', skip: 100, limit: 100 });
      expect(shownSkus()[0]).toBe(sku(100));
    });

    it('reads a saved small document back whole (no sliceAbove)', async () => {
      const gets: Record<string, unknown>[] = [];
      fake.respond('docs.update', { modified: true });
      fake.handle('docs.get', (params) => {
        gets.push(params as unknown as Record<string, unknown>);
        return { doc: smallDoc.replace('doc 2', 'doc 2 renamed'), sliced: [] };
      });
      el().querySelector<HTMLButtonElement>('.mode-toggle')?.click();
      await settle();
      const name = [...el().querySelectorAll<HTMLInputElement>('input.val-input.str')].find(
        (i) => i.value === 'doc 2',
      );
      if (!name) throw new Error('name of the small document not editable');
      name.value = 'doc 2 renamed';
      name.dispatchEvent(new Event('blur'));
      await settle();
      get<HTMLButtonElement>('edit-save').click();
      await settle();
      expect(gets).toHaveLength(1);
      expect(gets[0]).not.toHaveProperty('sliceAbove');
    });

    it('keeps the cut array partly loaded and the document partial when the read-back fails', async () => {
      fake.respond('docs.update', { modified: true });
      fake.fail('docs.get', { code: 'INTERNAL', message: 'not readable' });
      await renameAndSave();
      expect(fake.requestsFor('docs.get')).toHaveLength(1);
      // The saved version (with only the first 100 items) is shown, still as a cut array.
      expect(
        [...el().querySelectorAll<HTMLInputElement>('input.val-input.str')].some(
          (i) => i.value === 'renamed order',
        ),
      ).toBe(true);
      expect(pagerRange()).toContain('1–100 of 50,000');
      const edits = fixture.debugElement.injector.get(DocumentEdits);
      const name = [...el().querySelectorAll<HTMLInputElement>('input.val-input.str')].find(
        (i) => i.value === 'renamed order',
      );
      if (!name) throw new Error('name of the saved document not editable');
      name.value = 'renamed again';
      name.dispatchEvent(new Event('blur'));
      await settle();
      expect(edits.get('{"$numberInt":"1"}')?.partial).toBe(true);
    });

    describe('and a save conflict (conflict-ui)', () => {
      /** The server version someone else renamed; shortened to the loaded items for the test. */
      const serverDoc = (n = 100) =>
        JSON.stringify({
          _id: { $numberInt: '1' },
          name: 'renamed elsewhere (fictitious)',
          items: skus(0, n),
        });
      const shownNames = () =>
        [...el().querySelectorAll<HTMLInputElement>('input.val-input.str')].map((i) => i.value);

      /** Renames and saves the large document into a conflict with `serverDoc(n)`. */
      const saveIntoConflict = async (n?: number) => {
        fake.fail('docs.update', {
          code: 'CONFLICT',
          message: 'changed (fictitious)',
          detail: { current: serverDoc(n) },
        });
        await renameAndSave();
        expect(fake.requestsFor('docs.update')).toHaveLength(1);
      };

      it('keeps the edit and the cut array paging through getSlice', async () => {
        await saveIntoConflict();
        expect(q('conflict-view')).not.toBeNull();
        expect(fake.requestsFor('docs.get')).toHaveLength(0);
        const edits = fixture.debugElement.injector.get(DocumentEdits);
        expect(edits.get('{"$numberInt":"1"}')?.partial).toBe(true);
        expect(shownNames()).toContain('renamed order');
        expect(pagerRange()).toContain('1–100 of 50,000');
        pagerButton('nested-pager-next')?.click();
        await settle();
        expect(slices.at(-1)).toMatchObject({ path: 'items', skip: 100, limit: 100 });
      });

      it('offers only Keep server version (Overwrite and Merge would replace unloaded items)', async () => {
        await saveIntoConflict();
        expect(q('conflict-keep-server')).not.toBeNull();
        expect(q('conflict-overwrite')).toBeNull();
        expect(q('conflict-merge')).toBeNull();
      });

      it('Keep server version reads the document back cut and keeps paging it', async () => {
        await saveIntoConflict();
        const gets: Record<string, unknown>[] = [];
        fake.handle('docs.get', (params) => {
          gets.push(params as unknown as Record<string, unknown>);
          return { doc: serverDoc(), sliced: [{ path: 'items', total: 50_000, loaded: 100 }] };
        });
        click('conflict-keep-server');
        await settle();
        expect(gets).toEqual([
          {
            profileId: 'p1',
            db: 'shop',
            coll: 'orders',
            id: '{"$numberInt":"1"}',
            sliceAbove: 100,
          },
        ]);
        expect(q('conflict-view')).toBeNull();
        expect(shownNames()).toContain('renamed elsewhere (fictitious)');
        expect(pagerRange()).toContain('1–100 of 50,000');
        pagerButton('nested-pager-last')?.click();
        await settle();
        expect(slices.at(-1)).toMatchObject({ path: 'items', skip: 49_900, limit: 100 });
        expect(shownSkus().at(-1)).toBe(sku(49_999));
      });

      it('Keep server version shows the conflict version, still cut, when the read-back fails', async () => {
        // The conflict carries more items than were loaded; the array still spans the whole length.
        await saveIntoConflict(300);
        fake.fail('docs.get', { code: 'INTERNAL', message: 'not readable (fictitious)' });
        click('conflict-keep-server');
        await settle();
        expect(fake.requestsFor('docs.get')).toHaveLength(1);
        expect(shownNames()).toContain('renamed elsewhere (fictitious)');
        expect(pagerRange()).toContain('1–100 of 50,000');
        const before = slices.length;
        pagerButton('nested-pager-next')?.click();
        await settle();
        // Items 100-199 are among the shown version's items: nothing is read for them.
        expect(slices).toHaveLength(before);
        expect(shownSkus()[0]).toBe(sku(100));
        // The document is still partial for the next edit.
        const name = [...el().querySelectorAll<HTMLInputElement>('input.val-input.str')].find(
          (i) => i.value === 'renamed elsewhere (fictitious)',
        );
        if (!name) throw new Error('name of the kept document not editable');
        name.value = 'renamed again';
        name.dispatchEvent(new Event('blur'));
        await settle();
        const edits = fixture.debugElement.injector.get(DocumentEdits);
        expect(edits.get('{"$numberInt":"1"}')?.partial).toBe(true);
      });

      it('an unknown server version: Keep server version leaves the cut document as loaded', async () => {
        // No readable version in the conflict, and reading it fails: nothing to show instead.
        fake.fail('docs.update', { code: 'CONFLICT', message: 'changed (fictitious)' });
        fake.fail('docs.get', { code: 'INTERNAL', message: 'not readable (fictitious)' });
        await renameAndSave();
        expect(get('conflict-title').textContent).toContain('could not be read');
        click('conflict-keep-server');
        await settle();
        const gets = fake.requestsFor('docs.get').map((r) => r.params as Record<string, unknown>);
        expect(gets).toHaveLength(2);
        expect(gets[1]).toMatchObject({ sliceAbove: 100 });
        expect(q('conflict-view')).toBeNull();
        // The edit is discarded; the loaded version stays, with its cut array.
        expect(shownNames()).toContain('large order (fictitious)');
        expect(shownNames()).not.toContain('renamed order');
        expect(pagerRange()).toContain('1–100 of 50,000');
        pagerButton('nested-pager-next')?.click();
        await settle();
        expect(slices.at(-1)).toMatchObject({ path: 'items', skip: 100, limit: 100 });
      });
    });

    it('starts the inner pages over when another page of documents is read', async () => {
      pagerButton('nested-pager-next')?.click();
      await settle();
      expect(pagerRange()).toContain('101–200 of 50,000');
      const before = slices.length;
      click('query-run');
      await settle();
      expect(pagerRange()).toContain('1–100 of 50,000');
      // The first page is among the loaded items: nothing is read for it.
      expect(slices).toHaveLength(before);
    });

    it('does not mark the small document of the same page partial', async () => {
      el().querySelector<HTMLButtonElement>('.mode-toggle')?.click();
      await settle();
      const name = [...el().querySelectorAll<HTMLInputElement>('input.val-input.str')].find(
        (i) => i.value === 'doc 2',
      );
      if (!name) throw new Error('name of the small document not editable');
      name.value = 'doc 2 renamed';
      name.dispatchEvent(new Event('blur'));
      await settle();
      const edits = fixture.debugElement.injector.get(DocumentEdits);
      expect(edits.get('{"$numberInt":"2"}')?.partial).toBe(false);
    });
  });

  describe('Explain (explain-ui)', () => {
    const explains = () =>
      fake.requestsFor('agg.explain').map((r: Request) => r.params as Record<string, unknown>);
    const explainTarget = (i: number) =>
      (explains()[i]?.['target'] ?? {}) as Record<string, unknown>;

    beforeEach(() => {
      fake.respond('agg.explain', { explain: JSON.stringify(findIxscan) });
    });

    it('explains the parsed query bar as a find on the tab collection and shows the plan', async () => {
      type('query-filter', '{ status: "open", n: { $gt: 100 } }');
      type('query-projection', '{ name: 1 }');
      type('query-sort', '{ n: -1 }');
      type('query-collation', "{ locale: 'en' }");
      type('query-limit', '7');
      expect(q('explain-panel')).toBeNull();
      click('query-explain');
      await settle();
      expect(explains()).toHaveLength(1);
      expect(explains()[0]).toEqual({
        profileId: 'p1',
        db: 'shop',
        coll: 'orders',
        target: {
          kind: 'find',
          filter: '{"status":"open","n":{"$gt":{"$numberInt":"100"}}}',
          projection: '{"name":{"$numberInt":"1"}}',
          sort: '{"n":{"$numberInt":"-1"}}',
          collation: '{"locale":"en"}',
          limit: 7,
        },
      });
      // Explain does not run the query.
      expect(finds()).toHaveLength(1);
      expect(q('explain-panel')).not.toBeNull();
      expect(q('explain-verdict')?.textContent).toContain('status_1_n_1');
    });

    it('an empty query bar explains the empty filter without optional fields', async () => {
      click('query-explain');
      await settle();
      expect(explainTarget(0)['kind']).toBe('find');
      expect(explainTarget(0)['filter']).toBe('{}');
      for (const key of ['projection', 'sort', 'collation', 'limit']) {
        expect(explainTarget(0)[key]).toBeUndefined();
      }
    });

    it('an invalid query shows the field errors and sends nothing', async () => {
      type('query-filter', '{ status: "open"');
      type('query-limit', '-1');
      click('query-explain');
      await settle();
      expect(explains()).toHaveLength(0);
      expect(q('explain-panel')).toBeNull();
      expect(q('query-error-filter')?.textContent).toContain('Filter:');
      expect(q('query-error-limit')?.textContent).toContain('whole number');
      expect(finds()).toHaveLength(1);

      // Fixed: Explain clears the errors and explains.
      type('query-filter', '{ status: "open" }');
      type('query-limit', '');
      click('query-explain');
      await settle();
      expect(q('query-error-filter')).toBeNull();
      expect(q('query-error-limit')).toBeNull();
      expect(explains()).toHaveLength(1);
      expect(explainTarget(0)['filter']).toBe('{"status":"open"}');
    });

    it('an invalid query closes the plan of an earlier query', async () => {
      click('query-explain');
      await settle();
      expect(q('explain-panel')).not.toBeNull();
      type('query-filter', '{ status: ');
      click('query-explain');
      await settle();
      expect(q('explain-panel')).toBeNull();
      expect(q('query-error-filter')?.textContent).toContain('Filter:');
      expect(explains()).toHaveLength(1);
    });

    it('each Explain asks again, with the query bar at that moment', async () => {
      click('query-explain');
      await settle();
      click('query-explain');
      await settle();
      type('query-filter', '{ a: 1 }');
      click('query-explain');
      await settle();
      expect(explains().map((_, i) => explainTarget(i)['filter'])).toEqual([
        '{}',
        '{}',
        '{"a":{"$numberInt":"1"}}',
      ]);
    });

    it('shows a failed explain in the panel, not as a query error', async () => {
      fake.fail('agg.explain', { code: 'SERVER_ERROR', message: 'unknown operator: $foo' });
      click('query-explain');
      await settle();
      expect(q('explain-failed')?.textContent).toContain('unknown operator: $foo');
      expect(q('results-error')).toBeNull();
    });

    it('Close closes the panel', async () => {
      click('query-explain');
      await settle();
      click('explain-close');
      await settle();
      expect(q('explain-panel')).toBeNull();
      expect(explains()).toHaveLength(1);
    });

    it('pointing the tab at another collection closes the panel', async () => {
      click('query-explain');
      await settle();
      expect(q('explain-panel')).not.toBeNull();
      fixture.componentRef.setInput('tab', {
        ...TAB,
        id: 'p1/shop.invoices',
        data: { profileId: 'p1', db: 'shop', coll: 'invoices', type: 'collection' },
      });
      await settle();
      expect(q('explain-panel')).toBeNull();
      expect(explains()).toHaveLength(1);

      // The next Explain explains the new collection.
      click('query-explain');
      await settle();
      expect(explains().at(-1)).toMatchObject({ coll: 'invoices' });
    });

    it('the same collection opened again keeps the panel', async () => {
      click('query-explain');
      await settle();
      fixture.componentRef.setInput('tab', { ...TAB, data: { ...TAB.data } });
      await settle();
      expect(q('explain-panel')).not.toBeNull();
    });
  });
});
