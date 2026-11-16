import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';

import { ConfirmService } from './confirm.service';

/**
 * The modal confirm dialog for writes (`ConfirmService`). Shows the exact operation in shell
 * syntax, the connection (red accent for production) and, for large deletes, a field where the
 * collection name must be typed before the confirm button works. Escape and Cancel abort; focus
 * stays inside the dialog while it is open (also after a click on the backdrop; `AppShell` makes
 * the rest of the window inert) and returns to where it was afterwards.
 */
@Component({
  selector: 'app-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown)': 'onDocumentKeydown($event)',
  },
  template: `
    @if (confirm.current(); as req) {
      <div
        class="backdrop"
        data-testid="confirm-backdrop"
        (mousedown)="onBackdropMousedown($event)"
      ></div>
      <div
        class="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-operation"
        data-testid="confirm-dialog"
        tabindex="-1"
        [class.production]="req.connection?.production"
        [class.destructive]="req.destructive"
        (keydown)="onKeydown($event)"
      >
        <header class="head">
          <h2 id="confirm-title" class="title">{{ req.title }}</h2>
          @if (req.connection; as conn) {
            <p class="target" data-testid="confirm-target">
              @if (conn.production) {
                <span class="flag" data-testid="confirm-production">Production</span>
              }
              <span class="conn">{{ conn.name }}</span>
              @if (req.namespace) {
                <span class="ns">{{ req.namespace }}</span>
              }
            </p>
          } @else if (req.namespace) {
            <p class="target">
              <span class="ns">{{ req.namespace }}</span>
            </p>
          }
        </header>

        <pre
          id="confirm-operation"
          class="operation"
          data-testid="confirm-operation"
          tabindex="0"
          >{{ req.operation }}</pre>

        @if (req.detail) {
          <p class="detail" data-testid="confirm-detail">{{ req.detail }}</p>
        }

        @if (req.typeToConfirm !== undefined) {
          <label class="type" for="confirm-type">
            Type <code class="word">{{ req.typeToConfirm }}</code> to confirm.
          </label>
          <input
            id="confirm-type"
            class="type-input"
            data-testid="confirm-type"
            type="text"
            autocomplete="off"
            spellcheck="false"
            [attr.aria-invalid]="typed() !== '' && !matches()"
            [value]="typed()"
            (input)="onType($event)"
          />
        }

        <footer class="actions">
          <button type="button" class="btn cancel" data-testid="confirm-cancel" (click)="cancel()">
            Cancel
          </button>
          <button
            type="button"
            class="btn ok"
            data-testid="confirm-ok"
            [disabled]="!matches()"
            (click)="accept()"
          >
            {{ req.confirmLabel }}
          </button>
        </footer>
      </div>
    }
  `,
  styleUrl: './confirm-dialog.css',
})
export class ConfirmDialog {
  protected readonly confirm = inject(ConfirmService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);

  protected readonly typed = signal('');
  protected readonly matches = computed(() => {
    const word = this.confirm.current()?.typeToConfirm;
    return word === undefined || this.typed() === word;
  });
  /** Element focused before the dialog opened; focus returns there when it closes. */
  private returnFocus: HTMLElement | null = null;
  private shown: unknown = null;

  constructor() {
    // A new request starts with an empty field.
    effect(() => {
      this.confirm.current();
      untracked(() => {
        this.typed.set('');
        this.confirm.setTyped('');
      });
    });
    afterRenderEffect(() => {
      const req = this.confirm.current();
      if (req === this.shown) return;
      const opening = this.shown === null;
      this.shown = req;
      if (req === null) {
        const target = this.returnFocus;
        this.returnFocus = null;
        if (target?.isConnected) target.focus();
        return;
      }
      if (opening) {
        const active = this.document.activeElement;
        this.returnFocus = active instanceof HTMLElement ? active : null;
      }
      // Large deletes focus the name field; risky writes focus Cancel, so Enter never confirms
      // them by accident; other writes focus the confirm button.
      const selector =
        req.typeToConfirm !== undefined
          ? '[data-testid="confirm-type"]'
          : req.destructive || req.connection?.production
            ? '[data-testid="confirm-cancel"]'
            : '[data-testid="confirm-ok"]';
      this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
    });
  }

  protected onType(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.typed.set(value);
    this.confirm.setTyped(value);
  }

  protected cancel(): void {
    this.confirm.answer(false);
  }

  protected accept(): void {
    if (this.matches()) this.confirm.answer(true);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancel();
    } else if (event.key === 'Enter' && (event.target as HTMLElement).id === 'confirm-type') {
      event.preventDefault();
      this.accept();
    } else if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      this.trapFocus(event);
    }
  }

  /**
   * Keys pressed while focus is outside the dialog (e.g. on `<body>`): Escape still cancels and
   * Tab moves focus back into the dialog.
   */
  protected onDocumentKeydown(event: KeyboardEvent): void {
    const dialog = this.dialogElement();
    if (!dialog || dialog.contains(event.target as Node | null)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.cancel();
    } else if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      this.focusables()[0]?.focus();
    }
  }

  /** A click on the backdrop keeps focus in the dialog, so Escape and Tab keep working. */
  protected onBackdropMousedown(event: MouseEvent): void {
    event.preventDefault();
    const dialog = this.dialogElement();
    if (dialog && !dialog.contains(this.document.activeElement)) dialog.focus();
  }

  private dialogElement(): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>('[data-testid="confirm-dialog"]');
  }

  private focusables(): HTMLElement[] {
    return Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>(
        '.dialog [tabindex="0"], .dialog input, .dialog button:not([disabled])',
      ),
    );
  }

  /** Keeps Tab and Shift+Tab inside the dialog. */
  private trapFocus(event: KeyboardEvent): void {
    const items = this.focusables();
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) return;
    const active = this.document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
