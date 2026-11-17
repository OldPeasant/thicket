import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { BROADCAST_STREAMS, type SshHostKeyPrompt } from '@thicket/contract';

import { ApiError, describeError } from '../api/api-error';
import { ApiService } from '../api/api.service';

/** A host key question as the dialog shows it. */
export interface HostKeyQuestion {
  prompt: SshHostKeyPrompt;
  /** `Date.now()` when the backend stops waiting for the answer. */
  expiresAt: number;
}

/**
 * Questions of the backend's `ssh.hostKey` broadcast: a connect through an SSH tunnel met a host
 * key Thicket does not know yet. They are shown one at a time (`current`), in arrival order, and
 * answered with `conn.trustHostKey`. A question disappears when it is answered here, when its
 * time runs out (the backend then treats it as "no"), or when another window answered it
 * (`NOT_FOUND` on answering).
 */
@Injectable({ providedIn: 'root' })
export class HostKeyService {
  private readonly api = inject(ApiService);
  private readonly queue = signal<readonly HostKeyQuestion[]>([]);
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  readonly current = computed(() => this.queue()[0] ?? null);
  /** Answer being sent: the buttons wait for it. */
  readonly busy = signal(false);
  /** Why the last answer could not be sent (shown in the dialog). */
  readonly error = signal<string | null>(null);

  constructor() {
    const sub = this.api
      .broadcasts(BROADCAST_STREAMS.sshHostKey)
      .subscribe((prompt) => this.add(prompt));
    inject(DestroyRef).onDestroy(() => {
      sub.unsubscribe();
      for (const timer of this.timers.values()) clearTimeout(timer);
      this.timers.clear();
    });
  }

  private add(prompt: SshHostKeyPrompt): void {
    if (this.queue().some((q) => q.prompt.promptId === prompt.promptId)) return;
    this.queue.update((q) => [...q, { prompt, expiresAt: Date.now() + prompt.timeoutMS }]);
    this.timers.set(
      prompt.promptId,
      setTimeout(() => this.remove(prompt.promptId), prompt.timeoutMS),
    );
  }

  private remove(promptId: string): void {
    const timer = this.timers.get(promptId);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(promptId);
    if (this.current()?.prompt.promptId === promptId) {
      this.error.set(null);
      this.busy.set(false);
    }
    this.queue.update((q) => q.filter((item) => item.prompt.promptId !== promptId));
  }

  /** Trusts (saves in known_hosts) or rejects the current question's host key. */
  async answer(trust: boolean): Promise<void> {
    const question = this.current();
    if (question === null || this.busy()) return;
    const { promptId } = question.prompt;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.request('conn.trustHostKey', { promptId, trust });
      this.remove(promptId);
    } catch (error) {
      // Answered elsewhere, timed out or the connect was cancelled: nothing is waiting any more.
      if (ApiError.from(error).code === 'NOT_FOUND') this.remove(promptId);
      else if (this.current()?.prompt.promptId === promptId) {
        this.error.set(describeError(error));
        this.busy.set(false);
      }
    }
  }
}
