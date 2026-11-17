import { sshHostKeyPrompt, type SshHostKeyPrompt } from '@thicket/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RpcError } from '../server/rpc';
import { sshHandlers } from './handlers';
import { HOST_KEY_PROMPT_TIMEOUT_MS, HostKeyPrompts } from './prompts';
import type { HostKeyQuestion } from './tunnel';

const QUESTION: HostKeyQuestion = {
  host: 'bastion.example.test',
  port: 2222,
  keyType: 'ssh-ed25519',
  fingerprint: 'SHA256:ZmljdGl0aW91cy1maW5nZXJwcmludA',
};

/** Prompts whose `emit` records what it sent and reports `receivers` renderers. */
function prompts(receivers = 1, timeoutMS?: number) {
  const sent: SshHostKeyPrompt[] = [];
  const emit = vi.fn((prompt: SshHostKeyPrompt) => {
    sent.push(prompt);
    return receivers;
  });
  return { sent, emit, prompts: new HostKeyPrompts(emit, timeoutMS) };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('HostKeyPrompts', () => {
  it('broadcasts a contract-valid prompt and resolves with the answer (trust)', async () => {
    const { sent, prompts: p } = prompts();
    const answer = p.ask(QUESTION, new AbortController().signal);
    expect(sent).toHaveLength(1);
    const prompt = sent[0];
    expect(prompt).toEqual({
      ...QUESTION,
      promptId: expect.any(String) as unknown,
      timeoutMS: HOST_KEY_PROMPT_TIMEOUT_MS,
    });
    expect(sshHostKeyPrompt.safeParse(prompt).success).toBe(true);
    expect(p.open).toBe(1);
    p.answer(prompt?.promptId ?? '', true);
    await expect(answer).resolves.toBe(true);
    expect(p.open).toBe(0);
  });

  it('resolves false when the user declines', async () => {
    const { sent, prompts: p } = prompts();
    const answer = p.ask(QUESTION, new AbortController().signal);
    p.answer(sent[0]?.promptId ?? '', false);
    await expect(answer).resolves.toBe(false);
  });

  it('the default timeout is 5 minutes', () => {
    expect(HOST_KEY_PROMPT_TIMEOUT_MS).toBe(300_000);
  });

  it('times out as "no" after timeoutMS (not before); a late answer is NOT_FOUND', async () => {
    const { sent, prompts: p } = prompts(1, 1_000);
    const settled = vi.fn();
    const answer = p.ask(QUESTION, new AbortController().signal).then(settled);
    expect(sent[0]?.timeoutMS).toBe(1_000);
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await answer;
    expect(settled).toHaveBeenCalledWith(false);
    expect(p.open).toBe(0);
    expect(() => {
      p.answer(sent[0]?.promptId ?? '', true);
    }).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }) as Error);
  });

  it('an abort ends the question as "no"; answering it afterwards is NOT_FOUND', async () => {
    const { sent, prompts: p } = prompts();
    const controller = new AbortController();
    const answer = p.ask(QUESTION, controller.signal);
    controller.abort();
    await expect(answer).resolves.toBe(false);
    expect(p.open).toBe(0);
    expect(() => {
      p.answer(sent[0]?.promptId ?? '', true);
    }).toThrow(RpcError);
  });

  it('an already aborted signal answers "no" without broadcasting', async () => {
    const { emit, prompts: p } = prompts();
    const controller = new AbortController();
    controller.abort();
    await expect(p.ask(QUESTION, controller.signal)).resolves.toBe(false);
    expect(emit).not.toHaveBeenCalled();
    expect(p.open).toBe(0);
  });

  it('without a renderer to ask the answer is "no" at once', async () => {
    const { emit, sent, prompts: p } = prompts(0);
    await expect(p.ask(QUESTION, new AbortController().signal)).resolves.toBe(false);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(p.open).toBe(0);
    expect(() => {
      p.answer(sent[0]?.promptId ?? '', true);
    }).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }) as Error);
    // No timer left behind.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('only the first answer counts; a second one is NOT_FOUND', async () => {
    const { sent, prompts: p } = prompts();
    const answer = p.ask(QUESTION, new AbortController().signal);
    const id = sent[0]?.promptId ?? '';
    p.answer(id, false);
    expect(() => {
      p.answer(id, true);
    }).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }) as Error);
    await expect(answer).resolves.toBe(false);
  });

  it('an unknown prompt id is NOT_FOUND', () => {
    const { prompts: p } = prompts();
    expect(() => {
      p.answer('no-such-prompt', true);
    }).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }) as Error);
  });

  it('keeps concurrent questions apart, each with its own id', async () => {
    const { sent, prompts: p } = prompts();
    const first = p.ask(QUESTION, new AbortController().signal);
    const second = p.ask({ ...QUESTION, host: 'jump.example.test' }, new AbortController().signal);
    expect(sent[0]?.promptId).not.toBe(sent[1]?.promptId);
    expect(p.open).toBe(2);
    p.answer(sent[1]?.promptId ?? '', true);
    await expect(second).resolves.toBe(true);
    expect(p.open).toBe(1);
    p.answer(sent[0]?.promptId ?? '', false);
    await expect(first).resolves.toBe(false);
  });

  it('cleans up its timer and abort listener after an answer', async () => {
    const { sent, prompts: p } = prompts();
    const controller = new AbortController();
    const removed = vi.spyOn(controller.signal, 'removeEventListener');
    const answer = p.ask(QUESTION, controller.signal);
    expect(vi.getTimerCount()).toBe(1);
    p.answer(sent[0]?.promptId ?? '', true);
    await answer;
    expect(vi.getTimerCount()).toBe(0);
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
    controller.abort(); // after the answer: nothing happens
    await expect(answer).resolves.toBe(true);
  });
});

describe('sshHandlers: conn.trustHostKey', () => {
  it('passes the answer to the open question and returns {}', async () => {
    const { sent, prompts: p } = prompts();
    const handlers = sshHandlers(p);
    const answer = p.ask(QUESTION, new AbortController().signal);
    const handler = handlers['conn.trustHostKey'] as (params: {
      promptId: string;
      trust: boolean;
    }) => unknown;
    expect(handler({ promptId: sent[0]?.promptId ?? '', trust: true })).toEqual({});
    await expect(answer).resolves.toBe(true);
  });

  it('answers NOT_FOUND for a question that is no longer open', () => {
    const { prompts: p } = prompts();
    const handler = sshHandlers(p)['conn.trustHostKey'] as (params: {
      promptId: string;
      trust: boolean;
    }) => unknown;
    expect(() => handler({ promptId: 'gone', trust: false })).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }) as Error,
    );
  });
});
