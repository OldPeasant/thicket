import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';

import { OidcSignInService } from './oidc-sign-in.service';

/** How long the "Signed in" note stays (a failure stays until closed). */
const SIGNED_IN_NOTE_MS = 4000;

/**
 * The OIDC sign-in state (`OidcSignInService`): a panel docked at the bottom right while a
 * MONGODB-OIDC connect waits for the user. Browser flow: "finish signing in in your browser", with
 * the page's link to copy (the backend already opened it). Device flow: the user code, set large
 * like the SSH fingerprint, and the page to enter it on. Not modal: the user switches to the
 * browser or another device, and the app stays usable meanwhile.
 */
@Component({
  selector: 'app-oidc-sign-in',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (signIns.current(); as s) {
      <section
        class="panel"
        role="dialog"
        aria-modal="false"
        aria-labelledby="oidc-title"
        aria-describedby="oidc-what"
        data-testid="oidc-sign-in"
        [attr.data-kind]="s.kind"
      >
        <h2 id="oidc-title" class="title">
          Sign in to <span data-testid="oidc-profile">{{ s.profileName }}</span>
        </h2>
        @if (s.kind === 'browser') {
          <p id="oidc-what" class="what">
            Finish signing in on the page that opened in your browser. Thicket connects as soon as
            you are done.
          </p>
          <p class="hint">No page opened? Copy the link into your browser.</p>
          <div class="actions">
            <button
              type="button"
              class="btn quiet"
              data-testid="oidc-hide"
              (click)="hide(s.promptId)"
            >
              Hide
            </button>
            <button
              type="button"
              class="btn"
              data-testid="oidc-copy-url"
              (click)="copy(s.url, 'url')"
            >
              {{ copied() === 'url' ? 'Link copied' : 'Copy link' }}
            </button>
          </div>
        } @else {
          <p id="oidc-what" class="what">
            On any device, open
            <span class="uri" data-testid="oidc-verification-uri">{{ s.verificationUri }}</span>
            and enter this code:
          </p>
          <p class="code" data-testid="oidc-user-code" tabindex="0">{{ s.userCode }}</p>
          <p class="hint" data-testid="oidc-expiry">{{ expiry() }}</p>
          <div class="actions">
            <button
              type="button"
              class="btn quiet"
              data-testid="oidc-hide"
              (click)="hide(s.promptId)"
            >
              Hide
            </button>
            <button
              type="button"
              class="btn"
              data-testid="oidc-copy-uri"
              (click)="copy(s.verificationUriComplete ?? s.verificationUri, 'url')"
            >
              {{ copied() === 'url' ? 'Link copied' : 'Copy link' }}
            </button>
            <button
              type="button"
              class="btn"
              data-testid="oidc-copy-code"
              (click)="copy(s.userCode, 'code')"
            >
              {{ copied() === 'code' ? 'Code copied' : 'Copy code' }}
            </button>
          </div>
        }
        @if (copied() === 'failed') {
          <p class="error" role="alert">The clipboard is not available; select the text instead.</p>
        }
      </section>
    } @else if (signIns.last(); as last) {
      <section
        class="panel note"
        role="status"
        data-testid="oidc-result"
        [class.failed]="!last.ok"
        [attr.data-ok]="last.ok"
      >
        <p class="what">
          @if (last.ok) {
            Signed in to {{ last.profileName }}.
          } @else {
            Signing in to {{ last.profileName }} did not finish. Connect again to retry.
          }
        </p>
        <button
          type="button"
          class="btn quiet"
          data-testid="oidc-result-close"
          (click)="signIns.clearLast()"
        >
          Close
        </button>
      </section>
    }
  `,
  styleUrl: './oidc-sign-in.css',
})
export class OidcSignIn {
  protected readonly signIns = inject(OidcSignInService);
  protected readonly copied = signal<'idle' | 'url' | 'code' | 'failed'>('idle');
  /** `Date.now()`, ticking every second while a device code is shown. */
  private readonly now = signal(Date.now());

  protected readonly expiry = computed(() => {
    const s = this.signIns.current();
    if (s?.expiresAt === undefined) return '';
    const seconds = Math.max(0, Math.ceil((s.expiresAt - this.now()) / 1000));
    if (seconds >= 120) return `The code expires in ${String(Math.ceil(seconds / 60))} minutes.`;
    return `The code expires in ${String(seconds)} ${seconds === 1 ? 'second' : 'seconds'}.`;
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    let tick: ReturnType<typeof setInterval> | undefined;
    let noteTimer: ReturnType<typeof setTimeout> | undefined;
    const stopTick = () => {
      if (tick !== undefined) clearInterval(tick);
      tick = undefined;
    };
    effect(() => {
      const s = this.signIns.current();
      this.copied.set('idle');
      stopTick();
      if (s?.kind === 'device') {
        this.now.set(Date.now());
        tick = setInterval(() => this.now.set(Date.now()), 1000);
      }
    });
    // "Signed in" goes away on its own; a failure stays until it is closed.
    effect(() => {
      const last = this.signIns.last();
      if (noteTimer !== undefined) clearTimeout(noteTimer);
      noteTimer = undefined;
      if (last?.ok === true) {
        noteTimer = setTimeout(() => {
          if (this.signIns.last() === last) this.signIns.clearLast();
        }, SIGNED_IN_NOTE_MS);
      }
    });
    destroyRef.onDestroy(() => {
      stopTick();
      if (noteTimer !== undefined) clearTimeout(noteTimer);
    });
  }

  protected hide(promptId: string): void {
    this.signIns.dismiss(promptId);
  }

  protected async copy(text: string, what: 'url' | 'code'): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.copied.set(what);
    } catch {
      this.copied.set('failed');
    }
  }
}
