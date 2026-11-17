import { randomUUID } from 'node:crypto';

import type { SshHostKeyPrompt } from '@thicket/contract';

import { RpcError } from '../server/rpc';
import type { HostKeyQuestion } from './tunnel';

/** How long a host key question waits for an answer before it counts as "no". */
export const HOST_KEY_PROMPT_TIMEOUT_MS = 5 * 60_000;

/**
 * Open "trust this host key?" questions. `ask` sends an `ssh.hostKey` broadcast (through `emit`,
 * to every renderer) and waits until a renderer answers with `conn.trustHostKey`, the time runs
 * out, or the connect is cancelled. Without a renderer to ask the answer is "no".
 */
export class HostKeyPrompts {
  private readonly pending = new Map<string, (trust: boolean) => void>();

  constructor(
    /** Sends the prompt to every renderer; returns how many got it. */
    private readonly emit: (prompt: SshHostKeyPrompt) => number,
    private readonly timeoutMS = HOST_KEY_PROMPT_TIMEOUT_MS,
  ) {}

  ask(question: HostKeyQuestion, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false);
    const promptId = randomUUID();
    return new Promise<boolean>((resolve) => {
      const finish = (trust: boolean) => {
        if (!this.pending.delete(promptId)) return;
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolve(trust);
      };
      const onAbort = () => finish(false);
      const timer = setTimeout(() => finish(false), this.timeoutMS);
      (timer as { unref?: () => void }).unref?.();
      signal.addEventListener('abort', onAbort, { once: true });
      this.pending.set(promptId, finish);
      const prompt: SshHostKeyPrompt = {
        promptId,
        host: question.host,
        port: question.port,
        keyType: question.keyType,
        fingerprint: question.fingerprint,
        timeoutMS: this.timeoutMS,
      };
      if (this.emit(prompt) === 0) finish(false);
    });
  }

  /** The user's answer; `NOT_FOUND` when the question is over (answered, timed out, cancelled). */
  answer(promptId: string, trust: boolean): void {
    const finish = this.pending.get(promptId);
    if (!finish) {
      throw new RpcError('NOT_FOUND', 'This host key question is no longer open');
    }
    finish(trust);
  }

  /** Questions still waiting (tests). */
  get open(): number {
    return this.pending.size;
  }
}
