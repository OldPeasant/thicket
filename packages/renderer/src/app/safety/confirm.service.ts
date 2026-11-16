import { Injectable, signal } from '@angular/core';

/** What the confirm dialog asks. */
export interface ConfirmRequest {
  /** Heading, e.g. "Delete 12 431 documents". */
  title: string;
  /** The exact operation in mongosh shell syntax. */
  operation: string;
  /** Text of the confirm button (says what happens: "Delete documents", "Save"). */
  confirmLabel: string;
  /** Profile the write goes to. */
  connection?: { name: string; production: boolean };
  /** Namespace (`db.coll`), shown above the operation. */
  namespace?: string;
  /** One line about the effect, e.g. "Matches 12 431 documents." */
  detail?: string;
  /** Destructive (delete, drop): the confirm button uses the danger colors. */
  destructive?: boolean;
  /** When set, the confirm button stays disabled until exactly this text is typed. */
  typeToConfirm?: string;
}

interface Pending {
  request: ConfirmRequest;
  resolve: (confirmed: boolean) => void;
}

/**
 * Shows one confirm dialog at a time (`ConfirmDialog`, placed once in the main window).
 * `confirm()` resolves `true` when the user confirmed and `false` when they cancelled; requests
 * made while a dialog is open wait for it.
 */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private readonly queue: Pending[] = [];
  private readonly currentState = signal<ConfirmRequest | null>(null);

  /** The request the dialog shows, or `null`. */
  readonly current = this.currentState.asReadonly();

  confirm(request: ConfirmRequest): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.queue.push({ request, resolve });
      if (this.queue.length === 1) this.currentState.set(request);
    });
  }

  /** Answers the shown request (called by the dialog). */
  answer(confirmed: boolean): void {
    const pending = this.queue.shift();
    if (!pending) return;
    const typeToConfirm = pending.request.typeToConfirm;
    const accepted = confirmed && (typeToConfirm === undefined || this.typed === typeToConfirm);
    this.typed = '';
    this.currentState.set(this.queue[0]?.request ?? null);
    pending.resolve(accepted);
  }

  /** The typed confirmation text, so `answer(true)` cannot bypass type-to-confirm. */
  private typed = '';

  /** Called by the dialog when the type-to-confirm text changes. */
  setTyped(text: string): void {
    this.typed = text;
  }
}
