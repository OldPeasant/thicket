import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import type { WorkspaceTab } from './workspace.service';

/** Shown for a tab kind without a registered view (`provideTabView`). */
@Component({
  selector: 'app-tab-placeholder',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="placeholder">
      <h1>{{ tab().title }}</h1>
      @if (tab().detail) {
        <p class="detail">{{ tab().detail }}</p>
      }
      <p>This view is not built yet.</p>
    </section>
  `,
  styles: `
    .placeholder {
      padding: 2rem 2.5rem;
      color: var(--text-muted);
    }
    h1 {
      margin: 0 0 0.25rem;
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--text);
      letter-spacing: var(--heading-tracking);
      text-transform: var(--heading-transform);
    }
    .detail {
      margin: 0 0 1rem;
      color: var(--text-faint);
    }
  `,
})
export class TabPlaceholder {
  readonly tab = input.required<WorkspaceTab>();
}
