import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { BROADCAST_STREAMS, type OidcPrompt } from '@thicket/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import { OidcSignIn } from './oidc-sign-in';
import { OidcSignInService } from './oidc-sign-in.service';

/** Fixed clock for the device-code expiry. */
const NOW = Date.parse('2030-04-05T06:07:08Z');

const browser = (extra: Partial<OidcPrompt & { kind: 'browser' }> = {}): OidcPrompt => ({
  kind: 'browser',
  promptId: 'o1',
  profileId: 'p1',
  profileName: 'Fictitious Cluster',
  url: 'https://idp.example.test/authorize?client_id=fictitious',
  ...extra,
});

const device = (extra: Partial<OidcPrompt & { kind: 'device' }> = {}): OidcPrompt => ({
  kind: 'device',
  promptId: 'o1',
  profileId: 'p1',
  profileName: 'Fictitious Cluster',
  verificationUri: 'https://idp.example.test/device',
  userCode: 'WDJB-MJHT',
  expiresInSeconds: 600,
  ...extra,
});

const finished = (ok: boolean, promptId = 'o1'): OidcPrompt => ({
  kind: 'finished',
  promptId,
  profileId: 'p1',
  profileName: 'Fictitious Cluster',
  ok,
});

function emitTo(fake: FakeThicketBridge, prompt: OidcPrompt): void {
  fake.emit({ stream: BROADCAST_STREAMS.oidcPrompt, kind: 'data', payload: prompt });
}

