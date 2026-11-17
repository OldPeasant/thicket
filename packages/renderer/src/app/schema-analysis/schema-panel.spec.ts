import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { ResultOf } from '@thicket/contract';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import { typeCondition } from './schema-analysis.model';
import { SchemaPanel, type SchemaFilterPick, type SchemaParams } from './schema-panel';

/** A promise that the test settles itself, to control the order of answers. */
interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

type Result = ResultOf<'schema.analyze'>;
type Outcome = Result | { error: { code: 'SERVER_ERROR' | 'CANCELLED'; message: string } };

/** 4 sampled documents: `status` a string in 3 (one missing), `items` an array of documents. */
const ANALYSIS: Result = {
  sampled: 4,
  fields: [
    {
      path: 'items',
      probability: 0.5,
      count: 2,
      types: [{ bsonType: 'array', probability: 0.5, count: 2, examples: '[]' }],
    },
    {
      path: 'items.[]',
      probability: 1,
      count: 3,
      types: [{ bsonType: 'object', probability: 1, count: 3, examples: '[]' }],
    },
    {
      path: 'items.[].sku',
      probability: 1,
      count: 3,
      types: [
        {
          bsonType: 'string',
          probability: 2 / 3,
          count: 2,
          examples: '["SKU-1","SKU-2"]',
        },
        { bsonType: 'int', probability: 1 / 3, count: 1, examples: '[{"$numberInt":"42"}]' },
      ],
    },
    {
      path: 'status',
      probability: 0.75,
      count: 3,
      types: [{ bsonType: 'string', probability: 0.75, count: 3, examples: '["open","closed"]' }],
    },
  ],
};

