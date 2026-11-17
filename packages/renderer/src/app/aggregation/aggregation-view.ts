import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import {
  type BsonDocument,
  type BsonValue,
  int32,
  parseEJsonDocument,
  stringifyEJson,
} from '@thicket/core/bson';
import { CODEGEN_LANGUAGES, type CodegenLanguage, generateCode } from '@thicket/core/codegen';
import { printShellSyntax } from '@thicket/core/shellsyntax';
import type { Subscription } from 'rxjs';

import { ApiError, describeError } from '../api/api-error';
import { ApiService } from '../api/api.service';
import { ExplainPanel, type ExplainParams } from '../explain';
import type { WorkspaceTab } from '../layout/workspace.service';
import { WriteControl } from '../safety/write-control.directive';
import { WriteGuard } from '../safety/write-guard.service';
import type { CollectionTabData } from '../sidebar/sidebar-tree.service';
import {
  operatorOf,
  parsePipeline,
  parseStage,
  printPipeline,
  type Stage,
  type StageError,
  STAGE_TEMPLATES,
  templateBody,
  WRITE_STAGES,
  writesOutput,
} from './pipeline.model';

/** Stable id of the aggregation tab of a collection. */
export function aggregationTabId(profileId: string, db: string, coll: string): string {
  return `aggregation:${profileId}:${db}.${coll}`;
}

/** What the preview of one stage shows. */
export type StagePreview =
  | { readonly state: 'loading' }
  | { readonly state: 'ok'; readonly docs: readonly string[] }
  | { readonly state: 'error'; readonly message: string };

/** Input documents sampled for a stage preview, and documents shown per preview. */
export const PREVIEW_SAMPLE = 100;
export const PREVIEW_LIMIT = 20;
/** Wait after the last keystroke before previews are read again. */
export const PREVIEW_DEBOUNCE_MS = 400;
export const RESULT_PAGE_SIZE = 20;

const LANGUAGE_LABELS: Record<CodegenLanguage, string> = {
  shell: 'Shell',
  node: 'Node',
  python: 'Python',
  java: 'Java',
};

let nextUid = 0;

/** A document of the builder shown in shell syntax (or a note when it can't be read). */
function shellText(ejson: string): string {
  try {
    return printShellSyntax(parseEJsonDocument(ejson), { indent: 2 });
  } catch {
    return '// unreadable document';
  }
}

/** What a stage's preview depends on: the collection and the pipeline up to the stage. */
function previewKey(target: { profileId: string; db: string; coll: string }, plan: string): string {
  return `${target.profileId}\u0000${target.db}\u0000${target.coll}\u0000${plan}`;
}

function stageDoc(key: string, value: BsonValue): BsonDocument {
  return { type: 'object', fields: [{ key, value }] };
}

/**
 * The aggregation builder of a collection (SPEC M3): the pipeline is set as the mongosh call
 * `db.<coll>.aggregate([ … ])`, one stage per row (operator and argument in shell syntax), each
 * with a live preview of its output on a sample. Stages can be added, removed, moved and
 * disabled; the full-text mode edits the whole array at once. Run pages through the result,
 * Export prints the pipeline as shell, Node, Python or Java code, and Create view saves it as a
 * view. `$out`/`$merge` pipelines are writes: they ask first (`WriteGuard`).
 */
@Component({
  selector: 'app-aggregation-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WriteControl, ExplainPanel],
  templateUrl: './aggregation-view.html',
  styleUrl: './aggregation-view.css',
})
export class AggregationView {
  readonly tab = input.required<WorkspaceTab>();

  private readonly api = inject(ApiService);
  private readonly guard = inject(WriteGuard);

  protected readonly templates = STAGE_TEMPLATES;
  protected readonly languages = CODEGEN_LANGUAGES;
  protected readonly languageLabels = LANGUAGE_LABELS;
  protected readonly uid = `agg-view-${++nextUid}`;

