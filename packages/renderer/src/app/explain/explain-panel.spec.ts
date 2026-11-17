import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import { ExplainPanel, type ExplainParams } from './explain-panel';
import findCollscan from './fixtures/find-collscan-8.2.json';
import findIxscan from './fixtures/find-ixscan-8.2.json';

/** A promise that the test settles itself, to control the order of answers. */
interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Outcome = { explain: string } | { error: { code: 'SERVER_ERROR'; message: string } };

describe('ExplainPanel requests in flight', () => {
  let fake: FakeThicketBridge;
  let fixture: ComponentFixture<ExplainPanel>;
  let el: HTMLElement;
  /** One deferred answer per `agg.explain` request, in request order. */
  let pending: Deferred<Outcome>[];

  const params = (coll: string): ExplainParams => ({
    profileId: 'p1',
    db: 'shop',
    coll,
    target: { kind: 'find', filter: '{"status":"open"}' },
  });
  const q = (id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r));
      await fixture.whenStable();
    }
  };
  const ok = (explain: object): Outcome => ({ explain: JSON.stringify(explain) });

  beforeEach(() => {
    fake = new FakeThicketBridge();
    pending = [];
    fake.handle('agg.explain', () => {
      const answer = deferred<Outcome>();
      pending.push(answer);
      return answer.promise;
    });
    TestBed.configureTestingModule({
      imports: [ExplainPanel],
      providers: [provideZonelessChangeDetection(), provideFakeThicket(fake)],
    });
    fixture = TestBed.createComponent(ExplainPanel);
    el = fixture.nativeElement as HTMLElement;
  });

  it('shows nothing and asks nothing for null params', async () => {
    fixture.componentRef.setInput('params', null);
    await settle();
    expect(fake.requestsFor('agg.explain')).toHaveLength(0);
    expect(q('explain-loading')).toBeNull();
    expect(q('explain-failed')).toBeNull();
    expect(el.querySelector('app-explain-plan')).toBeNull();
  });

  it('shows a loading state until the answer, then the plan', async () => {
    fixture.componentRef.setInput('params', params('orders'));
    await settle();
    expect(q('explain-loading')?.textContent).toContain('Running explain');
    pending[0]?.resolve(ok(findIxscan));
    await settle();
    expect(q('explain-loading')).toBeNull();
    expect(q('explain-verdict')?.textContent).toContain('status_1_n_1');
  });

  it('a failure ends the loading state and Explain again can retry', async () => {
    fixture.componentRef.setInput('params', params('orders'));
    await settle();
    pending[0]?.resolve({ error: { code: 'SERVER_ERROR', message: 'ns does not exist' } });
    await settle();
    expect(q('explain-loading')).toBeNull();
    expect(q('explain-failed')?.textContent).toContain('ns does not exist');
    q('explain-again')?.click();
    await settle();
    expect(q('explain-failed')).toBeNull();
    expect(q('explain-loading')).not.toBeNull();
    pending[1]?.resolve(ok(findIxscan));
    await settle();
    expect(q('explain-verdict')?.textContent).toContain('status_1_n_1');
  });

  it('new params cancel the running request; its late answer does not replace the newer plan', async () => {
    fixture.componentRef.setInput('params', params('orders'));
    await settle();
    fixture.componentRef.setInput('params', params('invoices'));
    await settle();
    expect(fake.requestsFor('agg.explain')).toHaveLength(2);
    expect(fake.cancels).toEqual([fake.requestsFor('agg.explain')[0]?.id]);
    pending[1]?.resolve(ok(findIxscan));
    await settle();
    pending[0]?.resolve(ok(findCollscan));
    await settle();
    expect(q('explain-verdict')?.textContent).toContain('Index used: status_1_n_1');
  });

  it('an older request that fails after the newer one answered shows no error', async () => {
    fixture.componentRef.setInput('params', params('orders'));
    await settle();
    fixture.componentRef.setInput('params', params('invoices'));
    await settle();
    pending[1]?.resolve(ok(findIxscan));
    await settle();
    pending[0]?.resolve({ error: { code: 'SERVER_ERROR', message: 'stale failure' } });
    await settle();
    expect(q('explain-failed')).toBeNull();
    expect(q('explain-verdict')?.textContent).toContain('status_1_n_1');
  });

  it('a newer request still running keeps the loading state when the older one answers', async () => {
    fixture.componentRef.setInput('params', params('orders'));
    await settle();
    q('explain-again')?.click();
    await settle();
    pending[0]?.resolve(ok(findCollscan));
    await settle();
    expect(q('explain-loading')).not.toBeNull();
    expect(q('explain-verdict')).toBeNull();
  });

  it('params set back to null cancel the running request and show nothing', async () => {
    fixture.componentRef.setInput('params', params('orders'));
    await settle();
    fixture.componentRef.setInput('params', null);
    await settle();
    expect(fake.cancels).toHaveLength(1);
    pending[0]?.resolve(ok(findIxscan));
    await settle();
    expect(q('explain-loading')).toBeNull();
    expect(q('explain-verdict')).toBeNull();
  });

  it('closing the panel (destroying it) cancels the running request', async () => {
    fixture.componentRef.setInput('params', params('orders'));
    await settle();
    fixture.destroy();
    expect(fake.cancels).toEqual([fake.requestsFor('agg.explain')[0]?.id]);
  });
});