describe('SchemaPanel', () => {
  let fake: FakeThicketBridge;
  let fixture: ComponentFixture<SchemaPanel>;
  let el: HTMLElement;
  /** One deferred answer per `schema.analyze` request, in request order. */
  let pending: Deferred<Outcome>[];
  let picks: SchemaFilterPick[];
  let closes: number;

  const params = (coll: string, extra: Partial<SchemaParams> = {}): SchemaParams => ({
    profileId: 'p1',
    db: 'shop',
    coll,
    ...extra,
  });
  const q = (id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const all = (selector: string) => [...el.querySelectorAll<HTMLElement>(selector)];
  const row = (path: string) =>
    el.querySelector<HTMLElement>(`[data-testid="schema-row"][data-path="${path}"]`);
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r));
      await fixture.whenStable();
    }
  };
  const requests = () => fake.requestsFor('schema.analyze');

  beforeEach(() => {
    fake = new FakeThicketBridge();
    pending = [];
    picks = [];
    closes = 0;
    fake.handle('schema.analyze', () => {
      const answer = deferred<Outcome>();
      pending.push(answer);
      return answer.promise;
    });
    TestBed.configureTestingModule({
      imports: [SchemaPanel],
      providers: [provideZonelessChangeDetection(), provideFakeThicket(fake)],
    });
    fixture = TestBed.createComponent(SchemaPanel);
    el = fixture.nativeElement as HTMLElement;
    fixture.componentInstance.pick.subscribe((p) => picks.push(p));
    fixture.componentInstance.closed.subscribe(() => closes++);
  });

  it('asks nothing for null params', async () => {
    fixture.componentRef.setInput('params', null);
    await settle();
    expect(requests()).toHaveLength(0);
    expect(q('schema-loading')).toBeNull();
    expect(q('schema-failed')).toBeNull();
    expect(all('[data-testid="schema-row"]')).toHaveLength(0);
  });

  it('asks schema.analyze with the params, shows loading, then one row per path', async () => {
    fixture.componentRef.setInput('params', params('orders', { filter: '{"a":1}' }));
    await settle();
    expect(requests()).toHaveLength(1);
    expect(requests()[0]?.params).toEqual({
      profileId: 'p1',
      db: 'shop',
      coll: 'orders',
      filter: '{"a":1}',
    });
    expect(q('schema-loading')?.textContent).toMatch(/Sampling 1,000 documents/);
    expect(q('schema-sampled')?.textContent?.trim()).toBe('');

    pending[0]?.resolve(ANALYSIS);
    await settle();
    expect(q('schema-loading')).toBeNull();
    expect(q('schema-sampled')?.textContent).toContain('4 documents sampled');
    expect(all('[data-testid="schema-row"]').map((r) => r.dataset['path'])).toEqual([
      'items',
      'items.[]',
      'items.[].sku',
      'status',
    ]);
    // Array items are labelled, nested rows are indented.
    expect(row('items.[]')?.querySelector('th')?.textContent).toContain('[ items ]');
    expect(row('items.[].sku')?.querySelector('th')?.textContent).toContain('sku');
  });

  it('the loading text names a custom sample size', async () => {
    fixture.componentRef.setInput('params', params('orders', { sampleSize: 25000 }));
    await settle();
    expect(q('schema-loading')?.textContent).toMatch(/Sampling 25,000 documents/);
  });

  it('shows present and missing shares, type shares and examples', async () => {
    fixture.componentRef.setInput('params', params('orders'));
    await settle();
    pending[0]?.resolve(ANALYSIS);
    await settle();

    const status = row('status');
    expect(status?.querySelector('[data-testid="schema-present"]')?.textContent).toContain('75 %');
    expect(status?.querySelector('[data-testid="schema-missing"]')?.textContent).toContain(
      '25 % missing',
    );
    expect(status?.querySelector('[data-testid="schema-bar"]')?.getAttribute('aria-label')).toBe(
      'string 75 %, missing 25 %',
    );

    const sku = row('items.[].sku');
    expect(sku?.querySelector('[data-testid="schema-missing"]')).toBeNull();
    expect(
      [...(sku?.querySelectorAll<HTMLElement>('[data-testid="schema-type"]') ?? [])].map((b) =>
        b.textContent?.replace(/\s+/g, ' ').trim(),
      ),
    ).toEqual(['string 66.7 %', 'int 33.3 %']);
    expect(
      [...(sku?.querySelectorAll<HTMLElement>('[data-testid="schema-example"]') ?? [])].map((b) =>
        b.textContent?.trim(),
      ),
    ).toEqual(['"SKU-1"', '"SKU-2"', '42']);
  });

  it('a click on an example emits its value under the filter key (array segments dropped)', async () => {
    fixture.componentRef.setInput('params', params('orders'));
    await settle();
    pending[0]?.resolve(ANALYSIS);
    await settle();
    const examples = [
      ...(row('items.[].sku')?.querySelectorAll<HTMLElement>('[data-testid="schema-example"]') ??
        []),
    ];
    examples[2]?.click();
    examples[0]?.click();
    expect(picks).toEqual([
      { key: 'items.sku', condition: { type: 'int', value: 42 } },
      { key: 'items.sku', condition: { type: 'string', value: 'SKU-1' } },
    ]);
  });

  it('a click on a type emits a $type condition', async () => {
    fixture.componentRef.setInput('params', params('orders'));
    await settle();
    pending[0]?.resolve(ANALYSIS);
    await settle();
    row('status')?.querySelector<HTMLElement>('[data-testid="schema-type"]')?.click();
    expect(picks).toEqual([{ key: 'status', condition: typeCondition('string') }]);
  });

  it('an empty sample says there is nothing to analyze', async () => {
    fixture.componentRef.setInput('params', params('orders', { filter: '{"none":true}' }));
    await settle();
    pending[0]?.resolve({ sampled: 0, fields: [] });
    await settle();
    expect(q('schema-empty')?.textContent).toContain('No documents match the filter');
    expect(q('schema-sampled')?.textContent).toContain('0 documents sampled');
    expect(all('[data-testid="schema-row"]')).toHaveLength(0);
  });

  it('one sampled document is "1 document sampled"', async () => {
    fixture.componentRef.setInput('params', params('orders'));
    await settle();
    pending[0]?.resolve({ ...ANALYSIS, sampled: 1 });
    await settle();
    expect(q('schema-sampled')?.textContent?.trim()).toBe('1 document sampled');
  });

  it('a failure ends the loading state; Analyze again retries', async () => {
    fixture.componentRef.setInput('params', params('orders'));
    await settle();
    pending[0]?.resolve({ error: { code: 'SERVER_ERROR', message: 'ns does not exist' } });
    await settle();
    expect(q('schema-loading')).toBeNull();
    expect(q('schema-failed')?.textContent).toContain('ns does not exist');
    q('schema-again')?.click();
    await settle();
    expect(requests()).toHaveLength(2);
    expect(q('schema-failed')).toBeNull();
    expect(q('schema-loading')).not.toBeNull();
    pending[1]?.resolve(ANALYSIS);
    await settle();
    expect(all('[data-testid="schema-row"]')).toHaveLength(4);
  });

  it('a CANCELLED answer (cancelled elsewhere) shows no error', async () => {
    fixture.componentRef.setInput('params', params('orders'));
    await settle();
    pending[0]?.resolve({ error: { code: 'CANCELLED', message: 'cancelled' } });
    await settle();
    expect(q('schema-failed')).toBeNull();
  });

  it('new params cancel the running request; its late answer does not replace the newer one', async () => {
    fixture.componentRef.setInput('params', params('orders'));
    await settle();
    fixture.componentRef.setInput('params', params('invoices'));
    await settle();
    expect(requests()).toHaveLength(2);
    expect(fake.cancels).toEqual([requests()[0]?.id]);
    pending[1]?.resolve({ sampled: 0, fields: [] });
    await settle();
    pending[0]?.resolve(ANALYSIS);
    await settle();
    expect(q('schema-empty')).not.toBeNull();
    expect(all('[data-testid="schema-row"]')).toHaveLength(0);
  });

  it('an older request failing after the newer one answered shows no error', async () => {
    fixture.componentRef.setInput('params', params('orders'));
    await settle();
    fixture.componentRef.setInput('params', params('invoices'));
    await settle();
    pending[1]?.resolve(ANALYSIS);
    await settle();
    pending[0]?.resolve({ error: { code: 'SERVER_ERROR', message: 'stale failure' } });
    await settle();
    expect(q('schema-failed')).toBeNull();
    expect(all('[data-testid="schema-row"]')).toHaveLength(4);
  });

  it('a newer request still running keeps the loading state when the older one answers', async () => {
    fixture.componentRef.setInput('params', params('orders'));
    await settle();
    q('schema-again')?.click();
    await settle();
    expect(fake.cancels).toEqual([requests()[0]?.id]);
    pending[0]?.resolve(ANALYSIS);
    await settle();
    expect(q('schema-loading')).not.toBeNull();
    expect(all('[data-testid="schema-row"]')).toHaveLength(0);
  });

  it('params set back to null cancel the running request and show nothing', async () => {
    fixture.componentRef.setInput('params', params('orders'));
    await settle();
    fixture.componentRef.setInput('params', null);
    await settle();
    expect(fake.cancels).toEqual([requests()[0]?.id]);
    pending[0]?.resolve(ANALYSIS);
    await settle();
    expect(q('schema-loading')).toBeNull();
    expect(all('[data-testid="schema-row"]')).toHaveLength(0);
  });

  it('Close emits closed', async () => {
    fixture.componentRef.setInput('params', params('orders'));
    await settle();
    q('schema-close')?.click();
    expect(closes).toBe(1);
  });

  it('destroying the panel cancels the running request', async () => {
    fixture.componentRef.setInput('params', params('orders'));
    await settle();
    fixture.destroy();
    expect(fake.cancels).toEqual([requests()[0]?.id]);
  });
});
