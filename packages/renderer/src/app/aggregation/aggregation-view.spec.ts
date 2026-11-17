import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import type { WorkspaceTab } from '../layout/workspace.service';
import { ConfirmService } from '../safety/confirm.service';
import { ProfileSafetyService } from '../safety/profile-safety.service';
import { AggregationView, RESULT_PAGE_SIZE } from './aggregation-view';

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
});
