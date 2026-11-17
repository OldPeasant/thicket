import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { UpdateNoticeService } from './update-notice.service';

/**
 * Non-modal "update available" card in the bottom-right corner of the main window. The link opens
 * the release page in the user's browser (main lets only Thicket release pages through); there is
 * no silent auto-update. Dismissing hides it for that version.
 */
@Component({
  selector: 'app-update-notice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (updates.available(); as update) {
      <section
        class="notice"
        data-testid="update-notice"
        role="status"
        aria-label="Update available"
      >
        <span class="mark" aria-hidden="true"></span>
        <p class="text">
          <strong>Thicket {{ update.version }}</strong> is available.
          <a data-testid="update-link" [href]="update.url" target="_blank" rel="noopener noreferrer"
            >View release</a
          >
        </p>
        <button
          type="button"
          class="close"
          data-testid="update-dismiss"
          aria-label="Dismiss update notice"
          title="Dismiss"
          (click)="updates.dismiss()"
        >
          ×
        </button>
      </section>
    }
  `,
  styles: `
    :host {
      position: fixed;
      right: 1rem;
      bottom: 2.25rem;
      z-index: 20;
      pointer-events: none;
    }
    .notice {
      pointer-events: auto;
      display: flex;
      align-items: center;
      gap: 0.625rem;
      max-width: 22rem;
      padding: 0.5rem 0.5rem 0.5rem 0.75rem;
      font-size: 0.8125rem;
      color: var(--text);
      background: var(--bg-elevated);
      border: 1px solid var(--border-strong);
      border-left: 3px solid var(--accent);
      border-radius: 4px;
      box-shadow: var(--shadow-pop);
    }
    .mark {
      flex: none;
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: var(--glow);
    }
    .text {
      margin: 0;
      line-height: 1.4;
    }
    a {
      margin-left: 0.25rem;
      color: var(--accent);
      font-weight: 600;
    }
    a:focus-visible,
    .close:focus-visible {
      outline: 2px solid var(--focus);
      outline-offset: 2px;
    }
    .close {
      flex: none;
      width: 1.5rem;
      height: 1.5rem;
      padding: 0;
      font-size: 1rem;
      line-height: 1;
      color: var(--text-muted);
      background: transparent;
      border: 0;
      border-radius: 3px;
      cursor: pointer;
    }
    .close:hover {
      color: var(--text);
      background: var(--bg-hover);
    }
  `,
})
export class UpdateNotice {
  protected readonly updates = inject(UpdateNoticeService);
}
