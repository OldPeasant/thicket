import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import type { WorkspaceTab } from '../layout/workspace.service';
import { ConfirmService } from '../safety/confirm.service';
import { ProfileSafetyService } from '../safety/profile-safety.service';
import { READ_ONLY_HINT } from '../safety/write-control.directive';
import { AggregationView, PREVIEW_DEBOUNCE_MS, RESULT_PAGE_SIZE } from './aggregation-view';

const TAB: WorkspaceTab = {
  id: 'aggregation:p1:shop.orders',
  kind: 'aggregation',
  title: 'orders aggregation',
  data: { profileId: 'p1', db: 'shop', coll: 'orders', type: 'collection' },
};

/** `n` documents `{_id: Int32(i)}` as canonical EJSON, starting at `from`. */
function docs(from: number, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `{"_id":{"$numberInt":"${from + i}"}}`);
}

/** The operators of a pipeline sent as canonical EJSON. */
function operators(pipeline: unknown): string[] {
  return (JSON.parse(pipeline as string) as Record<string, unknown>[]).map(
    (stage) => Object.keys(stage)[0] ?? '',
  );
}

describe('AggregationView', () => {
  let fake: FakeThicketBridge;
  let fixture: ComponentFixture<AggregationView>;
  let view: AggregationView;
  let streams: number;
  /** Total documents the fake `agg.run` result has (before `$skip`/`$limit`). */
  let total: number;

  const el = () => fixture.nativeElement as HTMLElement;
  const all = (id: string) => [...el().querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
  const q = <T extends HTMLElement = HTMLElement>(id: string) =>
    el().querySelector<T>(`[data-testid="${id}"]`);
  const get = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const found = q<T>(id);
    if (found === null) throw new Error(`no element ${id}`);
    return found;
  };
  const stageEl = (i: number) => {
    const found = all('agg-stage')[i];
    if (!found) throw new Error(`no stage ${i}`);
    return found;
  };
  const inStage = <T extends HTMLElement = HTMLElement>(i: number, id: string): T => {
    const found = stageEl(i).querySelector<T>(`[data-testid="${id}"]`);
    if (found === null) throw new Error(`no ${id} in stage ${i}`);
    return found;
  };
  const previews = () =>
    fake.requestsFor('agg.previewStage').map((r) => r.params as Record<string, unknown>);
  const runs = () => fake.requestsFor('agg.run').map((r) => r.params as Record<string, unknown>);

  const settle = async () => {
    for (let i = 0; i < 6; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
  };

  const setBody = async (i: number, text: string) => {
    const area = inStage<HTMLTextAreaElement>(i, 'agg-stage-body');
    area.value = text;
    area.dispatchEvent(new Event('input'));
    await settle();
  };
  const setOperator = async (i: number, operator: string) => {
    const select = inStage<HTMLSelectElement>(i, 'agg-stage-operator');
    select.value = operator;
    select.dispatchEvent(new Event('change'));
    await settle();
  };
  const click = async (button: HTMLElement) => {
    button.click();
    await settle();
  };

  /** Builds $match → $group → $sort in the stage list. */
  const buildDemo = async () => {
    await setBody(0, '{ status: "open" }');
    await click(get('agg-add-stage'));
    await setOperator(1, '$group');
    await setBody(1, '{ _id: "$customer", total: { $sum: "$total" } }');
    await click(get('agg-add-stage'));
    await setOperator(2, '$sort');
    await setBody(2, '{ total: -1 }');
  };

  beforeEach(async () => {
    fake = new FakeThicketBridge();
    streams = 0;
    total = 3;
    fake.handle('agg.previewStage', (params) => ({
      docs: docs(1, operators(params.pipeline).length),
    }));
    fake.handle('agg.run', (params) => {
      const id = `s${++streams}`;
      const stages = JSON.parse(params.pipeline) as Record<string, { $numberInt?: string }>[];
      const skip = Number(stages.find((s) => '$skip' in s)?.['$skip']?.$numberInt ?? 0);
      const limitStage = stages.find((s) => '$limit' in s)?.['$limit'];
      const limit = limitStage ? Number(limitStage.$numberInt) : total;
      const result = docs(skip + 1, Math.max(0, Math.min(limit, total - skip)));
      setTimeout(() => {
        fake.data('agg.run', id, { docs: result });
        fake.end(id, { delivered: result.length });
      });
      return { streamId: id };
    });
    fake.respond('agg.createView', {});
    fake.respond('profiles.get', {
      profile: {
        id: 'p1',
        name: 'Local',
        connectionString: 'mongodb://db.example:27017',
        readOnly: false,
        production: false,
      },
      storedSecrets: [],
    } as never);
    TestBed.configureTestingModule({
      imports: [AggregationView],
      providers: [provideZonelessChangeDetection(), provideFakeThicket(fake)],
    });
    TestBed.inject(ProfileSafetyService).set({
      id: 'p1',
      name: 'Local',
      readOnly: false,
      production: false,
    });
    fixture = TestBed.createComponent(AggregationView);
    view = fixture.componentInstance;
    view.debounceMs = 0;
    fixture.componentRef.setInput('tab', TAB);
    await settle();
  });

  it('starts with a $match stage and previews it', () => {
    expect(all('agg-stage')).toHaveLength(1);
    expect(inStage<HTMLSelectElement>(0, 'agg-stage-operator').value).toBe('$match');
    expect(previews()).toHaveLength(1);
    expect(previews()[0]).toMatchObject({ profileId: 'p1', db: 'shop', coll: 'orders' });
    expect(operators(previews()[0]?.['pipeline'])).toEqual(['$match']);
    expect(inStage(0, 'agg-stage-preview').querySelectorAll('pre')).toHaveLength(1);
  });

  it('previews each stage with the stages up to it', async () => {
    await buildDemo();
    const last = new Map(previews().map((p) => [operators(p['pipeline']).length, p]));
    expect(operators(last.get(1)?.['pipeline'])).toEqual(['$match']);
    expect(operators(last.get(2)?.['pipeline'])).toEqual(['$match', '$group']);
    expect(operators(last.get(3)?.['pipeline'])).toEqual(['$match', '$group', '$sort']);
    // The fake answers one document per stage of the previewed pipeline.
    expect(inStage(2, 'agg-stage-preview').querySelectorAll('pre')).toHaveLength(3);
    expect(inStage(2, 'agg-preview-count').textContent).toContain('3 documents');
  });

  it('reordering stages changes the pipeline that runs and the previews', async () => {
    await buildDemo();
    await click(inStage(2, 'agg-stage-up'));
    expect(view.stages().map((s) => s.operator)).toEqual(['$match', '$sort', '$group']);
    expect(all('agg-stage').map((s) => s.getAttribute('aria-label'))).toEqual([
      'Stage 1 $match',
      'Stage 2 $sort',
      'Stage 3 $group',
    ]);
    // The moved stage is previewed with its new prefix.
    expect(operators(previews().at(-2)?.['pipeline'] ?? previews().at(-1)?.['pipeline'])).toEqual(
      expect.arrayContaining(['$match', '$sort']),
    );
    const prefixes = previews().map((p) => operators(p['pipeline']).join(' '));
    expect(prefixes).toContain('$match $sort');
    expect(prefixes).toContain('$match $sort $group');

    await click(get('agg-run'));
    expect(operators(runs().at(-1)?.['pipeline'])).toEqual(['$match', '$sort', '$group', '$limit']);

    await click(inStage(0, 'agg-stage-down'));
    expect(view.stages().map((s) => s.operator)).toEqual(['$sort', '$match', '$group']);
    // First can't move up, last can't move down.
    expect(inStage<HTMLButtonElement>(0, 'agg-stage-up').disabled).toBe(true);
    expect(inStage<HTMLButtonElement>(2, 'agg-stage-down').disabled).toBe(true);
  });

  it('a disabled stage is left out of the pipeline and of later previews', async () => {
    await buildDemo();
    const before = previews().length;
    await click(inStage(1, 'agg-stage-enabled'));
    expect(stageEl(1).classList).toContain('disabled');
    expect(inStage(1, 'agg-stage-preview').textContent).toContain('Disabled');
    // Only the $sort stage's preview changes: its prefix lost $group.
    const after = previews()
      .slice(before)
      .map((p) => operators(p['pipeline']));
    expect(after).toEqual([['$match', '$sort']]);

    await click(get('agg-run'));
    expect(operators(runs().at(-1)?.['pipeline'])).toEqual(['$match', '$sort', '$limit']);

    await click(inStage(1, 'agg-stage-enabled'));
    await click(get('agg-run'));
    expect(operators(runs().at(-1)?.['pipeline'])).toEqual(['$match', '$group', '$sort', '$limit']);
  });

  it('removes and inserts stages', async () => {
    await buildDemo();
    await click(inStage(1, 'agg-stage-remove'));
    expect(view.stages().map((s) => s.operator)).toEqual(['$match', '$sort']);
    await click(inStage(0, 'agg-stage-insert'));
    expect(view.stages().map((s) => s.operator)).toEqual(['$match', '$match', '$sort']);
  });

  it('a syntax error blocks the preview of that stage only', async () => {
    await buildDemo();
    const before = previews().length;
    await setBody(1, '{ _id: "$customer", total: { $sum: "$total" }');

    const error = inStage(1, 'agg-stage-error');
    expect(error.textContent).toMatch(/line 1, column/);
    expect(inStage(1, 'agg-stage-body').getAttribute('aria-invalid')).toBe('true');
    expect(inStage(1, 'agg-stage-body').getAttribute('aria-describedby')).toBe(error.id);
    expect(
      inStage(1, 'agg-stage-preview').querySelector('[data-testid="agg-preview-blocked"]'),
    ).not.toBeNull();
    expect(inStage(1, 'agg-stage-preview').querySelectorAll('pre')).toHaveLength(0);
    expect(stageEl(1).classList).toContain('invalid');

    // Stage 1 keeps its preview (not asked again); stage 3 is previewed without stage 2.
    expect(inStage(0, 'agg-stage-preview').querySelectorAll('pre')).toHaveLength(1);
    const after = previews()
      .slice(before)
      .map((p) => operators(p['pipeline']));
    expect(after).toEqual([['$match', '$sort']]);
    expect(inStage(2, 'agg-stage-preview').textContent).toContain(
      'Without stage 2: it has an error.',
    );
    expect(inStage(2, 'agg-stage-preview').querySelectorAll('pre')).toHaveLength(2);

    // Run refuses while an enabled stage has an error.
    await click(get('agg-run'));
    expect(runs()).toHaveLength(0);
    expect(get('agg-run-error').textContent).toContain('Fix stage 2 first');

    // Fixing it previews it again.
    await setBody(1, '{ _id: "$customer" }');
    expect(stageEl(1).querySelector('[data-testid="agg-stage-error"]')).toBeNull();
    expect(inStage(1, 'agg-stage-preview').querySelectorAll('pre')).toHaveLength(2);
  });

  it('an invalid operator and an empty argument are errors of their stage', async () => {
    await setBody(0, '');
    expect(inStage(0, 'agg-stage-error').textContent).toContain('$match needs an argument');
    view.updateStage(view.stages()[0]?.id ?? 0, { operator: 'match', body: '{}' });
    await settle();
    expect(inStage(0, 'agg-stage-error').textContent).toContain('is not a stage operator');
  });

  it('shows the error of a failed preview in that stage', async () => {
    fake.fail('agg.previewStage', { code: 'SERVER_ERROR', message: 'unknown operator $nope' });
    await setBody(0, '{ a: { $nope: 1 } }');
    expect(inStage(0, 'agg-preview-error').textContent).toContain('unknown operator $nope');
  });

  it('full-text mode shows the whole pipeline and keeps disabled stages', async () => {
    await buildDemo();
    await click(inStage(1, 'agg-stage-enabled'));
    await click(get('agg-mode-text'));
    const area = get<HTMLTextAreaElement>('agg-text');
    expect(area.value).toContain('$match');
    expect(area.value).toMatch(/^ {2}\/\/- \{\n {2}\/\/- {3}\$group:/m);
    expect(q('agg-stages')).toBeNull();

    // Edit the text: change the sort, then go back to the stage list.
    area.value = area.value.replace('total: -1', 'total: 1');
    area.dispatchEvent(new Event('input'));
    await click(get('agg-mode-stages'));
    expect(view.stages().map((s) => [s.operator, s.enabled])).toEqual([
      ['$match', true],
      ['$group', false],
      ['$sort', true],
    ]);
    expect(view.stages()[2]?.body).toContain('total: 1');
  });

  it('full-text mode refuses to leave text that does not parse', async () => {
    await click(get('agg-mode-text'));
    const area = get<HTMLTextAreaElement>('agg-text');
    area.value = '[{ $match: { a: 1 } }, { $limit: }]';
    area.dispatchEvent(new Event('input'));
    await click(get('agg-mode-stages'));
    expect(view.mode()).toBe('text');
    expect(get('agg-text-error').textContent).toMatch(/line 1/);
    // Run applies the text first and refuses it too.
    await click(get('agg-run'));
    expect(runs()).toHaveLength(0);
  });

  it('runs the pipeline and pages through the result', async () => {
    total = RESULT_PAGE_SIZE + 5;
    await click(get('agg-run'));
    expect(runs()).toHaveLength(1);
    expect(runs()[0]).not.toHaveProperty('confirmed');
    expect(all('agg-result-doc')).toHaveLength(RESULT_PAGE_SIZE);
    expect(get('agg-result-rows').textContent).toContain(`1–${RESULT_PAGE_SIZE}`);
    expect(get<HTMLButtonElement>('agg-prev').disabled).toBe(true);

    await click(get('agg-next'));
    expect(operators(runs().at(-1)?.['pipeline'])).toEqual(['$match', '$skip', '$limit']);
    expect(all('agg-result-doc')).toHaveLength(5);
    expect(get('agg-result-rows').textContent).toContain(
      `${RESULT_PAGE_SIZE + 1}–${RESULT_PAGE_SIZE + 5}`,
    );
    expect(get<HTMLButtonElement>('agg-next').disabled).toBe(true);

    await click(get('agg-prev'));
    expect(all('agg-result-doc')).toHaveLength(RESULT_PAGE_SIZE);
  });

  it('a $out pipeline asks first, is not paged and is not previewed', async () => {
    const confirms = TestBed.inject(ConfirmService);
    let asked = 0;
    confirms.confirm = () => {
      asked++;
      return Promise.resolve(asked > 1);
    };
    await click(get('agg-add-stage'));
    await setOperator(1, '$out');
    expect(inStage(1, 'agg-stage-preview').textContent).toContain('Run asks first');
    expect(previews().every((p) => !operators(p['pipeline']).includes('$out'))).toBe(true);

    await click(get('agg-run'));
    expect(asked).toBe(1);
    expect(runs()).toHaveLength(0);

    await click(get('agg-run'));
    expect(asked).toBe(2);
    expect(runs()).toHaveLength(1);
    expect(runs()[0]).toMatchObject({ confirmed: true });
    expect(operators(runs()[0]?.['pipeline'])).toEqual(['$match', '$out']);
    expect(get('agg-result-rows').textContent).toContain('output was written');
  });

  it('exports the pipeline as shell and Node code', async () => {
    await buildDemo();
    await click(get('agg-export'));
    const shell = get('agg-code').textContent ?? '';
    expect(shell).toContain('db.getSiblingDB("shop").getCollection("orders").aggregate(');
    expect(shell).toMatch(/\$match[\s\S]*\$group[\s\S]*\$sort/);

    await click(get('agg-lang-node'));
    const node = get('agg-code').textContent ?? '';
    expect(node).toContain('mongodb://db.example:27017');
    expect(node).toContain('.aggregate(');
    expect(node).toMatch(/\$match[\s\S]*\$group[\s\S]*\$sort/);

    await click(get('agg-lang-python'));
    expect(get('agg-code').textContent).toContain('pymongo');
    await click(get('agg-lang-java'));
    expect(get('agg-code').textContent).toContain('aggregate');

    // An error in a stage: no code, the reason instead.
    await setBody(0, '{');
    expect(q('agg-code')).toBeNull();
    expect(get('agg-code-error').textContent).toContain('Fix stage 1 first');
  });

  it('creates a view from the pipeline', async () => {
    await buildDemo();
    await click(get('agg-create-view'));
    await click(get('agg-view-submit'));
    expect(get('agg-view-message').textContent).toContain('Type a name');
    const name = get<HTMLInputElement>('agg-view-name');
    name.value = 'open_by_customer';
    name.dispatchEvent(new Event('input'));
    await click(get('agg-view-submit'));
    const sent = fake.requestsFor('agg.createView')[0]?.params as Record<string, unknown>;
    expect(sent).toMatchObject({
      profileId: 'p1',
      db: 'shop',
      view: 'open_by_customer',
      viewOn: 'orders',
    });
    expect(operators(sent['pipeline'])).toEqual(['$match', '$group', '$sort']);
    expect(get('agg-view-message').textContent).toContain('Created view shop.open_by_customer');
  });

  describe('preview requests in flight', () => {
    /** Preview requests the fake has not answered yet, in the order they were sent. */
    let pending: { id: string; ops: string[]; answer: (docs: string[]) => void }[];

    beforeEach(() => {
      pending = [];
      fake.handle(
        'agg.previewStage',
        (params, request) =>
          new Promise((resolve) => {
            pending.push({
              id: request.id,
              ops: operators(params.pipeline),
              answer: (d) => resolve({ docs: d }),
            });
          }),
      );
    });

    const answer = async (index: number, d: string[]) => {
      pending[index]?.answer(d);
      await settle();
    };

    it('a stage edited again while its preview runs aborts the old preview; its late answer is ignored', async () => {
      await setBody(0, '{ status: "open" }');
      expect(pending).toHaveLength(1);
      expect(inStage(0, 'agg-stage-preview').textContent).toContain('Loading preview');

      await setBody(0, '{ status: "closed" }');
      expect(pending).toHaveLength(2);
      expect(fake.cancels).toContain(pending[0]?.id);
      expect(fake.cancels).not.toContain(pending[1]?.id);

      // The aborted (older) request answers first: still loading, its documents never show.
      await answer(0, docs(1, 5));
      expect(inStage(0, 'agg-stage-preview').textContent).toContain('Loading preview');
      expect(inStage(0, 'agg-stage-preview').querySelectorAll('pre')).toHaveLength(0);

      await answer(1, docs(1, 2));
      expect(inStage(0, 'agg-stage-preview').querySelectorAll('pre')).toHaveLength(2);
    });

    it('an aborted preview that answers after the newer one does not overwrite it', async () => {
      await setBody(0, '{ status: "open" }');
      await setBody(0, '{ status: "closed" }');
      await answer(1, docs(1, 2));
      await answer(0, docs(1, 7));
      expect(inStage(0, 'agg-stage-preview').querySelectorAll('pre')).toHaveLength(2);
    });

    it('an aborted preview that fails does not show its error', async () => {
      fake.handle(
        'agg.previewStage',
        (params, request) =>
          new Promise((resolve) => {
            pending.push({
              id: request.id,
              ops: operators(params.pipeline),
              answer: (d) =>
                resolve(
                  d.length === 0
                    ? { error: { code: 'SERVER_ERROR', message: 'stale failure' } }
                    : { docs: d },
                ),
            });
          }),
      );
      await setBody(0, '{ status: "open" }');
      await setBody(0, '{ status: "closed" }');
      await answer(1, docs(1, 1));
      await answer(0, []);
      expect(q('agg-preview-error')).toBeNull();
      expect(inStage(0, 'agg-stage-preview').querySelectorAll('pre')).toHaveLength(1);
    });

    it('removing a stage cancels its running preview at once and drops it', async () => {
      await click(get('agg-add-stage'));
      // Only the new stage is previewed: the first stage's pipeline did not change.
      expect(pending.map((p) => p.ops)).toEqual([['$match', '$match']]);
      const id = view.stages()[1]?.id ?? -1;

      await click(inStage(1, 'agg-stage-remove'));
      expect(fake.cancels).toContain(pending[0]?.id);
      expect(view.previews().has(id)).toBe(false);

      await answer(0, docs(1, 3));
      expect(view.previews().has(id)).toBe(false);
      expect(all('agg-stage')).toHaveLength(1);
      expect(inStage(0, 'agg-stage-preview').querySelectorAll('pre')).toHaveLength(1);
    });

    it('disabling a stage cancels its running preview', async () => {
      await click(get('agg-add-stage'));
      await click(inStage(1, 'agg-stage-enabled'));
      expect(fake.cancels).toContain(pending[0]?.id);
      await answer(0, docs(1, 3));
      expect(inStage(1, 'agg-stage-preview').textContent).toContain('Disabled');
      expect(inStage(1, 'agg-stage-preview').querySelectorAll('pre')).toHaveLength(0);
    });

    it('a stage turning invalid cancels its running preview', async () => {
      await click(get('agg-add-stage'));
      await setBody(1, '{ a: ');
      expect(fake.cancels).toContain(pending[0]?.id);
      await answer(0, docs(1, 3));
      expect(inStage(1, 'agg-preview-blocked')).not.toBeNull();
    });

    it('closing the tab cancels running previews', async () => {
      await setBody(0, '{ status: "open" }');
      fixture.destroy();
      expect(fake.cancels).toContain(pending[0]?.id);
    });

    it('a stage whose pipeline did not change is not previewed again', async () => {
      await click(get('agg-add-stage'));
      await answer(0, docs(1, 1));
      // Whitespace only: the parsed pipeline is the same.
      await setBody(1, '  {  }  ');
      expect(pending).toHaveLength(1);
    });
  });

  describe('preview debounce', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      view.debounceMs = PREVIEW_DEBOUNCE_MS;
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    const tick = async (ms: number) => {
      await vi.advanceTimersByTimeAsync(ms);
      await fixture.whenStable();
    };
    const typeBody = async (text: string) => {
      const area = inStage<HTMLTextAreaElement>(0, 'agg-stage-body');
      area.value = text;
      area.dispatchEvent(new Event('input'));
      await tick(0);
    };

    it('asks for previews only once the typing has paused, with the last text', async () => {
      const before = previews().length;
      await typeBody('{ a: 1 }');
      await tick(PREVIEW_DEBOUNCE_MS - 100);
      await typeBody('{ a: 12 }');
      await tick(PREVIEW_DEBOUNCE_MS - 100);
      await typeBody('{ a: 123 }');
      await tick(PREVIEW_DEBOUNCE_MS - 1);
      expect(previews()).toHaveLength(before);

      await tick(1);
      expect(previews()).toHaveLength(before + 1);
      expect(previews().at(-1)?.['pipeline']).toBe('[{"$match":{"a":{"$numberInt":"123"}}}]');
    });
  });

  it('a failed preview stops loading and is asked again when the stage is re-enabled', async () => {
    fake.fail('agg.previewStage', { code: 'NOT_CONNECTED', message: 'gone' });
    await setBody(0, '{ a: 1 }');
    expect(inStage(0, 'agg-preview-error')).not.toBeNull();
    expect(inStage(0, 'agg-stage-preview').textContent).not.toContain('Loading preview');

    fake.respond('agg.previewStage', { docs: docs(1, 1) });
    const before = previews().length;
    await click(inStage(0, 'agg-stage-enabled'));
    await click(inStage(0, 'agg-stage-enabled'));
    expect(previews()).toHaveLength(before + 1);
    expect(inStage(0, 'agg-stage-preview').querySelectorAll('pre')).toHaveLength(1);
  });

  it('previews against the new collection when the tab is pointed elsewhere', async () => {
    const before = previews().length;
    fixture.componentRef.setInput('tab', {
      ...TAB,
      data: { profileId: 'p1', db: 'shop', coll: 'invoices', type: 'collection' },
    });
    await settle();
    expect(previews()).toHaveLength(before + 1);
    expect(previews().at(-1)).toMatchObject({ coll: 'invoices' });
  });

  it('previews nothing without a profile', async () => {
    const before = previews().length;
    fixture.componentRef.setInput('tab', { ...TAB, data: undefined });
    await settle();
    await click(get('agg-add-stage'));
    expect(previews()).toHaveLength(before);
    // The collection name falls back to the tab title.
    expect(el().querySelector('.ns')?.textContent).toContain('orders aggregation');
  });

  it('names every stage left out of a preview', async () => {
    await buildDemo();
    await click(get('agg-add-stage'));
    await setBody(0, '{ a: ');
    await setBody(1, '{ b: ');
    expect(inStage(3, 'agg-stage-preview').textContent).toContain(
      'Without stages 1, 2: they have errors.',
    );
    expect(inStage(2, 'agg-stage-preview').textContent).toContain(
      'Without stages 1, 2: they have errors.',
    );
  });

  it('disabling the stage with an error lets Run, Export and Create view use the pipeline', async () => {
    await buildDemo();
    await setBody(1, '{ _id: ');
    await click(inStage(1, 'agg-stage-enabled'));
    await click(get('agg-run'));
    expect(q('agg-run-error')).toBeNull();
    expect(operators(runs().at(-1)?.['pipeline'])).toEqual(['$match', '$sort', '$limit']);
    await click(get('agg-export'));
    expect(get('agg-code').textContent).not.toContain('$group');
    // The disabled stage still shows its error.
    expect(inStage(1, 'agg-stage-error')).not.toBeNull();
  });

  it('changing the operator replaces an untouched argument but keeps an edited one', async () => {
    await setOperator(0, '$group');
    expect(view.stages()[0]?.body).toBe('{ _id: "$field", count: { $sum: 1 } }');
    await setOperator(0, '$limit');
    expect(view.stages()[0]?.body).toBe('10');
    await setBody(0, '25');
    await setOperator(0, '$skip');
    expect(view.stages()[0]?.body).toBe('25');
  });

  it('an operator outside the templates is shown in the picker', async () => {
    await click(get('agg-mode-text'));
    const area = get<HTMLTextAreaElement>('agg-text');
    area.value = '[{ $densify: { field: "t", range: { step: 1, bounds: "full" } } }]';
    area.dispatchEvent(new Event('input'));
    await click(get('agg-mode-stages'));
    expect(inStage<HTMLSelectElement>(0, 'agg-stage-operator').value).toBe('$densify');
  });

  it('an empty stage list runs every document and exports an empty pipeline', async () => {
    await click(inStage(0, 'agg-stage-remove'));
    expect(el().textContent).toContain('No stages: the pipeline returns every document.');
    await click(get('agg-run'));
    expect(operators(runs().at(-1)?.['pipeline'])).toEqual(['$limit']);
    expect(all('agg-result-doc')).toHaveLength(3);
    await click(get('agg-export'));
    expect(get('agg-code').textContent).toContain('.aggregate(');
    await click(get('agg-mode-text'));
    expect(get<HTMLTextAreaElement>('agg-text').value).toBe('[]');
  });

  it('full-text mode refuses a value that is not an array of one-operator stages', async () => {
    await click(get('agg-mode-text'));
    const area = get<HTMLTextAreaElement>('agg-text');
    area.value = '{ $match: {} }';
    area.dispatchEvent(new Event('input'));
    await click(get('agg-mode-stages'));
    expect(get('agg-text-error').textContent).toContain('must be an array');
    // Typing clears the error.
    area.value = '[{ $match: {}, $limit: 1 }]';
    area.dispatchEvent(new Event('input'));
    await settle();
    expect(q('agg-text-error')).toBeNull();
    await click(get('agg-mode-stages'));
    expect(get('agg-text-error').textContent).toContain('Stage 1 must be a document');
    expect(view.mode()).toBe('text');
  });

  it('Run in full-text mode runs the edited text', async () => {
    await click(get('agg-mode-text'));
    const area = get<HTMLTextAreaElement>('agg-text');
    area.value = '[{ $match: {} }, { $sort: { a: 1 } }]';
    area.dispatchEvent(new Event('input'));
    await click(get('agg-run'));
    expect(operators(runs().at(-1)?.['pipeline'])).toEqual(['$match', '$sort', '$limit']);
    expect(view.mode()).toBe('text');
  });

  it('a failed run shows the error and Run works again', async () => {
    fake.handle('agg.run', () => {
      setTimeout(() => fake.failStream('s-bad', { code: 'SERVER_ERROR', message: 'bad $group' }));
      return { streamId: 's-bad' };
    });
    await click(get('agg-run'));
    expect(get('agg-run-error').textContent).toContain('bad $group');
    expect(q('agg-cancel')).toBeNull();
    expect(q('agg-results')).toBeNull();

    fake.handle('agg.run', () => {
      setTimeout(() => {
        fake.data('agg.run', 's-ok', { docs: docs(1, 1) });
        fake.end('s-ok', { delivered: 1 });
      });
      return { streamId: 's-ok' };
    });
    await click(get('agg-run'));
    expect(q('agg-run-error')).toBeNull();
    expect(all('agg-result-doc')).toHaveLength(1);
  });

  it('Cancel stops a running aggregation', async () => {
    fake.handle('agg.run', () => ({ streamId: 's-slow' }));
    await click(get('agg-run'));
    expect(q('agg-run')).toBeNull();
    await click(get('agg-cancel'));
    expect(fake.cancels).toContain('s-slow');
    expect(q('agg-run')).not.toBeNull();
    // A late answer of the cancelled stream shows nothing.
    fake.data('agg.run', 's-slow', { docs: docs(1, 2) });
    fake.end('s-slow', { delivered: 2 });
    await settle();
    expect(q('agg-results')).toBeNull();
  });

  it('closing the tab cancels a running aggregation', async () => {
    fake.handle('agg.run', () => ({ streamId: 's-slow' }));
    await click(get('agg-run'));
    fixture.destroy();
    expect(fake.cancels).toContain('s-slow');
  });

  it('a document that cannot be read is shown as a note, the others as usual', async () => {
    fake.respond('agg.previewStage', { docs: ['{"_id":', ...docs(1, 1)] });
    await setBody(0, '{ a: 1 }');
    const shown = all('agg-preview-doc').map((d) => d.textContent ?? '');
    expect(shown).toHaveLength(2);
    expect(shown[0]).toBe('// unreadable document');
    expect(shown[1]).toContain('_id: 1');
  });

  it('a later page that came back empty says there are no more documents', async () => {
    total = RESULT_PAGE_SIZE + 1;
    await click(get('agg-run'));
    // The data shrank between the pages.
    total = RESULT_PAGE_SIZE;
    await click(get('agg-next'));
    expect(get('agg-result-rows').textContent).toContain('No more documents');
    expect(get<HTMLButtonElement>('agg-prev').disabled).toBe(false);
  });

  it('an empty result says so', async () => {
    total = 0;
    await click(get('agg-run'));
    expect(get('agg-result-rows').textContent).toContain('No documents');
    expect(get<HTMLButtonElement>('agg-next').disabled).toBe(true);
  });

  it('a page of exactly the page size has no next page', async () => {
    total = RESULT_PAGE_SIZE;
    await click(get('agg-run'));
    expect(all('agg-result-doc')).toHaveLength(RESULT_PAGE_SIZE);
    expect(get<HTMLButtonElement>('agg-next').disabled).toBe(true);
    expect(runs()[0]).toMatchObject({ batchSize: RESULT_PAGE_SIZE + 1 });
  });

  it('a $merge pipeline asks first too; cancelling sends nothing and shows no error', async () => {
    const confirms = TestBed.inject(ConfirmService);
    let asked = 0;
    confirms.confirm = () => {
      asked++;
      return Promise.resolve(false);
    };
    await click(get('agg-add-stage'));
    await setOperator(1, '$merge');
    expect(inStage(1, 'agg-stage-preview').textContent).toContain('Merges the result');
    await click(get('agg-run'));
    expect(asked).toBe(1);
    expect(runs()).toHaveLength(0);
    expect(q('agg-run-error')).toBeNull();
  });

  describe('read-only profile', () => {
    beforeEach(async () => {
      TestBed.inject(ProfileSafetyService).set({
        id: 'p1',
        name: 'Reporting',
        readOnly: true,
        production: false,
      });
      await settle();
    });

    it('disables Create view and its submit button', async () => {
      const button = get<HTMLButtonElement>('agg-create-view');
      expect(button.disabled).toBe(true);
      expect(button.hasAttribute('data-readonly')).toBe(true);
      expect(button.title).toBe(READ_ONLY_HINT);
      // Opened through the component (e.g. before the flag changed): submit is disabled too.
      view['viewOpen'].set(true);
      await settle();
      expect(get<HTMLButtonElement>('agg-view-submit').disabled).toBe(true);
    });

    it('still runs and previews a pipeline that only reads', async () => {
      await setBody(0, '{ status: "open" }');
      expect(operators(previews().at(-1)?.['pipeline'])).toEqual(['$match']);
      await click(get('agg-run'));
      expect(runs()).toHaveLength(1);
      expect(all('agg-result-doc')).toHaveLength(3);
    });

    it('refuses a $out run without asking and without sending it', async () => {
      const confirms = TestBed.inject(ConfirmService);
      let asked = 0;
      confirms.confirm = () => {
        asked++;
        return Promise.resolve(true);
      };
      await click(get('agg-add-stage'));
      await setOperator(1, '$out');
      await click(get('agg-run'));
      expect(asked).toBe(0);
      expect(runs()).toHaveLength(0);
      expect(get('agg-run-error').textContent).toContain('read-only');
    });

    it('refuses to create a view even when the form is submitted', async () => {
      view['viewOpen'].set(true);
      view['viewName'].set('v1');
      await settle();
      await view['createView']();
      await settle();
      expect(fake.requestsFor('agg.createView')).toHaveLength(0);
      expect(get('agg-view-message').textContent).toContain('read-only');
    });
  });

  describe('create view', () => {
    const openForm = async (name: string) => {
      await click(get('agg-create-view'));
      const input = get<HTMLInputElement>('agg-view-name');
      input.value = name;
      input.dispatchEvent(new Event('input'));
      await settle();
    };

    it('refuses a pipeline with $out or $merge', async () => {
      await click(get('agg-add-stage'));
      await setOperator(1, '$out');
      await openForm('v1');
      await click(get('agg-view-submit'));
      expect(get('agg-view-message').textContent).toContain('cannot contain $out or $merge');
      expect(fake.requestsFor('agg.createView')).toHaveLength(0);
    });

    it('refuses a pipeline with an error', async () => {
      await setBody(0, '{ a: ');
      await openForm('v1');
      await click(get('agg-view-submit'));
      expect(get('agg-view-message').textContent).toContain('Fix stage 1 first');
      expect(fake.requestsFor('agg.createView')).toHaveLength(0);
    });

    it('a blank name is refused and the name is trimmed', async () => {
      await openForm('   ');
      await click(get('agg-view-submit'));
      expect(get('agg-view-message').textContent).toContain('Type a name');
      expect(fake.requestsFor('agg.createView')).toHaveLength(0);
      const input = get<HTMLInputElement>('agg-view-name');
      input.value = '  v1  ';
      input.dispatchEvent(new Event('input'));
      await click(get('agg-view-submit'));
      expect(fake.requestsFor('agg.createView')[0]?.params).toMatchObject({ view: 'v1' });
    });

    it('shows the server error of a failed create', async () => {
      fake.fail('agg.createView', { code: 'SERVER_ERROR', message: 'view already exists' });
      await openForm('v1');
      await click(get('agg-view-submit'));
      expect(get('agg-view-message').textContent).toContain('view already exists');
      expect(get('agg-view-message').classList).toContain('error');
    });

    it('asks first on a production profile; cancelling sends nothing and shows nothing', async () => {
      TestBed.inject(ProfileSafetyService).set({
        id: 'p1',
        name: 'Live',
        readOnly: false,
        production: true,
      });
      const confirms = TestBed.inject(ConfirmService);
      let asked = 0;
      confirms.confirm = () => {
        asked++;
        return Promise.resolve(false);
      };
      await openForm('v1');
      await click(get('agg-view-submit'));
      expect(asked).toBe(1);
      expect(fake.requestsFor('agg.createView')).toHaveLength(0);
      expect(q('agg-view-message')).toBeNull();
    });
  });

  describe('export', () => {
    it('falls back to the default URI when the profile cannot be read', async () => {
      fake.fail('profiles.get', { code: 'NOT_FOUND', message: 'no profile' });
      await click(get('agg-export'));
      await click(get('agg-lang-node'));
      expect(get('agg-code').textContent).toContain('mongodb://localhost');
    });

    it('reads the profile URI only once', async () => {
      await click(get('agg-export'));
      await click(get('agg-export'));
      await click(get('agg-export'));
      expect(fake.requestsFor('profiles.get')).toHaveLength(1);
    });

    it('copies the code and disables Copy while the pipeline has an error', async () => {
      let copied = '';
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: (text: string) => {
            copied = text;
            return Promise.resolve();
          },
        },
      });
      await click(get('agg-export'));
      await click(get('agg-copy'));
      expect(copied).toContain('.aggregate(');
      expect(get('agg-copy').textContent).toContain('Copied');

      await setBody(0, '{');
      expect(get<HTMLButtonElement>('agg-copy').disabled).toBe(true);
    });

    it('a refused clipboard does not claim the code was copied', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error('denied')) },
      });
      await click(get('agg-export'));
      await click(get('agg-copy'));
      expect(get('agg-copy').textContent).toContain('Copy');
      expect(get('agg-copy').textContent).not.toContain('Copied');
    });
  });

  describe('full-text mode with Export and Create view', () => {
    const typeText = async (text: string) => {
      const area = get<HTMLTextAreaElement>('agg-text');
      area.value = text;
      area.dispatchEvent(new Event('input'));
      await settle();
    };

    it('Export follows the text as typed, without disabled stages, and shows its parse error', async () => {
      await click(get('agg-mode-text'));
      await click(get('agg-export'));
      await typeText(
        '[\n  { $match: { a: 1 } },\n  //- { $limit: 5 },\n  { $sort: { b: -1 } },\n]',
      );
      const code = get('agg-code').textContent ?? '';
      expect(code).toMatch(/\$match[\s\S]*\$sort/);
      expect(code).not.toContain('$limit');
      // The text is not applied to the stage list by Export.
      expect(view.mode()).toBe('text');
      expect(view.stages().map((s) => s.operator)).toEqual(['$match']);

      await typeText('[{ $match: { a: 1 } }, { $sort: }]');
      expect(q('agg-code')).toBeNull();
      expect(get('agg-code-error').textContent).toMatch(/line 1/);
      expect(get<HTMLButtonElement>('agg-copy').disabled).toBe(true);

      await typeText('{ $match: {} }');
      expect(get('agg-code-error').textContent).toContain('must be an array');
    });

    it('Create view applies the text first and refuses text that does not parse', async () => {
      await click(get('agg-mode-text'));
      await typeText('[{ $match: { a: 1 } }, { $sort: { b: 1 } }]');
      await click(get('agg-create-view'));
      const name = get<HTMLInputElement>('agg-view-name');
      name.value = 'v1';
      name.dispatchEvent(new Event('input'));
      await click(get('agg-view-submit'));
      const sent = fake.requestsFor('agg.createView')[0]?.params as Record<string, unknown>;
      expect(operators(sent['pipeline'])).toEqual(['$match', '$sort']);
      expect(view.stages().map((s) => s.operator)).toEqual(['$match', '$sort']);

      await typeText('[{ $match: { a: 1 } }, { $limit: }]');
      await click(get('agg-view-submit'));
      expect(fake.requestsFor('agg.createView')).toHaveLength(1);
      expect(get('agg-text-error').textContent).toMatch(/line 1/);
      expect(get('agg-view-message').textContent).toContain('Fix the pipeline text first');
      expect(get('agg-view-message').classList).toContain('error');
      // The stage list keeps the last applied text.
      expect(view.stages().map((s) => s.operator)).toEqual(['$match', '$sort']);
    });
  });

  describe('retrying a failed preview', () => {
    it('the Retry button asks for the preview again', async () => {
      fake.fail('agg.previewStage', { code: 'NOT_CONNECTED', message: 'gone' });
      await setBody(0, '{ a: 1 }');
      expect(inStage(0, 'agg-preview-error').textContent).toContain('gone');
      const before = previews().length;

      fake.respond('agg.previewStage', { docs: docs(1, 2) });
      await click(inStage(0, 'agg-preview-retry'));
      expect(previews()).toHaveLength(before + 1);
      expect(operators(previews().at(-1)?.['pipeline'])).toEqual(['$match']);
      expect(stageEl(0).querySelector('[data-testid="agg-preview-error"]')).toBeNull();
      expect(inStage(0, 'agg-stage-preview').querySelectorAll('pre')).toHaveLength(2);
    });

    it('the next edit anywhere asks for a failed preview again', async () => {
      fake.fail('agg.previewStage', { code: 'NOT_CONNECTED', message: 'gone' });
      await setBody(0, '{ a: 1 }');
      expect(inStage(0, 'agg-preview-error')).not.toBeNull();

      fake.respond('agg.previewStage', { docs: docs(1, 1) });
      const before = previews().length;
      await click(get('agg-add-stage'));
      // Stage 1's pipeline did not change, but its failed preview is asked again.
      expect(
        previews()
          .slice(before)
          .map((p) => operators(p['pipeline'])),
      ).toEqual([['$match'], ['$match', '$match']]);
      expect(inStage(0, 'agg-stage-preview').querySelectorAll('pre')).toHaveLength(1);
    });

    it('a successful preview is still not asked again by an unrelated edit', async () => {
      const before = previews().length;
      await click(get('agg-add-stage'));
      expect(
        previews()
          .slice(before)
          .map((p) => operators(p['pipeline'])),
      ).toEqual([['$match', '$match']]);
    });
  });

  describe('paging the shown result', () => {
    it('Prev/Next page the pipeline that produced the result; Run starts the edited one at page 0', async () => {
      total = RESULT_PAGE_SIZE * 2 + 5;
      await click(get('agg-run'));
      const first = runs().at(-1)?.['pipeline'];
      expect(first).toBe('[{"$match":{}},{"$limit":{"$numberInt":"21"}}]');

      // Edited after the run: Next still pages the pipeline that is shown.
      await setBody(0, '{ a: 1 }');
      await click(get('agg-next'));
      expect(runs().at(-1)?.['pipeline']).toBe(
        '[{"$match":{}},{"$skip":{"$numberInt":"20"}},{"$limit":{"$numberInt":"21"}}]',
      );
      expect(get('agg-result-rows').textContent).toContain(
        `${RESULT_PAGE_SIZE + 1}–${RESULT_PAGE_SIZE * 2}`,
      );
      await click(get('agg-prev'));
      expect(runs().at(-1)?.['pipeline']).toBe(first);

      // A new Run runs the edited pipeline from the first page.
      await click(get('agg-next'));
      await click(get('agg-run'));
      expect(runs().at(-1)?.['pipeline']).toBe(
        '[{"$match":{"a":{"$numberInt":"1"}}},{"$limit":{"$numberInt":"21"}}]',
      );
      expect(get('agg-result-rows').textContent).toContain(`1–${RESULT_PAGE_SIZE}`);
      expect(get<HTMLButtonElement>('agg-prev').disabled).toBe(true);
    });

    it('a failed run clears the earlier result', async () => {
      await click(get('agg-run'));
      expect(all('agg-result-doc')).toHaveLength(3);
      fake.handle('agg.run', () => {
        setTimeout(() => fake.failStream('s-bad', { code: 'SERVER_ERROR', message: 'bad' }));
        return { streamId: 's-bad' };
      });
      await click(get('agg-run'));
      expect(get('agg-run-error').textContent).toContain('bad');
      expect(q('agg-results')).toBeNull();
    });

    it('a Run refused for a stage error clears the earlier result', async () => {
      await click(get('agg-run'));
      expect(q('agg-results')).not.toBeNull();
      await setBody(0, '{ a: ');
      await click(get('agg-run'));
      expect(get('agg-run-error').textContent).toContain('Fix stage 1 first');
      expect(q('agg-results')).toBeNull();
    });

    it('Next pages the collection that produced the result after the tab is pointed elsewhere', async () => {
      total = RESULT_PAGE_SIZE * 2;
      await click(get('agg-run'));
      expect(runs().at(-1)).toMatchObject({ coll: 'orders' });
      fixture.componentRef.setInput('tab', {
        ...TAB,
        data: { profileId: 'p1', db: 'shop', coll: 'invoices', type: 'collection' },
      });
      await settle();

      await click(get('agg-next'));
      expect(runs().at(-1)).toMatchObject({ profileId: 'p1', db: 'shop', coll: 'orders' });
      expect(runs().at(-1)?.['pipeline']).toContain('"$skip":{"$numberInt":"20"}');

      // A new Run uses the new collection from the first page.
      await click(get('agg-run'));
      expect(runs().at(-1)).toMatchObject({ coll: 'invoices' });
      expect(runs().at(-1)?.['pipeline']).not.toContain('$skip');
    });

    it('a page turn whose stream fails shows the error and clears the result', async () => {
      total = RESULT_PAGE_SIZE * 2;
      await click(get('agg-run'));
      fake.handle('agg.run', () => {
        setTimeout(() => fake.failStream('s-page', { code: 'SERVER_ERROR', message: 'page gone' }));
        return { streamId: 's-page' };
      });
      await click(get('agg-next'));
      expect(get('agg-run-error').textContent).toContain('page gone');
      expect(q('agg-results')).toBeNull();
      expect(q('agg-next')).toBeNull();
    });

    it('a $out Run refused on a read-only profile clears the earlier result', async () => {
      await click(get('agg-run'));
      expect(all('agg-result-doc')).toHaveLength(3);
      TestBed.inject(ProfileSafetyService).set({
        id: 'p1',
        name: 'Reporting',
        readOnly: true,
        production: false,
      });
      await click(get('agg-add-stage'));
      await setOperator(1, '$out');
      await click(get('agg-run'));
      expect(runs()).toHaveLength(1);
      expect(get('agg-run-error').textContent).toContain('read-only');
      expect(q('agg-results')).toBeNull();
    });

    it('cancelling the $out confirmation keeps the earlier result and shows no error', async () => {
      await click(get('agg-run'));
      const confirms = TestBed.inject(ConfirmService);
      confirms.confirm = () => Promise.resolve(false);
      await click(get('agg-add-stage'));
      await setOperator(1, '$out');
      await click(get('agg-run'));
      expect(runs()).toHaveLength(1);
      expect(q('agg-run-error')).toBeNull();
      expect(all('agg-result-doc')).toHaveLength(3);
    });
  });

  describe('retrying a failed preview, more cases', () => {
    it('the Retry button names its stage, and a Retry that fails again can be retried', async () => {
      fake.fail('agg.previewStage', { code: 'NOT_CONNECTED', message: 'gone' });
      await click(get('agg-add-stage'));
      await setBody(1, '{ b: 2 }');
      const retry = inStage(1, 'agg-preview-retry');
      expect(retry.getAttribute('aria-label')).toBe('Retry the preview of stage 2');
      expect(retry.getAttribute('type')).toBe('button');

      const before = previews().length;
      await click(retry);
      expect(previews()).toHaveLength(before + 1);
      expect(operators(previews().at(-1)?.['pipeline'])).toEqual(['$match', '$match']);
      // Still failing: the error and its Retry button stay, and Retry asks again.
      expect(inStage(1, 'agg-preview-error').textContent).toContain('gone');
      fake.respond('agg.previewStage', { docs: docs(1, 4) });
      await click(inStage(1, 'agg-preview-retry'));
      expect(previews()).toHaveLength(before + 2);
      expect(inStage(1, 'agg-stage-preview').querySelectorAll('pre')).toHaveLength(4);
      expect(stageEl(1).querySelector('[data-testid="agg-preview-retry"]')).toBeNull();
    });

    it('Retry asks only for its own stage', async () => {
      await click(get('agg-add-stage'));
      fake.fail('agg.previewStage', { code: 'NOT_CONNECTED', message: 'gone' });
      await setBody(1, '{ b: 2 }');
      fake.respond('agg.previewStage', { docs: docs(1, 1) });
      const before = previews().length;
      await click(inStage(1, 'agg-preview-retry'));
      expect(
        previews()
          .slice(before)
          .map((p) => operators(p['pipeline'])),
      ).toEqual([['$match', '$match']]);
      // The first stage's preview was fine and is not touched.
      expect(inStage(0, 'agg-stage-preview').querySelectorAll('pre')).toHaveLength(1);
    });
  });

  it('Copy in full-text mode copies the code of the text as typed', async () => {
    let copied = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          copied = text;
          return Promise.resolve();
        },
      },
    });
    await click(get('agg-mode-text'));
    const area = get<HTMLTextAreaElement>('agg-text');
    area.value = '[{ $match: { a: 1 } }, { $project: { b: 1 } }]';
    area.dispatchEvent(new Event('input'));
    await click(get('agg-export'));
    await click(get('agg-copy'));
    expect(copied).toMatch(/\$match[\s\S]*\$project/);
    // An empty pipeline text exports too.
    area.value = '[]';
    area.dispatchEvent(new Event('input'));
    await settle();
    expect(get('agg-code').textContent).toContain('.aggregate(');
    expect(get('agg-code').textContent).not.toContain('$match');
  });

  it('announces only the preview count, and does not re-announce stage errors while typing', async () => {
    const preview = inStage(0, 'agg-stage-preview');
    expect(preview.hasAttribute('aria-live')).toBe(false);
    expect(inStage(0, 'agg-preview-count').getAttribute('aria-live')).toBe('polite');
    expect(preview.querySelector('[aria-live]')).toBe(inStage(0, 'agg-preview-count'));

    await setBody(0, '{ a: ');
    const error = inStage(0, 'agg-stage-error');
    expect(error.hasAttribute('role')).toBe(false);
    expect(error.hasAttribute('aria-live')).toBe(false);
    expect(inStage(0, 'agg-stage-body').getAttribute('aria-describedby')).toBe(error.id);
  });
});
