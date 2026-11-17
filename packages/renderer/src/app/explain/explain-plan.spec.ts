import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import { ExplainPanel, type ExplainParams } from './explain-panel';
import { ExplainPlan } from './explain-plan';
import aggGroup from './fixtures/agg-group-8.2.json';
import findCollscan from './fixtures/find-collscan-8.2.json';
import findIxscan from './fixtures/find-ixscan-8.2.json';

function byTestId(root: HTMLElement, id: string): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
}

function text(root: HTMLElement, id: string): string {
  return byTestId(root, id)[0]?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
  }
}

describe('ExplainPlan with captured MongoDB 8.2 explain output', () => {
  let fixture: ComponentFixture<ExplainPlan>;
  let el: HTMLElement;

  async function render(explain: object): Promise<void> {
    fixture.componentRef.setInput('explain', JSON.stringify(explain));
    await settle(fixture);
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ExplainPlan],
      providers: [provideZonelessChangeDetection()],
    });
    fixture = TestBed.createComponent(ExplainPlan);
    el = fixture.nativeElement as HTMLElement;
  });

  it('a find with an index: verdict, totals and the FETCH → IXSCAN tree', async () => {
    await render(findIxscan);
    expect(text(el, 'explain-verdict')).toBe('Index used: status_1_n_1');
    expect(text(el, 'explain-returned')).toBe((1425).toLocaleString());
    expect(text(el, 'explain-keys')).toBe((1425).toLocaleString());
    expect(text(el, 'explain-docs')).toBe((1425).toLocaleString());
    expect(text(el, 'explain-time')).toBe('6 ms');
    expect(text(el, 'explain-engine')).toBe('Classic');
    const stages = byTestId(el, 'explain-stage');
    expect(stages.map((s) => s.dataset['stage'])).toEqual(['FETCH', 'IXSCAN']);
    // IXSCAN is nested under FETCH (its input), one level deeper.
    expect(stages[1]?.parentElement?.closest('[data-testid="explain-stage"]')).toBe(stages[0]);
    expect(stages.map((s) => s.getAttribute('aria-level'))).toEqual(['1', '2']);
    expect(text(stages[1] as HTMLElement, 'explain-stage-index')).toBe('status_1_n_1');
    expect(stages[1]?.textContent).toContain('keys');
    expect(stages[1]?.textContent).toContain('"(100, inf]"');
    expect(stages[1]?.classList.contains('scan')).toBe(true);
  });

  it('a find without an index: COLLSCAN verdict marked as a scan', async () => {
    await render(findCollscan);
    const verdict = byTestId(el, 'explain-verdict')[0];
    expect(verdict?.textContent).toContain('No index used');
    expect(verdict?.textContent).toContain('COLLSCAN');
    expect(verdict?.classList.contains('scan')).toBe(true);
    expect(byTestId(el, 'explain-index')).toHaveLength(0);
    expect(text(el, 'explain-docs')).toBe((2000).toLocaleString());
    const collscan = el.querySelector('[data-stage="COLLSCAN"]');
    expect(collscan?.classList.contains('collscan')).toBe(true);
    // Its flow bar: examined everything (full width), returned 1425 of 2000.
    const returned = collscan?.querySelector<HTMLElement>('.flow .returned');
    expect(collscan?.querySelector<HTMLElement>('.flow .examined')?.style.width).toBe('100%');
    expect(returned?.style.width).toBe('71.25%');
  });

  it('an aggregate on the slot-based engine: pipeline stages over the query plan', async () => {
    await render(aggGroup);
    expect(byTestId(el, 'explain-stage').map((s) => s.dataset['stage'])).toEqual([
      '$sort',
      '$cursor',
      'GROUP',
      'COLLSCAN',
    ]);
    expect(text(el, 'explain-engine')).toBe('Slot-based');
    expect(text(el, 'explain-returned')).toBe('7');
    expect(el.querySelector('[data-stage="$sort"]')?.textContent).toContain('sortKey');
  });

  it('shows the raw output in the document viewer', async () => {
    await render(findIxscan);
    byTestId(el, 'explain-view-raw')[0]?.click();
    await settle(fixture);
    expect(byTestId(el, 'explain-tree')).toHaveLength(0);
    const raw = el.querySelector('app-explain-raw');
    expect(raw?.querySelector('app-json-explorer')).not.toBeNull();
    expect(raw?.textContent).toContain('winningPlan');
    expect(raw?.textContent).toContain('status_1_n_1');
    byTestId(el, 'explain-view-plan')[0]?.click();
    await settle(fixture);
    expect(byTestId(el, 'explain-tree')).toHaveLength(1);
  });

  it('planned only: no totals, a note instead', async () => {
    await render({ queryPlanner: { winningPlan: { stage: 'COLLSCAN' } } });
    expect(byTestId(el, 'explain-totals')).toHaveLength(0);
    expect(byTestId(el, 'explain-not-executed')).toHaveLength(1);
    expect(byTestId(el, 'explain-stage')).toHaveLength(1);
  });

  it('an output it cannot read: an error and the raw output', async () => {
    await render({ ok: 1 });
    expect(text(el, 'explain-error')).toContain('no query plan');
    expect(el.querySelector('app-explain-raw')).not.toBeNull();
  });

  it('several indexes and a collection scan: all indexes named, the scan mentioned', async () => {
    await render({
      queryPlanner: { winningPlan: { stage: 'IGNORED' } },
      executionStats: {
        nReturned: 1,
        executionStages: {
          stage: 'OR',
          inputStages: [
            { stage: 'IXSCAN', indexName: 'a_1' },
            { stage: 'IXSCAN', indexName: 'b_1' },
            { stage: 'COLLSCAN' },
          ],
        },
      },
    });
    const verdict = byTestId(el, 'explain-verdict')[0];
    expect(byTestId(el, 'explain-index').map((i) => i.textContent)).toEqual(['a_1', 'b_1']);
    expect(verdict?.textContent).toContain('and a collection scan');
    expect(verdict?.classList.contains('indexed')).toBe(true);
    expect(verdict?.classList.contains('scan')).toBe(false);
  });

  it('neither an index nor a collection scan: "No index used." without the scan warning', async () => {
    await render({ executionStats: { nReturned: 0, executionStages: { stage: 'EOF' } } });
    const verdict = byTestId(el, 'explain-verdict')[0];
    expect(verdict?.textContent?.trim()).toBe('No index used.');
    expect(verdict?.classList.contains('scan')).toBe(false);
    // Unknown totals are a dash, not 0.
    expect(text(el, 'explain-keys')).toBe('–');
    expect(text(el, 'explain-time')).toBe('– ms');
  });

  it('flow bars: a stage that returned a little still shows, keys count for index scans', async () => {
    await render({
      executionStats: {
        nReturned: 1,
        executionStages: {
          stage: 'FETCH',
          nReturned: 1,
          docsExamined: 1,
          inputStage: {
            stage: 'IXSCAN',
            indexName: 'a_1',
            nReturned: 1,
            keysExamined: 100_000,
            docsExamined: 0,
          },
        },
      },
    });
    const ixscan = el.querySelector('[data-stage="IXSCAN"]');
    expect(ixscan?.querySelector<HTMLElement>('.flow .examined')?.style.width).toBe('100%');
    // 1 of 100,000 would be 0.001%: shown as at least 1%.
    expect(ixscan?.querySelector<HTMLElement>('.flow .returned')?.style.width).toBe('1%');
    expect(ixscan?.textContent).toContain((100_000).toLocaleString());
  });

  it('planned only: no flow bars (nothing to compare)', async () => {
    await render({
      queryPlanner: {
        winningPlan: { stage: 'FETCH', inputStage: { stage: 'IXSCAN', indexName: 'a_1' } },
      },
    });
    expect(el.querySelectorAll('.flow')).toHaveLength(0);
    expect(byTestId(el, 'explain-stage').map((s) => s.dataset['stage'])).toEqual([
      'FETCH',
      'IXSCAN',
    ]);
  });

  it('a new explain output replaces the shown plan and keeps the chosen view', async () => {
    await render(findCollscan);
    byTestId(el, 'explain-view-raw')[0]?.click();
    await settle(fixture);
    await render(findIxscan);
    expect(byTestId(el, 'explain-view-raw')[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('app-explain-raw')?.textContent).toContain('status_1_n_1');
    byTestId(el, 'explain-view-plan')[0]?.click();
    await settle(fixture);
    expect(text(el, 'explain-verdict')).toBe('Index used: status_1_n_1');
  });
});

