import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { StatusService } from './status.service';

const STATE_TEXT = {
  connecting: 'Connecting…',
  connected: 'Connected',
  disconnected: 'Disconnected',
  error: 'Connection failed',
} as const;

/** Bottom bar: connection of the active view on the left, running operations on the right. */
@Component({
  selector: 'app-status-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="connection" data-testid="status-connection">
      @if (status.connection(); as conn) {
        <span class="dot" [attr.data-state]="conn.state" aria-hidden="true"></span>
        <span class="name">{{ conn.name }}</span>
        <span class="state">{{ stateText() }}</span>
        @if (conn.production) {
          <span class="flag production">Production</span>
        }
        @if (conn.readonly) {
          <span class="flag readonly">Read-only</span>
        }
      } @else {
        <span class="dot" data-state="none" aria-hidden="true"></span>
        <span class="state">No connection</span>
      }
    </div>
    <div class="operations" data-testid="status-operations" role="status" aria-live="polite">
      @if (status.current(); as op) {
        <span class="label">{{ op.label }}</span>
        @if (more() > 0) {
          <span class="more">+{{ more() }} more</span>
        }
        <span
          class="bar"
          role="progressbar"
          [attr.aria-label]="op.label"
          [attr.aria-valuenow]="op.progress === undefined ? null : percent(op.progress)"
          aria-valuemin="0"
          aria-valuemax="100"
          [class.indeterminate]="op.progress === undefined"
        >
          <span
            class="fill"
            [style.width.%]="op.progress === undefined ? 40 : percent(op.progress)"
          ></span>
        </span>
      }
    </div>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      height: 1.5rem;
      padding: 0 0.75rem;
      font-size: 0.75rem;
      color: var(--text-muted);
      background: var(--bg-panel);
      border-top: 1px solid var(--border);
      white-space: nowrap;
    }
    .connection,
    .operations {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      min-width: 0;
    }
    .name {
      color: var(--text);
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .dot {
      flex: none;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      border: 1px solid var(--border-strong);
    }
    .dot[data-state='connected'] {
      background: var(--accent);
      border-color: var(--accent);
      box-shadow: var(--glow);
    }
    .dot[data-state='connecting'] {
      border-color: var(--accent);
    }
    .dot[data-state='error'] {
      background: var(--danger);
      border-color: var(--danger);
    }
    .flag {
      padding: 0 0.375rem;
      border-radius: 3px;
      line-height: 1.1rem;
    }
    .flag.production {
      color: var(--production-text);
      background: var(--production-bg);
    }
    .flag.readonly {
      color: var(--readonly-text);
      background: var(--readonly-bg);
    }
    .label {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .more {
      color: var(--text-faint);
    }
    .bar {
      position: relative;
      flex: none;
      width: 6rem;
      height: 3px;
      overflow: hidden;
      background: var(--border);
      border-radius: 2px;
    }
    .fill {
      position: absolute;
      inset: 0 auto 0 0;
      background: var(--accent);
      box-shadow: var(--glow);
    }
    @media (prefers-reduced-motion: no-preference) {
      .indeterminate .fill {
        animation: slide 1.2s ease-in-out infinite;
      }
    }
    @keyframes slide {
      from {
        left: -40%;
      }
      to {
        left: 100%;
      }
    }
  `,
})
export class StatusBar {
  protected readonly status = inject(StatusService);
  protected readonly stateText = computed(() => {
    const conn = this.status.connection();
    return conn ? STATE_TEXT[conn.state] : '';
  });
  protected readonly more = computed(() => this.status.operations().length - 1);

  protected percent(progress: number): number {
    return Math.round(Math.max(0, Math.min(1, progress)) * 100);
  }
}
