import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

import { ExplainRaw } from './explain-raw';
import { type ExplainSummary, type PlanNode, summarizeExplain } from './explain.model';

const numberFormat = new Intl.NumberFormat();

/** Stages that read the whole collection or an index: the verdict's subject. */
const SCAN_STAGES = new Set(['COLLSCAN', 'IXSCAN', 'COUNT_SCAN', 'DISTINCT_SCAN', 'IDHACK']);

/**
 * One explain output: the verdict (index used or a collection scan), the totals, the tree of plan
 * stages (output at the top, scans at the bottom) and, on demand, the raw output in the document
 * viewer. Each stage has a flow bar: how many documents or keys it examined (faint) and returned
 * (solid), relative to the busiest stage, so the stage that discards most stands out.
 */
@Component({
  selector: 'app-explain-plan',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, ExplainRaw],
  templateUrl: './explain-plan.html',
  styleUrl: './explain-plan.css',
})
export class ExplainPlan {
  /** The explain output as canonical EJSON text (`agg.explain`'s `explain`). */
  readonly explain = input.required<string>();

  protected readonly view = signal<'plan' | 'raw'>('plan');

  protected readonly parsed = computed<
    { ok: true; summary: ExplainSummary } | { ok: false; message: string }
  >(() => {
    try {
      return { ok: true, summary: summarizeExplain(this.explain()) };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });

  /** The largest count of any stage: the full width of the flow bars. */
  protected readonly maxFlow = computed(() => {
    const parsed = this.parsed();
    if (!parsed.ok) return 0;
    let max = 0;
    const visit = (node: PlanNode): void => {
      max = Math.max(max, node.nReturned ?? 0, node.docsExamined ?? 0, node.keysExamined ?? 0);
      node.children.forEach(visit);
    };
    visit(parsed.summary.root);
    return max;
  });

  protected format(n: number | undefined): string {
    return n === undefined ? '–' : numberFormat.format(n);
  }

  /** Width (percent) of a flow bar. */
  protected share(n: number | undefined): number {
    const max = this.maxFlow();
    if (n === undefined || max === 0) return 0;
    return Math.max(n > 0 ? 1 : 0, (n / max) * 100);
  }

  /** What the stage examined: keys for index scans, documents otherwise. */
  protected examined(node: PlanNode): number | undefined {
    return node.keysExamined !== undefined && node.keysExamined > 0
      ? node.keysExamined
      : (node.docsExamined ?? node.keysExamined);
  }

  protected isScan(node: PlanNode): boolean {
    return SCAN_STAGES.has(node.stage) || node.indexName !== undefined;
  }
}
