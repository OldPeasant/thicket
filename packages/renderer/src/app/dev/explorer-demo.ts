import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';

import demo from '../../assets/samples/canopy-demo.json';
import { JsonExplorerComponent } from '../explorer/json-explorer.component';
import type { Layout } from '../explorer/layout.util';

/**
 * Development page (`#/dev/explorer`): the copied JSON Canopy explorer on its demo document, with
 * the tables/form switch the explorer leaves to its host. Edits replace the document shown here.
 */
@Component({
  selector: 'app-explorer-demo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [JsonExplorerComponent],
  template: `
    <section class="demo">
      <header class="bar">
        <h1>Explorer demo</h1>
        <div class="layouts" role="group" aria-label="Layout">
          @for (l of layouts; track l.value) {
            <button
              type="button"
              class="layout-btn"
              [class.is-active]="layout() === l.value"
              [attr.aria-pressed]="layout() === l.value"
              (click)="layout.set(l.value)"
            >
              {{ l.label }}
            </button>
          }
        </div>
      </header>
      <app-json-explorer [value]="data()" [layout]="layout()" (valueChange)="data.set($event)" />
      <details class="raw">
        <summary>Document</summary>
        <pre class="raw-json">{{ json() }}</pre>
      </details>
    </section>
  `,
  styles: `
    .demo {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding: 1rem 1.5rem;
    }
    .bar {
      display: flex;
      align-items: center;
      gap: 1.5rem;
    }
    h1 {
      margin: 0;
      font-size: 1rem;
      text-transform: var(--heading-transform);
      letter-spacing: var(--heading-tracking);
      color: var(--accent);
    }
    .layouts {
      display: flex;
      gap: 0.25rem;
    }
    .layout-btn {
      font: inherit;
      font-size: 0.75rem;
      padding: 0.25rem 0.75rem;
      color: var(--text-muted);
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-radius: 4px;
      cursor: pointer;
    }
    .layout-btn.is-active {
      color: var(--accent);
      border-color: var(--accent);
      box-shadow: var(--shadow-pop);
    }
    .raw summary {
      cursor: pointer;
      color: var(--text-muted);
      font-size: 0.75rem;
    }
    .raw-json {
      font-family: var(--font-mono);
      font-size: 0.8rem;
      color: var(--text);
      background: var(--bg-panel);
      border: 1px solid var(--border);
      padding: 0.75rem;
      overflow: auto;
    }
  `,
})
export class ExplorerDemo {
  protected readonly layouts: { value: Layout; label: string }[] = [
    { value: 'tables', label: 'Tables' },
    { value: 'form', label: 'Form' },
  ];

  protected readonly layout = signal<Layout>('tables');
  protected readonly data = signal<unknown>(structuredClone(demo));
  protected readonly json = computed(() => JSON.stringify(this.data(), null, 2));
}