describe('OidcSignInService', () => {
  let fake: FakeThicketBridge;
  let service: OidcSignInService;

  beforeEach(() => {
    fake = new FakeThicketBridge();
    TestBed.configureTestingModule({ providers: [provideFakeThicket(fake)] });
    service = TestBed.inject(OidcSignInService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts without a sign-in', () => {
    expect(service.current()).toBeNull();
    expect(service.count()).toBe(0);
    expect(service.last()).toBeNull();
  });

  it('shows a browser prompt as it came (no expiry)', () => {
    emitTo(fake, browser());
    expect(service.current()).toEqual(browser());
    expect(service.current()?.expiresAt).toBeUndefined();
    expect(service.count()).toBe(1);
  });

  it('ignores other broadcast streams and non-data events', () => {
    fake.emit({ stream: BROADCAST_STREAMS.sshHostKey, kind: 'data', payload: browser() });
    fake.emit({ stream: BROADCAST_STREAMS.oidcPrompt, kind: 'end', payload: { delivered: 0 } });
    expect(service.current()).toBeNull();
  });

  it('a device prompt gets its expiry time', () => {
    vi.useFakeTimers({ now: NOW });
    emitTo(fake, device({ expiresInSeconds: 300 }));
    expect(service.current()).toEqual({
      ...device({ expiresInSeconds: 300 }),
      expiresAt: NOW + 300_000,
    });
  });

  it('a device fallback with the same promptId replaces the browser prompt', () => {
    emitTo(fake, browser());
    emitTo(fake, device());
    expect(service.count()).toBe(1);
    expect(service.current()?.kind).toBe('device');
  });

  it('the same prompt sent twice is shown once', () => {
    emitTo(fake, browser());
    emitTo(fake, browser());
    expect(service.count()).toBe(1);
  });

  it('shows the latest of several sign-ins; hiding it shows the one before', () => {
    emitTo(fake, browser());
    emitTo(fake, device({ promptId: 'o2', profileName: 'Second Cluster' }));
    expect(service.count()).toBe(2);
    expect(service.current()?.promptId).toBe('o2');
    service.dismiss('o2');
    expect(service.current()?.promptId).toBe('o1');
    expect(service.count()).toBe(1);
  });

  it('finished removes the sign-in and records how it ended', () => {
    emitTo(fake, browser());
    emitTo(fake, finished(true));
    expect(service.current()).toBeNull();
    expect(service.last()).toEqual({ promptId: 'o1', profileName: 'Fictitious Cluster', ok: true });
    service.clearLast();
    expect(service.last()).toBeNull();
  });

  it('a failed sign-in is recorded as not ok', () => {
    emitTo(fake, device());
    emitTo(fake, finished(false));
    expect(service.current()).toBeNull();
    expect(service.last()?.ok).toBe(false);
  });

  it('finished for an unknown or hidden sign-in records nothing', () => {
    emitTo(fake, finished(true, 'unknown'));
    expect(service.last()).toBeNull();
    emitTo(fake, browser());
    service.dismiss('o1');
    expect(service.current()).toBeNull();
    emitTo(fake, finished(true));
    expect(service.last()).toBeNull();
  });

  it('finished of one sign-in leaves the others waiting', () => {
    emitTo(fake, browser());
    emitTo(fake, browser({ promptId: 'o2' }));
    emitTo(fake, finished(true, 'o2'));
    expect(service.current()?.promptId).toBe('o1');
    expect(service.last()?.promptId).toBe('o2');
  });

  it('a new sign-in clears the note of the last one', () => {
    emitTo(fake, browser());
    emitTo(fake, finished(false));
    emitTo(fake, browser({ promptId: 'o2' }));
    expect(service.last()).toBeNull();
  });

  it('a device code disappears when it expires', () => {
    vi.useFakeTimers({ now: NOW });
    emitTo(fake, device({ expiresInSeconds: 60 }));
    vi.advanceTimersByTime(59_999);
    expect(service.current()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(service.current()).toBeNull();
    expect(service.last()).toBeNull();
  });

  it('a hidden device code leaves no timer behind', () => {
    vi.useFakeTimers({ now: NOW });
    emitTo(fake, device({ expiresInSeconds: 60 }));
    service.dismiss('o1');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a replaced device prompt does not expire on the old timer', () => {
    vi.useFakeTimers({ now: NOW });
    emitTo(fake, device({ expiresInSeconds: 60 }));
    emitTo(fake, device({ expiresInSeconds: 600, userCode: 'NEWC-ODE1' }));
    vi.advanceTimersByTime(61_000);
    expect(service.current()).toMatchObject({ userCode: 'NEWC-ODE1' });
    expect(vi.getTimerCount()).toBe(1);
  });

  it('a browser prompt replacing a device prompt cancels its expiry', () => {
    vi.useFakeTimers({ now: NOW });
    emitTo(fake, device({ expiresInSeconds: 60 }));
    emitTo(fake, browser());
    vi.advanceTimersByTime(61_000);
    expect(service.current()?.kind).toBe('browser');
  });

  it('stops listening and clears its timers when destroyed', () => {
    vi.useFakeTimers({ now: NOW });
    const before = fake.listenerCount;
    emitTo(fake, device({ expiresInSeconds: 60 }));
    expect(vi.getTimerCount()).toBe(1);
    TestBed.resetTestingModule();
    expect(fake.listenerCount).toBe(before - 1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('OidcSignIn panel', () => {
  let fake: FakeThicketBridge;
  let fixture: ComponentFixture<OidcSignIn>;
  let el: HTMLElement;
  let copied: string[];

  beforeEach(async () => {
    fake = new FakeThicketBridge();
    copied = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          copied.push(text);
          return Promise.resolve();
        },
      },
    });
    TestBed.configureTestingModule({ providers: [provideFakeThicket(fake)] });
    fixture = TestBed.createComponent(OidcSignIn);
    el = fixture.nativeElement as HTMLElement;
    document.body.append(el);
    await settle();
  });

  afterEach(() => {
    el.remove();
    vi.useRealTimers();
  });

  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await fixture.whenStable();
      await new Promise((r) => setTimeout(r));
    }
  }

  const find = (id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const must = (id: string): HTMLElement => {
    const found = find(id);
    if (!found) throw new Error(`no ${id}`);
    return found;
  };
  const text = (id: string) => must(id).textContent?.replace(/\s+/g, ' ').trim();

  async function send(prompt: OidcPrompt): Promise<void> {
    emitTo(fake, prompt);
    await settle();
  }

  /** With fake timers: emit and render synchronously. */
  function sendNow(prompt: OidcPrompt): void {
    emitTo(fake, prompt);
    fixture.detectChanges();
  }

  it('shows nothing while no sign-in waits', () => {
    expect(find('oidc-sign-in')).toBeNull();
    expect(find('oidc-result')).toBeNull();
  });

  it('browser prompt: profile name, "finish in your browser", copy link', async () => {
    await send(browser());
    const panel = must('oidc-sign-in');
    expect(panel.getAttribute('data-kind')).toBe('browser');
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('false');
    expect(text('oidc-profile')).toBe('Fictitious Cluster');
    expect(panel.textContent).toContain(
      'Finish signing in on the page that opened in your browser',
    );
    expect(find('oidc-user-code')).toBeNull();
    must('oidc-copy-url').click();
    await settle();
    expect(copied).toEqual(['https://idp.example.test/authorize?client_id=fictitious']);
    expect(text('oidc-copy-url')).toBe('Link copied');
  });

  it('device prompt: code, verification page, expiry and copy buttons', async () => {
    await send(device());
    expect(must('oidc-sign-in').getAttribute('data-kind')).toBe('device');
    expect(text('oidc-user-code')).toBe('WDJB-MJHT');
    expect(text('oidc-verification-uri')).toBe('https://idp.example.test/device');
    expect(text('oidc-expiry')).toBe('The code expires in 10 minutes.');
    must('oidc-copy-code').click();
    await settle();
    expect(text('oidc-copy-code')).toBe('Code copied');
    must('oidc-copy-uri').click();
    await settle();
    expect(text('oidc-copy-uri')).toBe('Link copied');
    expect(copied).toEqual(['WDJB-MJHT', 'https://idp.example.test/device']);
  });

  it('device prompt: "Copy link" copies the complete verification URI when there is one', async () => {
    await send(
      device({ verificationUriComplete: 'https://idp.example.test/device?user_code=WDJB-MJHT' }),
    );
    // The page shown is the plain one; the code is entered there.
    expect(text('oidc-verification-uri')).toBe('https://idp.example.test/device');
    must('oidc-copy-uri').click();
    await settle();
    expect(copied).toEqual(['https://idp.example.test/device?user_code=WDJB-MJHT']);
  });

  it('a refused clipboard says so and claims nothing was copied', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('denied')) },
    });
    await send(device());
    must('oidc-copy-code').click();
    await settle();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('clipboard is not available');
    expect(text('oidc-copy-code')).toBe('Copy code');
  });

  it('browser → device fallback (same promptId) replaces the panel content', async () => {
    await send(browser());
    must('oidc-copy-url').click();
    await settle();
    await send(device());
    expect(find('oidc-copy-url')).toBeNull();
    expect(text('oidc-user-code')).toBe('WDJB-MJHT');
    // The "copied" state of the browser prompt does not carry over.
    expect(text('oidc-copy-uri')).toBe('Copy link');
    expect(el.querySelectorAll('[data-testid="oidc-sign-in"]')).toHaveLength(1);
  });

  it('Hide hides the panel without a note', async () => {
    await send(browser());
    must('oidc-hide').click();
    await settle();
    expect(find('oidc-sign-in')).toBeNull();
    expect(find('oidc-result')).toBeNull();
    // A later finished of the hidden sign-in shows nothing either.
    await send(finished(true));
    expect(find('oidc-result')).toBeNull();
  });

  it('Hide on a device prompt hides it', async () => {
    await send(device());
    must('oidc-hide').click();
    await settle();
    expect(find('oidc-sign-in')).toBeNull();
  });

  it('finished ok: the panel goes, "Signed in" shows and goes away on its own', async () => {
    vi.useFakeTimers({ now: NOW });
    sendNow(browser());
    expect(find('oidc-sign-in')).not.toBeNull();
    sendNow(finished(true));
    expect(find('oidc-sign-in')).toBeNull();
    expect(must('oidc-result').getAttribute('data-ok')).toBe('true');
    expect(must('oidc-result').getAttribute('role')).toBe('status');
    expect(text('oidc-result')).toContain('Signed in to Fictitious Cluster.');
    vi.advanceTimersByTime(3999);
    fixture.detectChanges();
    expect(find('oidc-result')).not.toBeNull();
    vi.advanceTimersByTime(1);
    fixture.detectChanges();
    expect(find('oidc-result')).toBeNull();
  });

  it('a second "Signed in" note gets its own full time', () => {
    vi.useFakeTimers({ now: NOW });
    sendNow(browser());
    sendNow(finished(true));
    vi.advanceTimersByTime(3000);
    sendNow(browser({ promptId: 'o2', profileName: 'Second Cluster' }));
    sendNow({ ...finished(true, 'o2'), profileName: 'Second Cluster' });
    expect(text('oidc-result')).toContain('Signed in to Second Cluster.');
    // The first note's timer would have fired at 4 s; the second note stays until 7 s.
    vi.advanceTimersByTime(3999);
    fixture.detectChanges();
    expect(find('oidc-result')).not.toBeNull();
    vi.advanceTimersByTime(1);
    fixture.detectChanges();
    expect(find('oidc-result')).toBeNull();
  });

  it('leaves no timer running when destroyed while a device code or a note is shown', () => {
    vi.useFakeTimers({ now: NOW });
    sendNow(device());
    sendNow(finished(true));
    sendNow(device({ promptId: 'o2' }));
    // Expiry of o2 (service), countdown tick (panel).
    expect(vi.getTimerCount()).toBe(2);
    sendNow(finished(true, 'o2'));
    // Only the "Signed in" note timer is left.
    expect(vi.getTimerCount()).toBe(1);
    fixture.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('finished failed: the note stays until it is closed', async () => {
    vi.useFakeTimers({ now: NOW });
    sendNow(device());
    sendNow(finished(false));
    const note = must('oidc-result');
    expect(note.getAttribute('data-ok')).toBe('false');
    expect(note.classList.contains('failed')).toBe(true);
    expect(text('oidc-result')).toContain('Signing in to Fictitious Cluster did not finish');
    vi.advanceTimersByTime(60_000);
    fixture.detectChanges();
    expect(find('oidc-result')).not.toBeNull();
    must('oidc-result-close').click();
    fixture.detectChanges();
    expect(find('oidc-result')).toBeNull();
  });

  it('a new sign-in replaces the note', async () => {
    await send(browser());
    await send(finished(false));
    expect(find('oidc-result')).not.toBeNull();
    await send(browser({ promptId: 'o2' }));
    expect(find('oidc-result')).toBeNull();
    expect(find('oidc-sign-in')).not.toBeNull();
  });

  it('device code: the expiry counts down, in seconds below two minutes, then the panel goes', () => {
    vi.useFakeTimers({ now: NOW });
    sendNow(device({ expiresInSeconds: 180 }));
    expect(text('oidc-expiry')).toBe('The code expires in 3 minutes.');
    vi.advanceTimersByTime(30_000);
    fixture.detectChanges();
    // 150 s left: rounded up to whole minutes.
    expect(text('oidc-expiry')).toBe('The code expires in 3 minutes.');
    vi.advanceTimersByTime(30_000);
    fixture.detectChanges();
    // 120 s left: still minutes.
    expect(text('oidc-expiry')).toBe('The code expires in 2 minutes.');
    vi.advanceTimersByTime(1000);
    fixture.detectChanges();
    expect(text('oidc-expiry')).toBe('The code expires in 119 seconds.');
    vi.advanceTimersByTime(117_000);
    fixture.detectChanges();
    expect(text('oidc-expiry')).toBe('The code expires in 2 seconds.');
    vi.advanceTimersByTime(2000);
    fixture.detectChanges();
    expect(find('oidc-sign-in')).toBeNull();
    expect(find('oidc-result')).toBeNull();
    // No ticking interval is left once the code is gone.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('no countdown for the browser flow', () => {
    vi.useFakeTimers({ now: NOW });
    sendNow(browser());
    expect(find('oidc-expiry')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