describe('ExplainPanel', () => {
  let fake: FakeThicketBridge;
  let fixture: ComponentFixture<ExplainPanel>;
  let el: HTMLElement;
  const params: ExplainParams = {
    profileId: 'p1',
    db: 'shop',
    coll: 'orders',
    target: { kind: 'find', filter: '{"status":"open"}' },
  };

  beforeEach(() => {
    fake = new FakeThicketBridge();
    TestBed.configureTestingModule({
      imports: [ExplainPanel],
      providers: [provideZonelessChangeDetection(), provideFakeThicket(fake)],
    });
    fixture = TestBed.createComponent(ExplainPanel);
    el = fixture.nativeElement as HTMLElement;
  });

  it('asks agg.explain for the params and shows the plan', async () => {
    fake.respond('agg.explain', { explain: JSON.stringify(findIxscan) });
    fixture.componentRef.setInput('params', params);
    await settle(fixture);
    expect(fake.requestsFor('agg.explain').map((r) => r.params)).toEqual([params]);
    expect(text(el, 'explain-verdict')).toBe('Index used: status_1_n_1');
  });

  it('asks again on "Explain again" and for new params', async () => {
    fake.respond('agg.explain', { explain: JSON.stringify(findCollscan) });
    fixture.componentRef.setInput('params', params);
    await settle(fixture);
    byTestId(el, 'explain-again')[0]?.click();
    await settle(fixture);
    fixture.componentRef.setInput('params', { ...params, coll: 'other' });
    await settle(fixture);
    expect(fake.requestsFor('agg.explain')).toHaveLength(3);
    expect(text(el, 'explain-verdict')).toContain('No index used');
  });

  it('shows a failed explain', async () => {
    fake.fail('agg.explain', { code: 'SERVER_ERROR', message: 'ns does not exist' });
    fixture.componentRef.setInput('params', params);
    await settle(fixture);
    expect(text(el, 'explain-failed')).toContain('ns does not exist');
  });

  it('emits closed from the Close button', async () => {
    fake.respond('agg.explain', { explain: JSON.stringify(findIxscan) });
    fixture.componentRef.setInput('params', params);
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => closed++);
    await settle(fixture);
    byTestId(el, 'explain-close')[0]?.click();
    expect(closed).toBe(1);
  });
});
