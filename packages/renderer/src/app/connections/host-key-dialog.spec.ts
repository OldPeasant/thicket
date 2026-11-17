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
