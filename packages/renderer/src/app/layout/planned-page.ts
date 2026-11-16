import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { NAV } from './navigation';

/**
 * Stand-in for a page a later task builds (route data `heading`): says so and links back to the
 * start page.
 */
@Component({
  selector: 'app-planned-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <section class="planned">
      <h1 data-testid="page-heading">{{ heading() }}</h1>
      <p>This part of Thicket is not built yet.</p>
      <a [routerLink]="home">Back to start</a>
    </section>
  `,
  styles: `
    .planned {
      padding: 2.5rem;
      max-width: 34rem;
    }
    h1 {
      margin: 0 0 0.5rem;
      font-size: 1.25rem;
      font-weight: 600;
      letter-spacing: var(--heading-tracking);
      text-transform: var(--heading-transform);
    }
    p {
      color: var(--text-muted);
    }
    a {
      color: var(--accent);
    }
  `,
})
export class PlannedPage {
  protected readonly home = NAV.home;
  protected readonly heading = toSignal(
    inject(ActivatedRoute).data.pipe(map((data) => String(data['heading'] ?? ''))),
    { initialValue: '' },
  );
}
