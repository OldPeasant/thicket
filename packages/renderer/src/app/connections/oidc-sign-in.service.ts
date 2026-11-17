import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { BROADCAST_STREAMS, type OidcPrompt } from '@thicket/contract';

import { ApiService } from '../api/api.service';

/** A sign-in that waits for the user (`browser` or `device` prompt). */
export type OidcSignIn = Exclude<OidcPrompt, { kind: 'finished' }> & {
  /** `Date.now()` when a device code expires (absent for the browser flow). */
  expiresAt?: number;
};

/**
 * MONGODB-OIDC sign-ins in progress, from the backend's `oidc.prompt` broadcast: a connect (sidebar,
 * editor Test, ...) waits for the user to sign in at the identity provider, in the browser the
 * backend opened or with a device code. The sign-in state shows the latest one (`current`); a
 * sign-in disappears when its `finished` event arrives, when its device code expires, or when the
 * user hides it (the connect still waits for the identity provider, and fails on its own timeout).
 * No tokens travel here: only the sign-in page URL and the device user code.
 */
@Injectable({ providedIn: 'root' })
export class OidcSignInService {
  private readonly api = inject(ApiService);
  private readonly waiting = signal<readonly OidcSignIn[]>([]);
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  /** The sign-in shown (the most recent one still waiting), or null. */
  readonly current = computed(() => this.waiting().at(-1) ?? null);
  /** How many sign-ins wait (more than one: several connects at once). */
  readonly count = computed(() => this.waiting().length);
  /** The last sign-in that ended, and how (for a short "Signed in" / "failed" note). */
  readonly last = signal<{ promptId: string; profileName: string; ok: boolean } | null>(null);

  constructor() {
    const sub = this.api
      .broadcasts(BROADCAST_STREAMS.oidcPrompt)
      .subscribe((prompt) => this.receive(prompt));
    inject(DestroyRef).onDestroy(() => {
      sub.unsubscribe();
      for (const timer of this.timers.values()) clearTimeout(timer);
      this.timers.clear();
    });
  }

  private receive(prompt: OidcPrompt): void {
    if (prompt.kind === 'finished') {
      const known = this.waiting().some((s) => s.promptId === prompt.promptId);
      this.remove(prompt.promptId);
      if (known) {
        this.last.set({
          promptId: prompt.promptId,
          profileName: prompt.profileName,
          ok: prompt.ok,
        });
      }
      return;
    }
    const signIn: OidcSignIn =
      prompt.kind === 'device'
        ? { ...prompt, expiresAt: Date.now() + prompt.expiresInSeconds * 1000 }
        : prompt;
    // A browser sign-in that fell back to a device code keeps its id: the new prompt replaces it.
    this.remove(prompt.promptId);
    this.last.set(null);
    this.waiting.update((list) => [...list, signIn]);
    if (prompt.kind === 'device') {
      this.timers.set(
        prompt.promptId,
        setTimeout(() => this.remove(prompt.promptId), prompt.expiresInSeconds * 1000),
      );
    }
  }

  private remove(promptId: string): void {
    const timer = this.timers.get(promptId);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(promptId);
    this.waiting.update((list) => list.filter((s) => s.promptId !== promptId));
  }

  /** Hides a sign-in (the connect keeps waiting for the identity provider). */
  dismiss(promptId: string): void {
    this.remove(promptId);
  }

  /** Hides the "Signed in" / "Sign-in failed" note. */
  clearLast(): void {
    this.last.set(null);
  }
}
