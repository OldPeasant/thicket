import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';

import { NAV } from './navigation';

/** Start page with no tab open: the two ways to get a first connection. */
@Component({
  selector: 'app-welcome',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="welcome" aria-labelledby="welcome-title">
      <svg class="mark" viewBox="0 0 64 64" aria-hidden="true">
        <path
          d="M32 60V30M32 42 18 28M32 34l12-12M18 28l-6-6M18 28V16M44 22h7M44 22V12M32 30l-5-10M32 50l9-7M41 43h7"
        />
      </svg>
      <h1 id="welcome-title">Thicket</h1>
      <p class="lede">A desktop client for MongoDB.</p>
      <div class="actions">
        <button
          type="button"
          class="action primary"
          data-testid="welcome-new"
          (click)="go('newConnection')"
        >
          <span class="action-title">New connection</span>
          <span class="action-text"
            >Paste a connection string or fill in host, authentication and TLS.</span
          >
        </button>
        <button
          type="button"
          class="action"
          data-testid="welcome-import"
          (click)="go('importCompass')"
        >
          <span class="action-title">Import from Compass</span>
          <span class="action-text"
            >Bring in the connections you exported from MongoDB Compass.</span
          >
        </button>
      </div>
    </section>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
      overflow: auto;
    }
    .welcome {
      max-width: 34rem;
      padding: clamp(2rem, 10vh, 6rem) 2.5rem 2rem clamp(2rem, 8vw, 6rem);
    }
    .mark {
      width: 3rem;
      height: 3rem;
      fill: none;
      stroke: var(--accent);
      stroke-width: 2.2;
      stroke-linecap: round;
      stroke-linejoin: round;
      filter: drop-shadow(var(--glow));
    }
    h1 {
      margin: 1rem 0 0.25rem;
      font-size: 2rem;
      font-weight: 600;
      line-height: 1.15;
      letter-spacing: var(--heading-tracking);
      text-transform: var(--heading-transform);
      color: var(--text);
    }
    .lede {
      margin: 0 0 2rem;
      color: var(--text-muted);
    }
    .actions {
      display: grid;
      gap: 0.5rem;
    }
    .action {
      display: grid;
      gap: 0.2rem;
      padding: 0.75rem 1rem;
      text-align: left;
      font: inherit;
      color: var(--text);
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-left: 3px solid var(--border-strong);
      border-radius: 4px;
      cursor: pointer;
    }
    .action.primary {
      border-left-color: var(--accent);
    }
    .action:hover {
      background: var(--bg-hover);
    }
    .action:focus-visible {
      outline: none;
      box-shadow: var(--focus-ring);
    }
    .action-title {
      font-weight: 600;
    }
    .action-text {
      font-size: 0.85em;
      color: var(--text-muted);
    }
  `,
})
export class Welcome {
  private readonly router = inject(Router);

  protected go(target: 'newConnection' | 'importCompass'): void {
    void this.router.navigateByUrl(NAV[target]);
  }
}