  protected readonly target = computed(
    () => {
      const data = this.tab().data as Partial<CollectionTabData> | undefined;
      return {
        profileId: data?.profileId ?? '',
        db: data?.db ?? '',
        coll: data?.coll ?? this.tab().title,
      };
    },
    {
      equal: (a, b) => a.profileId === b.profileId && a.db === b.db && a.coll === b.coll,
    },
  );

  private nextId = 1;
  readonly stages = signal<readonly Stage[]>([]);
  /** `stages` or the full-text mode. */
  readonly mode = signal<'stages' | 'text'>('stages');
  protected readonly text = signal('');
  protected readonly textError = signal<StageError | null>(null);

  /** Each stage parsed (also disabled ones, so their errors show). */
  readonly parsed = computed(() => new Map(this.stages().map((s) => [s.id, parseStage(s)])));

  /** The enabled stages, parsed; `null` when one of them has an error. */
  readonly pipeline = computed<readonly BsonDocument[] | null>(() => {
    const out: BsonDocument[] = [];
    for (const stage of this.stages()) {
      if (!stage.enabled) continue;
      const parsed = this.parsed().get(stage.id);
      if (!parsed?.ok) return null;
      out.push(parsed.stage);
    }
    return out;
  });

  /** Number (1-based) of the first enabled stage with an error. */
  protected readonly firstError = computed(() => {
    const index = this.stages().findIndex((s) => s.enabled && !this.parsed().get(s.id)?.ok);
    return index === -1 ? null : index + 1;
  });

  /**
   * What each enabled, valid stage previews: the enabled, valid stages up to it. Stages with an
   * error are left out (only their own preview is blocked); `skipped` names them.
   */
  readonly previewPlans = computed(() => {
    const plans = new Map<number, { key: string; pipeline: BsonDocument[]; skipped: number[] }>();
    const prefix: BsonDocument[] = [];
    const skipped: number[] = [];
    this.stages().forEach((stage, index) => {
      if (!stage.enabled) return;
      const parsed = this.parsed().get(stage.id);
      if (!parsed?.ok) {
        skipped.push(index + 1);
        return;
      }
      if (WRITE_STAGES.includes(operatorOf(parsed.stage))) return;
      prefix.push(parsed.stage);
      const pipeline = [...prefix];
      plans.set(stage.id, {
        key: stringifyEJson({ type: 'array', items: pipeline }),
        pipeline,
        skipped: [...skipped],
      });
    });
    return plans;
  });

  readonly previews = signal<ReadonlyMap<number, StagePreview>>(new Map());
  private readonly previewRuns = new Map<number, { key: string; abort: AbortController }>();
  private previewTimer: ReturnType<typeof setTimeout> | undefined;
  /** Debounce of the previews (tests set it to 0). */
  debounceMs = PREVIEW_DEBOUNCE_MS;

  /** Results of Run. */
  protected readonly running = signal(false);
  protected readonly result = signal<{
    page: number;
    docs: readonly string[];
    hasNext: boolean;
    wrote: boolean;
    /** The pipeline and collection that produced it: Prev/Next page through these. */
    pipeline: readonly BsonDocument[];
    target: { profileId: string; db: string; coll: string };
  } | null>(null);
  protected readonly runError = signal<string | null>(null);
  /** What the explain panel explains (the pipeline at the last Explain); `null`: closed. */
  protected readonly explainParams = signal<ExplainParams | null>(null);
  /** Why the last Explain was refused (a stage with an error); `null`: none. */
  protected readonly explainError = signal<string | null>(null);
  private runSub: Subscription | undefined;

