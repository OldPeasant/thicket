import { Injectable, computed, signal } from '@angular/core';

/** Connection shown in the status bar (the one of the active tab, set by the views). */
export interface StatusConnection {
  name: string;
  state: 'connecting' | 'connected' | 'disconnected' | 'error';
  /** Production connection (red accent). */
  production?: boolean;
  /** Read-only profile. */
  readonly?: boolean;
}

/** A running operation shown in the status bar. */
export interface StatusOperation {
  id: number;
  label: string;
  /** 0…1 when known; `undefined` shows an indeterminate bar. */
  progress?: number;
}

/** Handle of a running operation. */
export interface OperationHandle {
  /** Updates the progress (0…1) or the label. */
  update(change: { progress?: number; label?: string }): void;
  /** Removes the operation from the status bar (idempotent). */
  done(): void;
}

/** What the status bar shows: the current connection and the running operations. */
@Injectable({ providedIn: 'root' })
export class StatusService {
  private readonly connectionState = signal<StatusConnection | null>(null);
  private readonly operationsState = signal<readonly StatusOperation[]>([]);
  private nextId = 0;

  readonly connection = this.connectionState.asReadonly();
  readonly operations = this.operationsState.asReadonly();
  /** The newest running operation (shown first), or `null`. */
  readonly current = computed(() => this.operationsState().at(-1) ?? null);

  setConnection(connection: StatusConnection | null): void {
    this.connectionState.set(connection);
  }

  /** Shows a running operation until `done()` is called on the returned handle. */
  begin(label: string, progress?: number): OperationHandle {
    const id = ++this.nextId;
    this.operationsState.update((ops) => [...ops, { id, label, progress }]);
    return {
      update: (change) =>
        this.operationsState.update((ops) =>
          ops.map((op) => (op.id === id ? { ...op, ...change } : op)),
        ),
      done: () => this.operationsState.update((ops) => ops.filter((op) => op.id !== id)),
    };
  }

  /** Shows `label` while `work` runs; resolves or rejects like `work`. */
  async track<T>(label: string, work: Promise<T>): Promise<T> {
    const handle = this.begin(label);
    try {
      return await work;
    } finally {
      handle.done();
    }
  }
}
