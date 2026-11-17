import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { BROADCAST_STREAMS, type SshHostKeyPrompt } from '@thicket/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import { HostKeyDialog } from './host-key-dialog';

const prompt = (extra: Partial<SshHostKeyPrompt> = {}): SshHostKeyPrompt => ({
  promptId: 'k1',
  host: 'bastion.example',
  port: 2222,
  keyType: 'ssh-ed25519',
  fingerprint: 'SHA256:fictitiousFingerprintAbc123',
  timeoutMS: 300_000,
  ...extra,
});

describe('HostKeyDialog', () => {
  let fake: FakeThicketBridge;
  let fixture: ComponentFixture<HostKeyDialog>;
  let el: HTMLElement;

  beforeEach(async () => {
    fake = new FakeThicketBridge();
    fake.respond('conn.trustHostKey', {});
    TestBed.configureTestingModule({ providers: [provideFakeThicket(fake)] });
    fixture = TestBed.createComponent(HostKeyDialog);
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

  async function ask(p: SshHostKeyPrompt): Promise<void> {
    fake.emit({ stream: BROADCAST_STREAMS.sshHostKey, kind: 'data', payload: p });
    await settle();
  }

  it('shows nothing until the backend asks', () => {
    expect(find('host-key-dialog')).toBeNull();
  });

  it('shows host, key type and fingerprint; focuses "Don\'t trust"', async () => {
    await ask(prompt());
    expect(must('host-key-host').textContent).toBe('bastion.example:2222');
    expect(must('host-key-type').textContent).toBe('ssh-ed25519');
    expect(must('host-key-fingerprint').textContent?.trim()).toBe(
      'SHA256:fictitiousFingerprintAbc123',
    );
    expect(document.activeElement).toBe(must('host-key-reject'));
  });

  it('leaves out port 22 and brackets IPv6 hosts', async () => {
    await ask(prompt({ port: 22 }));
    expect(must('host-key-host').textContent).toBe('bastion.example');
    must('host-key-trust').click();
    await settle();
    await ask(prompt({ promptId: 'k2', host: '::1', port: 2222 }));
    expect(must('host-key-host').textContent).toBe('[::1]:2222');
  });

  it('trust answers conn.trustHostKey with trust: true and closes', async () => {
    await ask(prompt());
    must('host-key-trust').click();
    await settle();
    expect(fake.requestsFor('conn.trustHostKey').map((r) => r.params)).toEqual([
      { promptId: 'k1', trust: true },
    ]);
    expect(find('host-key-dialog')).toBeNull();
  });

  it('"Don\'t trust" and Escape answer trust: false', async () => {
    await ask(prompt());
    must('host-key-reject').click();
    await settle();
    await ask(prompt({ promptId: 'k2' }));
    must('host-key-dialog').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await settle();
    expect(fake.requestsFor('conn.trustHostKey').map((r) => r.params)).toEqual([
      { promptId: 'k1', trust: false },
      { promptId: 'k2', trust: false },
    ]);
    expect(find('host-key-dialog')).toBeNull();
  });

  it('asks queued questions one after the other and ignores a repeated one', async () => {
    await ask(prompt());
    await ask(prompt());
    await ask(prompt({ promptId: 'k2', host: 'other.example' }));
    must('host-key-trust').click();
    await settle();
    expect(must('host-key-host').textContent).toBe('other.example:2222');
    must('host-key-trust').click();
    await settle();
    expect(find('host-key-dialog')).toBeNull();
    expect(fake.requestsFor('conn.trustHostKey')).toHaveLength(2);
  });

  it('closes when the question is no longer open (NOT_FOUND)', async () => {
    fake.fail('conn.trustHostKey', { code: 'NOT_FOUND', message: 'no such prompt' });
    await ask(prompt());
    must('host-key-trust').click();
    await settle();
    expect(find('host-key-dialog')).toBeNull();
  });

  it('keeps the question and shows other errors', async () => {
    fake.fail('conn.trustHostKey', { code: 'INTERNAL', message: 'known_hosts not writable' });
    await ask(prompt());
    must('host-key-trust').click();
    await settle();
    expect(must('host-key-error').textContent).toContain('known_hosts not writable');
    expect(must('host-key-trust').hasAttribute('disabled')).toBe(false);
  });

  it('keeps the focus in the dialog while busy and puts it on "Don\'t trust" after an error', async () => {
    let fail: (() => void) | undefined;
    fake.handle(
      'conn.trustHostKey',
      () =>
        new Promise((_resolve, reject) => {
          fail = () => {
            reject(new Error('known_hosts not writable'));
          };
        }),
    );
    await ask(prompt());
    const trust = must('host-key-trust');
    trust.focus();
    trust.click();
    await settle();
    expect(trust.hasAttribute('disabled')).toBe(true);
    expect(document.activeElement).toBe(must('host-key-dialog'));
    fail?.();
    await settle();
    expect(find('host-key-error')).not.toBeNull();
    expect(document.activeElement).toBe(must('host-key-reject'));
    // Escape works again from there.
    fake.respond('conn.trustHostKey', {});
    must('host-key-reject').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await settle();
    expect(find('host-key-dialog')).toBeNull();
  });

  describe('test-writer', () => {
    const tab = (shiftKey = false) => {
      const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey,
        bubbles: true,
        cancelable: true,
      });
      must('host-key-dialog').dispatchEvent(event);
      return event;
    };

    it('Tab and Shift+Tab stay inside the dialog', async () => {
      await ask(prompt());
      const fingerprint = must('host-key-fingerprint');
      const trust = must('host-key-trust');
      trust.focus();
      expect(tab().defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(fingerprint);
      expect(tab(true).defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(trust);
      // In the middle, Tab is left to the browser.
      must('host-key-reject').focus();
      expect(tab().defaultPrevented).toBe(false);
      expect(tab(true).defaultPrevented).toBe(false);
    });

    it('gives the focus back to where it was when the dialog closes', async () => {
      const before = document.createElement('button');
      document.body.append(before);
      before.focus();
      try {
        await ask(prompt());
        expect(document.activeElement).toBe(must('host-key-reject'));
        must('host-key-reject').click();
        await settle();
        expect(find('host-key-dialog')).toBeNull();
        expect(document.activeElement).toBe(before);
      } finally {
        before.remove();
      }
    });

    it('keeps the buttons disabled while the answer is sent; a second click sends nothing', async () => {
      let release: (() => void) | undefined;
      fake.handle(
        'conn.trustHostKey',
        () =>
          new Promise((resolve) => {
            release = () => resolve({});
          }),
      );
      await ask(prompt());
      must('host-key-trust').click();
      await settle();
      expect(must('host-key-trust').hasAttribute('disabled')).toBe(true);
      expect(must('host-key-reject').hasAttribute('disabled')).toBe(true);
      must('host-key-dialog').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      await settle();
      expect(fake.requestsFor('conn.trustHostKey')).toHaveLength(1);
      release?.();
      await settle();
      expect(find('host-key-dialog')).toBeNull();
    });

    it('a retry after an error clears the error and can succeed', async () => {
      fake.fail('conn.trustHostKey', { code: 'INTERNAL', message: 'known_hosts not writable' });
      await ask(prompt());
      must('host-key-trust').click();
      await settle();
      expect(find('host-key-error')).not.toBeNull();
      fake.respond('conn.trustHostKey', {});
      must('host-key-trust').click();
      await settle();
      expect(find('host-key-dialog')).toBeNull();
      expect(fake.requestsFor('conn.trustHostKey').map((r) => r.params)).toEqual([
        { promptId: 'k1', trust: true },
        { promptId: 'k1', trust: true },
      ]);
    });

    it('a fingerprint without an algorithm prefix is shown whole', async () => {
      await ask(prompt({ fingerprint: 'fictitiousDigestOnly' }));
      expect(must('host-key-fingerprint').textContent?.trim()).toBe('fictitiousDigestOnly');
    });

    it('when the shown question times out, the next queued one is shown', async () => {
      vi.useFakeTimers();
      fake.emit({
        stream: BROADCAST_STREAMS.sshHostKey,
        kind: 'data',
        payload: prompt({ timeoutMS: 1000 }),
      });
      fake.emit({
        stream: BROADCAST_STREAMS.sshHostKey,
        kind: 'data',
        payload: prompt({ promptId: 'k2', host: 'other.example', timeoutMS: 60_000 }),
      });
      fixture.detectChanges();
      expect(must('host-key-host').textContent).toBe('bastion.example:2222');
      vi.advanceTimersByTime(1001);
      fixture.detectChanges();
      expect(must('host-key-host').textContent).toBe('other.example:2222');
    });
  });

  it('drops a question when its time runs out', async () => {
    vi.useFakeTimers();
    fake.emit({
      stream: BROADCAST_STREAMS.sshHostKey,
      kind: 'data',
      payload: prompt({ timeoutMS: 1000 }),
    });
    fixture.detectChanges();
    expect(find('host-key-dialog')).not.toBeNull();
    vi.advanceTimersByTime(1001);
    fixture.detectChanges();
    expect(find('host-key-dialog')).toBeNull();
    expect(fake.requestsFor('conn.trustHostKey')).toHaveLength(0);
  });
});
