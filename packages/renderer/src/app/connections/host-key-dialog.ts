import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';

import { HostKeyService } from './host-key.service';

/**
 * "Trust this host key?" (`HostKeyService`): shows the SSH server, the key type and its SHA-256
 * fingerprint, set large so it can be compared with the server's own `ssh-keygen -l` output.
 * Modal: `AppShell` makes the rest of the window inert while it is open. "Don't trust" has the
 * focus first and is what Escape does, so a stray Enter never trusts a key.
 */
@Component({
  selector: 'app-host-key-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (hostKeys.current(); as q) {
      <div class="backdrop" (mousedown)="$event.preventDefault()"></div>
      <div
        class="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="hostkey-title"
        aria-describedby="hostkey-what hostkey-fingerprint"
        data-testid="host-key-dialog"
        tabindex="-1"
        (keydown)="onKeydown($event)"
      >
        <h2 id="hostkey-title" class="title">Trust this SSH server?</h2>
        <p id="hostkey-what" class="what">
          Thicket has not connected to
          <span class="server" data-testid="host-key-host">{{ server() }}</span> before. Check that
          the fingerprint matches the server's
          <span class="key-type" data-testid="host-key-type">{{ q.prompt.keyType }}</span> host key
          before you trust it.
        </p>
        <p
          id="hostkey-fingerprint"
          class="fingerprint"
          data-testid="host-key-fingerprint"
          tabindex="0"
        >
          <span class="algo">{{ algorithm() }}</span><span class="digest">{{ digest() }}</span>
        </p>
        <p class="hint">
          On the server, <code>ssh-keygen -lf</code> on the host key's .pub file prints this
          fingerprint. Trusted keys are kept in Thicket's own known_hosts file; if the key changes
          later, Thicket refuses to connect.
        </p>
        @if (hostKeys.error(); as error) {
          <p class="error" role="alert" data-testid="host-key-error">{{ error }}</p>
        }
        <div class="actions">
          <button
            type="button"
            class="btn"
            data-testid="host-key-reject"
            [disabled]="hostKeys.busy()"
            (click)="answer(false)"
          >
            Don't trust
          </button>
          <button
            type="button"
            class="btn primary"
            data-testid="host-key-trust"
            [disabled]="hostKeys.busy()"
            (click)="answer(true)"
          >
            Trust and connect
          </button>
        </div>
      </div>
    }
  `,
  styleUrl: './host-key-dialog.css',
})
export class HostKeyDialog {
  protected readonly hostKeys = inject(HostKeyService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);

  protected readonly server = computed(() => {
    const prompt = this.hostKeys.current()?.prompt;
    if (!prompt) return '';
    const name = prompt.host.includes(':') ? `[${prompt.host}]` : prompt.host;
    return prompt.port === 22 ? name : `${name}:${String(prompt.port)}`;
  });
  /** `SHA256:` of `SHA256:abc…` (empty when the fingerprint has no algorithm prefix). */
  protected readonly algorithm = computed(() => {
    const fp = this.hostKeys.current()?.prompt.fingerprint ?? '';
    const colon = fp.indexOf(':');
    return colon < 0 ? '' : fp.slice(0, colon + 1);
  });
  protected readonly digest = computed(() => {
    const fp = this.hostKeys.current()?.prompt.fingerprint ?? '';
    return fp.slice(fp.indexOf(':') + 1);
  });

  private shown: string | null = null;
  private returnFocus: HTMLElement | null = null;
  private wasBusy = false;

  constructor() {
    afterRenderEffect(() => {
      const id = this.hostKeys.current()?.prompt.promptId ?? null;
      if (id === this.shown) return;
      const opening = this.shown === null;
      this.shown = id;
      if (id === null) {
        const target = this.returnFocus;
        this.returnFocus = null;
        if (target?.isConnected) target.focus();
        return;
      }
      if (opening) {
        const active = this.document.activeElement;
        this.returnFocus = active instanceof HTMLElement ? active : null;
      }
      this.host.nativeElement
        .querySelector<HTMLElement>('[data-testid="host-key-reject"]')
        ?.focus();
    });
    // A failed answer (error shown, buttons enabled again): "Don't trust" gets the focus back,
    // unless the user already moved it to something else in the dialog.
    afterRenderEffect(() => {
      const busy = this.hostKeys.busy();
      const id = this.hostKeys.current()?.prompt.promptId ?? null;
      const wasBusy = this.wasBusy;
      this.wasBusy = busy;
      if (busy || !wasBusy || id === null || id !== this.shown) return;
      const dialog = this.dialog();
      const active = this.document.activeElement;
      if (active === dialog || !(active instanceof Node) || !dialog?.contains(active)) {
        this.host.nativeElement
          .querySelector<HTMLElement>('[data-testid="host-key-reject"]')
          ?.focus();
      }
    });
  }

  /**
   * Sends the answer. The dialog itself takes the focus first: the buttons are disabled while the
   * answer is sent, and a disabled focused button would drop the focus out of the dialog (and with
   * it Escape and the Tab trap).
   */
  protected answer(trust: boolean): void {
    if (this.hostKeys.busy()) return;
    this.dialog()?.focus();
    void this.hostKeys.answer(trust);
  }

  private dialog(): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>('.dialog');
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.answer(false);
    } else if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const items = Array.from(
        this.host.nativeElement.querySelectorAll<HTMLElement>(
          '.dialog [tabindex="0"], .dialog button:not([disabled])',
        ),
      );
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
}
