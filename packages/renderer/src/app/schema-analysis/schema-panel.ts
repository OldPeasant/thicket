import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import type { ParamsOf } from '@thicket/contract';
import type { BsonValue } from '@thicket/core/bson';

import { ApiError, describeError } from '../api/api-error';
import { ApiService } from '../api/api.service';
import { percent, schemaRows, typeCondition, type SchemaRow } from './schema-analysis.model';

export type SchemaParams = ParamsOf<'schema.analyze'>;

/** A filter condition picked in the analysis: `{ [key]: condition }`. */
export interface SchemaFilterPick {
  readonly key: string;
  readonly condition: BsonValue;
}

type State =
  | { readonly state: 'idle' }
  | { readonly state: 'loading' }
  | { readonly state: 'ok'; readonly sampled: number; readonly rows: readonly SchemaRow[] }
  | { readonly state: 'error'; readonly message: string };

const numberFormat = new Intl.NumberFormat();

/**
 * The schema analysis panel of the collection tab: asks `schema.analyze` for `params` whenever
 * they change and shows one row per field path: how often it is present, a bar of its type
 * shares (the missing rest hatched) and example values. Clicking an example or a type emits a
 * filter condition for the query bar. A newer request cancels the running one; so does closing.
 */
@Component({
  selector: 'app-schema-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel" data-testid="schema-panel" aria-label="Schema analysis">
      <header>
        <h2>Schema</h2>
        @let s = state();
        <span class="meta" data-testid="schema-sampled">
          @if (s.state === 'ok') {
            {{ sampledText() }}
          }
        </span>
        <button type="button" class="btn quiet" data-testid="schema-again" (click)="again()">
          Analyze again
        </button>
        <button type="button" class="btn quiet" data-testid="schema-close" (click)="closed.emit()">
          Close
        </button>
      </header>
      @switch (s.state) {
        @case ('loading') {
          <p class="message" data-testid="schema-loading" role="status">
            Sampling {{ sampleSize() }} documents…
          </p>
        }
        @case ('error') {
          <p class="message error" data-testid="schema-failed" role="alert">{{ s.message }}</p>
        }
        @case ('ok') {
          @if (s.rows.length === 0) {
            <p class="message" data-testid="schema-empty">
              No documents match the filter, so there is nothing to analyze.
            </p>
          } @else {
            <p class="hint">Click a type or a value to put it into the filter.</p>
            <table>
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col" class="num">Present</th>
                  <th scope="col">Types</th>
                  <th scope="col">Examples</th>
                </tr>
              </thead>
              <tbody>
                @for (row of s.rows; track row.path) {
                  <tr data-testid="schema-row" [attr.data-path]="row.path">
                    <th scope="row" class="field" [title]="row.path">
                      <span class="name" [style.padding-inline-start.rem]="row.depth * 1">
                        @if (row.depth > 0) {
                          <span class="branch" aria-hidden="true">└</span>
                        }
                        {{ row.name === '[]' ? '[ items ]' : row.name }}
                      </span>
                    </th>
                    <td class="num" data-testid="schema-present">
                      {{ pct(row.share) }}
                      @if (row.missing > 0) {
                        <span class="missing" data-testid="schema-missing"
                          >{{ pct(row.missing) }} missing</span
                        >
                      }
                    </td>
                    <td class="types">
                      <div
                        class="bar"
                        role="img"
                        [attr.aria-label]="barLabel(row)"
                        data-testid="schema-bar"
                      >
                        @for (t of row.types; track t.bsonType) {
                          <span [style.width.%]="t.share * 100" [style.background]="t.color"></span>
                        }
                      </div>
                      <div class="legend">
                        @for (t of row.types; track t.bsonType) {
                          <button
                            type="button"
                            class="type"
                            data-testid="schema-type"
                            [attr.data-type]="t.bsonType"
                            [style.--type-color]="t.color"
                            [title]="'Filter ' + row.filterKey + ' by type ' + t.bsonType"
                            (click)="pickType(row, t.bsonType)"
                          >
                            {{ t.bsonType }} <span class="share">{{ pct(t.share) }}</span>
                          </button>
                        }
                      </div>
                    </td>
                    <td class="examples">
                      @for (t of row.types; track t.bsonType) {
                        @for (ex of t.examples; track $index) {
                          <button
                            type="button"
                            class="example"
                            data-testid="schema-example"
                            [attr.data-type]="t.bsonType"
                            [style.--type-color]="t.color"
                            [title]="'Filter ' + row.filterKey + ': ' + ex.full"
                            (click)="pickValue(row, ex.value)"
                          >
                            {{ ex.text }}
                          </button>
                        }
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        }
      }
    </section>
  `,
  styleUrl: './schema-panel.css',
})
export class SchemaPanel {
  /** What to analyze; `null` shows nothing. */
  readonly params = input.required<SchemaParams | null>();
  readonly closed = output();
  /** A type or value was clicked: the condition for the query bar's filter. */
  readonly pick = output<SchemaFilterPick>();

  private readonly api = inject(ApiService);
  protected readonly state = signal<State>({ state: 'idle' });
  private abort: AbortController | undefined;

  protected readonly sampleSize = computed(() =>
    numberFormat.format(this.params()?.sampleSize ?? 1000),
  );
  protected readonly sampledText = computed(() => {
    const s = this.state();
    if (s.state !== 'ok') return '';
    const n = numberFormat.format(s.sampled);
    return `${n} ${s.sampled === 1 ? 'document' : 'documents'} sampled`;
  });
  protected readonly pct = percent;

  constructor() {
    effect(() => {
      const params = this.params();
      untracked(() => void this.load(params));
    });
    inject(DestroyRef).onDestroy(() => this.abort?.abort());
  }

  protected again(): void {
    void this.load(this.params());
  }

  protected barLabel(row: SchemaRow): string {
    const parts = row.types.map((t) => `${t.bsonType} ${percent(t.share)}`);
    if (row.missing > 0) parts.push(`missing ${percent(row.missing)}`);
    return parts.join(', ');
  }

  protected pickType(row: SchemaRow, bsonType: string): void {
    this.pick.emit({ key: row.filterKey, condition: typeCondition(bsonType) });
  }

  protected pickValue(row: SchemaRow, value: BsonValue): void {
    this.pick.emit({ key: row.filterKey, condition: value });
  }

  private async load(params: SchemaParams | null): Promise<void> {
    this.abort?.abort();
    if (params === null) {
      this.state.set({ state: 'idle' });
      return;
    }
    const abort = new AbortController();
    this.abort = abort;
    this.state.set({ state: 'loading' });
    try {
      const result = await this.api.request('schema.analyze', params, { signal: abort.signal });
      if (abort.signal.aborted) return;
      this.state.set({ state: 'ok', sampled: result.sampled, rows: schemaRows(result.fields) });
    } catch (e) {
      if (abort.signal.aborted || (e instanceof ApiError && e.code === 'CANCELLED')) return;
      this.state.set({ state: 'error', message: describeError(e) });
    }
  }
}