  /** Export panel. */
  protected readonly exportOpen = signal(false);
  protected readonly language = signal<CodegenLanguage>('shell');
  private readonly uri = signal<string | undefined>(undefined);
  /**
   * The pipeline Export prints: the stage list, or in full-text mode the text as typed (it is
   * applied to the stage list only by Run, Create view or leaving the mode).
   */
  private readonly exportPipeline = computed<
    { ok: true; pipeline: readonly BsonDocument[] } | { ok: false; message: string }
  >(() => {
    if (this.mode() === 'stages') {
      const pipeline = this.pipeline();
      return pipeline === null ? { ok: false, message: this.fixFirst() } : { ok: true, pipeline };
    }
    const parsed = parsePipeline(this.text());
    if (!parsed.ok) return { ok: false, message: parsed.error.message };
    const pipeline: BsonDocument[] = [];
    for (const [index, stage] of parsed.stages.entries()) {
      if (!stage.enabled) continue;
      const one = parseStage(stage);
      if (!one.ok) return { ok: false, message: `Stage ${index + 1}: ${one.error.message}` };
      pipeline.push(one.stage);
    }
    return { ok: true, pipeline };
  });
  protected readonly code = computed(() => {
    const source = this.exportPipeline();
    if (!source.ok) return source;
    const { pipeline } = source;
    const { db, coll } = this.target();
    try {
      const uri = this.uri();
      const text = generateCode(
        { kind: 'aggregate', database: db, collection: coll, pipeline },
        this.language(),
        uri === undefined ? {} : { uri },
      );
      return { ok: true as const, text };
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : String(e) };
    }
  });
  protected readonly copied = signal(false);

  /** Create-view form. */
  protected readonly viewOpen = signal(false);
  protected readonly viewName = signal('');
  protected readonly viewMessage = signal<{ error: boolean; text: string } | null>(null);

  constructor() {
    // A new builder starts with one $match stage.
    this.stages.set([this.newStage('$match')]);
    effect(() => {
      const plans = this.previewPlans();
      const target = this.target();
      // The full-text mode shows no previews: none are read until the stage list is back.
      if (this.mode() === 'text') untracked(() => this.pausePreviews());
      else untracked(() => this.schedulePreviews(plans, target));
    });
    // A plan explains one collection: pointing the tab elsewhere closes it.
    effect(() => {
      this.target();
      untracked(() => this.closeExplain());
    });
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.previewTimer);
      for (const run of this.previewRuns.values()) run.abort.abort();
      this.runSub?.unsubscribe();
    });
  }

  private newStage(operator: string, body = templateBody(operator)): Stage {
    return { id: this.nextId++, operator, body, enabled: true };
  }

  // Stage list

  addStage(operator = '$match', after?: number): void {
    const stage = this.newStage(operator);
    this.stages.update((list) => {
      const index = after === undefined ? list.length : list.findIndex((s) => s.id === after) + 1;
      return [...list.slice(0, index), stage, ...list.slice(index)];
    });
  }

  removeStage(id: number): void {
    this.stages.update((list) => list.filter((s) => s.id !== id));
  }

  /** Moves a stage one place up (`-1`) or down (`1`). */
  moveStage(id: number, delta: -1 | 1): void {
    this.stages.update((list) => {
      const from = list.findIndex((s) => s.id === id);
      const to = from + delta;
      if (from === -1 || to < 0 || to >= list.length) return list;
      const next = [...list];
      const [stage] = next.splice(from, 1);
      if (stage) next.splice(to, 0, stage);
      return next;
    });
  }

  toggleStage(id: number): void {
    this.updateStage(id, { enabled: !this.stages().find((s) => s.id === id)?.enabled });
  }

  updateStage(id: number, change: Partial<Omit<Stage, 'id'>>): void {
    this.stages.update((list) => list.map((s) => (s.id === id ? { ...s, ...change } : s)));
  }

  protected setOperator(stage: Stage, event: Event): void {
    const operator = (event.target as HTMLSelectElement).value;
    // An untouched argument follows the operator's template.
    const body = stage.body === templateBody(stage.operator) ? templateBody(operator) : stage.body;
    this.updateStage(stage.id, { operator, body });
  }

  protected setBody(stage: Stage, event: Event): void {
    this.updateStage(stage.id, { body: (event.target as HTMLTextAreaElement).value });
  }

  protected bodyRows(stage: Stage): number {
    return Math.min(Math.max(stage.body.split('\n').length, 2), 16);
  }

  // Full-text mode

  /** Switches between the stage list and the full text; refuses to leave text that doesn't parse. */
  setMode(mode: 'stages' | 'text'): boolean {
    if (mode === this.mode()) return true;
    if (mode === 'text') {
      this.text.set(printPipeline(this.stages()));
      this.textError.set(null);
      this.mode.set('text');
      return true;
    }
    return this.applyText() && (this.mode.set('stages'), true);
  }

  protected editText(event: Event): void {
    this.text.set((event.target as HTMLTextAreaElement).value);
    this.textError.set(null);
  }

  /** Parses the full text into the stage list. */
  applyText(): boolean {
    const parsed = parsePipeline(this.text());
    if (!parsed.ok) {
      this.textError.set(parsed.error);
      return false;
    }
    this.textError.set(null);
    // A stage keeps the id of the stage at its place, so a stage whose pipeline prefix did not
    // change keeps its preview (it is not read again).
    const ids = this.stages().map((s) => s.id);
    this.stages.set(parsed.stages.map((s, index) => ({ ...s, id: ids[index] ?? this.nextId++ })));
    return true;
  }

  // Previews

  private schedulePreviews(
    plans: ReturnType<AggregationView['previewPlans']>,
    target: { profileId: string; db: string; coll: string },
  ): void {
    // Previews of stages that are gone, disabled or invalid stop and disappear at once.
    for (const [id, run] of this.previewRuns) {
      if (!plans.has(id)) {
        run.abort.abort();
        this.previewRuns.delete(id);
      }
    }
    this.previews.update((map) => new Map([...map].filter(([id]) => plans.has(id))));
    clearTimeout(this.previewTimer);
    if (target.profileId === '') return;
    this.previewTimer = setTimeout(() => {
      for (const [id, plan] of plans) {
        const key = previewKey(target, plan.key);
        if (this.previewRuns.get(id)?.key === key) continue;
        this.startPreview(id, key, plan.pipeline, target);
      }
    }, this.debounceMs);
  }

  /**
   * Stops the pending scheduling pass and the previews still loading (their results would not be
   * shown). Finished previews stay: back in the stage list, a stage whose pipeline prefix did
   * not change shows its preview without reading it again.
   */
  private pausePreviews(): void {
    clearTimeout(this.previewTimer);
    for (const [id, run] of this.previewRuns) {
      if (this.previews().get(id)?.state === 'ok') continue;
      run.abort.abort();
      this.previewRuns.delete(id);
    }
  }

  private startPreview(
    id: number,
    key: string,
    pipeline: readonly BsonDocument[],
    target: { profileId: string; db: string; coll: string },
  ): void {
    this.previewRuns.get(id)?.abort.abort();
    const abort = new AbortController();
    this.previewRuns.set(id, { key, abort });
    void this.preview(id, pipeline, target, abort.signal);
  }

  /** Asks again for the preview of a stage whose preview failed (the Retry button). */
  protected retryPreview(id: number): void {
    const plan = this.previewPlans().get(id);
    const target = this.target();
    if (plan === undefined || target.profileId === '') return;
    const key = previewKey(target, plan.key);
    this.startPreview(id, key, plan.pipeline, target);
  }

  private async preview(
    id: number,
    pipeline: readonly BsonDocument[],
    target: { profileId: string; db: string; coll: string },
    signal: AbortSignal,
  ): Promise<void> {
    this.setPreview(id, { state: 'loading' });
    try {
      const result = await this.api.request(
        'agg.previewStage',
        {
          ...target,
          pipeline: stringifyEJson({ type: 'array', items: pipeline }),
          sampleSize: PREVIEW_SAMPLE,
          limit: PREVIEW_LIMIT,
        },
        { signal },
      );
      if (signal.aborted) return;
      this.setPreview(id, { state: 'ok', docs: result.docs.map(shellText) });
    } catch (e) {
      if (signal.aborted) return;
      // Forget the failed run, so the next scheduling pass (any edit) asks again.
      if (this.previewRuns.get(id)?.abort.signal === signal) this.previewRuns.delete(id);
      this.setPreview(id, { state: 'error', message: describeError(e) });
    }
  }

  private setPreview(id: number, preview: StagePreview): void {
    this.previews.update((map) => new Map(map).set(id, preview));
  }

  /** The count line of a preview that read `docs`. */
  protected countText(docs: readonly string[]): string {
    if (docs.length === 0) return 'No documents';
    return docs.length + (docs.length === 1 ? ' document' : ' documents');
  }

  /**
   * What the persistent live region of stage `position` (1-based) announces: the count or the
   * preview error, named by its stage ("Stage 2: 5 documents from a sample"), since one edit
   * reloads the previews of all later stages at once. Empty while loading (only results are
   * announced) and for stages without a preview. The documents are never announced.
   */
  protected previewStatus(id: number, position: number): string {
    if (!this.previewPlans().has(id)) return '';
    const preview = this.previews().get(id);
    if (preview?.state === 'ok') {
      return `Stage ${position}: ${this.countText(preview.docs)} from a sample`;
    }
    if (preview?.state === 'error') return `Stage ${position}: preview failed: ${preview.message}`;
    return '';
  }

  protected skippedText(id: number): string | null {
    const skipped = this.previewPlans().get(id)?.skipped ?? [];
    if (skipped.length === 0) return null;
    const list = skipped.join(', ');
    return skipped.length === 1
      ? `Without stage ${list}: it has an error.`
      : `Without stages ${list}: they have errors.`;
  }

  // Run

  private fixFirst(): string {
    return `Fix stage ${this.firstError() ?? ''} first: it has an error.`.replace('  ', ' ');
  }

  /** Runs the pipeline as it is now and shows the first page of its result. */
  async run(): Promise<void> {
    if (this.mode() === 'text' && !this.applyText()) {
      // The text error is shown already; only drop the result of an earlier, different pipeline.
      this.runError.set(null);
      this.result.set(null);
      return;
    }
    const pipeline = this.pipeline();
    if (pipeline === null) {
      this.failRun(this.fixFirst());
      return;
    }
    await this.runPage(pipeline, this.target(), 0);
  }

  /**
   * Explains the pipeline as it is now in the explain panel: with execution stats, except for a
   * pipeline with `$out`/`$merge`, which is only planned (running it would write).
   */
  explain(): void {
    // A refused Explain closes an earlier plan (it would pass for the edited pipeline's) and
    // leaves the shown run result alone.
    if (this.mode() === 'text' && !this.applyText()) {
      this.closeExplain();
      return;
    }
    const pipeline = this.pipeline();
    if (pipeline === null) {
      this.closeExplain();
      this.explainError.set(this.fixFirst());
      return;
    }
    this.explainError.set(null);
    this.explainParams.set({
      ...this.target(),
      target: { kind: 'aggregate', pipeline: stringifyEJson({ type: 'array', items: pipeline }) },
      verbosity: writesOutput(pipeline) ? 'queryPlanner' : 'executionStats',
    });
  }

  /** Closes the explain panel and its refusal message. */
  protected closeExplain(): void {
    this.explainParams.set(null);
    this.explainError.set(null);
  }

  /** Shows another page of the shown result: same pipeline and collection, even after edits. */
  protected async turnPage(delta: -1 | 1): Promise<void> {
    const shown = this.result();
    if (shown === null) return;
    await this.runPage(shown.pipeline, shown.target, shown.page + delta);
  }

  /** A failed run shows its error instead of the earlier, unrelated result. */
  private failRun(message: string): void {
    this.runError.set(message);
    this.result.set(null);
  }

  /** Runs `pipeline` on `target` and shows page `page` (0-based) of its result. */
  private async runPage(
    pipeline: readonly BsonDocument[],
    target: { profileId: string; db: string; coll: string },
    page: number,
  ): Promise<void> {
    this.cancelRun();
    this.runError.set(null);
    const wrote = writesOutput(pipeline);
    const paged = wrote
      ? pipeline
      : [
          ...pipeline,
          ...(page > 0 ? [stageDoc('$skip', int32(page * RESULT_PAGE_SIZE))] : []),
          stageDoc('$limit', int32(RESULT_PAGE_SIZE + 1)),
        ];
    const base = {
      ...target,
      pipeline: stringifyEJson({ type: 'array', items: paged }),
      batchSize: RESULT_PAGE_SIZE + 1,
    };
    let params;
    try {
      params = wrote
        ? await this.guard.approve('agg.run', base, {
            alwaysConfirm: true,
            title: 'Run aggregation with $out/$merge',
            confirmLabel: 'Run',
            detail: 'This pipeline writes its output to a collection.',
          })
        : base;
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'CANCELLED')) this.failRun(describeError(e));
      return;
    }
    this.running.set(true);
    const docs: string[] = [];
    this.runSub = this.api.stream('agg.run', params).subscribe({
      next: (batch) => docs.push(...batch.docs),
      error: (e: unknown) => {
        this.running.set(false);
        this.failRun(describeError(e));
      },
      complete: () => {
        this.running.set(false);
        this.result.set({
          page,
          docs: docs.slice(0, RESULT_PAGE_SIZE).map(shellText),
          hasNext: docs.length > RESULT_PAGE_SIZE,
          wrote,
          pipeline,
          target,
        });
      },
    });
  }

  cancelRun(): void {
    this.runSub?.unsubscribe();
    this.runSub = undefined;
    this.running.set(false);
  }

  protected resultRange(): string {
    const result = this.result();
    if (result === null) return '';
    if (result.docs.length === 0) return result.page === 0 ? 'No documents' : 'No more documents';
    const from = result.page * RESULT_PAGE_SIZE + 1;
    return `${from}–${from + result.docs.length - 1}`;
  }

  // Export

  protected toggleExport(): void {
    this.exportOpen.update((open) => !open);
    if (this.exportOpen() && this.uri() === undefined) void this.loadUri();
  }

  /** The profile's connection string (it never holds a password) for the driver programs. */
  private async loadUri(): Promise<void> {
    try {
      const { profile } = await this.api.request('profiles.get', {
        profileId: this.target().profileId,
      });
      this.uri.set(profile.connectionString);
    } catch {
      // Keep the default (localhost) URI.
    }
  }

  protected async copyCode(): Promise<void> {
    const code = this.code();
    if (!code.ok) return;
    try {
      await navigator.clipboard.writeText(code.text);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    } catch {
      this.copied.set(false);
    }
  }

  // Create view

  protected toggleView(): void {
    this.viewOpen.update((open) => !open);
    this.viewMessage.set(null);
  }

  protected async createView(event?: Event): Promise<void> {
    event?.preventDefault();
    const name = this.viewName().trim();
    if (name === '') {
      this.viewMessage.set({ error: true, text: 'Type a name for the view.' });
      return;
    }
    // In full-text mode the view gets the text as typed, like Run (the text error shows there).
    if (this.mode() === 'text' && !this.applyText()) {
      this.viewMessage.set({ error: true, text: 'Fix the pipeline text first: it has an error.' });
      return;
    }
    const pipeline = this.pipeline();
    if (pipeline === null) {
      this.viewMessage.set({ error: true, text: this.fixFirst() });
      return;
    }
    if (writesOutput(pipeline)) {
      this.viewMessage.set({ error: true, text: 'A view cannot contain $out or $merge.' });
      return;
    }
    const { profileId, db, coll } = this.target();
    try {
      await this.guard.run('agg.createView', {
        profileId,
        db,
        view: name,
        viewOn: coll,
        pipeline: stringifyEJson({ type: 'array', items: pipeline }),
      });
      this.viewMessage.set({ error: false, text: `Created view ${db}.${name}.` });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CANCELLED') return;
      this.viewMessage.set({ error: true, text: describeError(e) });
    }
  }

  protected inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}
