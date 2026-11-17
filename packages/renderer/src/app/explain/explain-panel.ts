import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import type { ParamsOf } from '@thicket/contract';

import { ApiError, describeError } from '../api/api-error';
import { ApiService } from '../api/api.service';
import { ExplainPlan } from './explain-plan';

export type ExplainParams = ParamsOf<'agg.explain'>;

type State =
  | { readonly state: 'idle' }
  | { readonly state: 'loading' }
  | { readonly state: 'ok'; readonly explain: string }
  | { readonly state: 'error'; readonly message: string };

/**
 * The explain panel of the query bar and the pipeline builder: asks `agg.explain` (with execution
 * stats) for `params` whenever they change, and shows the plan. A newer request cancels the
 * running one; so does closing the panel.
 */
@Component({
  selector: 'app-explain-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ExplainPlan],
  template: `
    <section class="panel" data-testid="explain-panel" aria-label="Explain plan">
      <header>
        <h2>Explain plan</h2>
        <button type="button" class="btn quiet" data-testid="explain-again" (click)="again()">
          Explain again
        </button>
        <button type="button" class="btn quiet" data-testid="explain-close" (click)="closed.emit()">
          Close
        </button>
      </header>
      @let s = state();
      @switch (s.state) {
        @case ('loading') {
          <p class="message" data-testid="explain-loading" role="status">Running explain…</p>
        }
        @case ('error') {
          <p class="message error" data-testid="explain-failed" role="alert">{{ s.message }}</p>
        }
        @case ('ok') {
          <app-explain-plan [explain]="s.explain" />
        }
      }
    </section>
  `,
  styles: `
    .panel {
      padding: 0.5rem 0.75rem 0.75rem;
      background: var(--bg-elevated);
      border-bottom: 1px solid var(--border);
      max-height: 60vh;
      overflow: auto;
    }
    header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
    }
    h2 {
      margin: 0 auto 0 0;
      font-size: 1em;
      font-weight: 600;
      text-transform: var(--heading-transform);
      letter-spacing: var(--heading-tracking);
    }
    .btn {
      padding: 0.25rem 0.75rem;
      font: inherit;
      color: var(--text-muted);
      background: none;
      border: 1px solid var(--border);
      border-radius: 3px;
      cursor: pointer;
    }
    .btn:hover {
      color: var(--text);
      background: var(--bg-hover);
    }
    .btn:focus-visible {
      outline: 2px solid var(--focus);
      outline-offset: 1px;
    }
    .message {
      margin: 0.5rem 0;
      color: var(--text-muted);
    }
    .message.error {
      padding: 0.375rem 0.625rem;
      color: var(--danger-text);
      background: var(--danger-bg);
      border: 1px solid var(--danger-border);
      border-radius: 4px;
    }
  `,
})
export class ExplainPanel {
  /** What to explain; `null` shows nothing. */
  readonly params = input.required<ExplainParams | null>();
  readonly closed = output();

  private readonly api = inject(ApiService);
  protected readonly state = signal<State>({ state: 'idle' });
  private abort: AbortController | undefined;

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

  private async load(params: ExplainParams | null): Promise<void> {
    this.abort?.abort();
    if (params === null) {
      this.state.set({ state: 'idle' });
      return;
    }
    const abort = new AbortController();
    this.abort = abort;
    this.state.set({ state: 'loading' });
    try {
      const { explain } = await this.api.request('agg.explain', params, { signal: abort.signal });
      if (!abort.signal.aborted) this.state.set({ state: 'ok', explain });
    } catch (e) {
      if (abort.signal.aborted || (e instanceof ApiError && e.code === 'CANCELLED')) return;
      this.state.set({ state: 'error', message: describeError(e) });
    }
  }
}
