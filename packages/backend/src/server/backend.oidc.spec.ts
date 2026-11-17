import {
  BROADCAST_STREAMS,
  oidcPrompt,
  privilegedMethods,
  type Event,
  type OidcPrompt,
  type Profile,
  type Response,
} from '@thicket/contract';
import { describe, expect, it, vi } from 'vitest';

import type { OidcEnvironment } from '../auth/oidc';
import { startBackend, type ParentPortLike } from './backend';
import type { MainPortLike } from './ports';
import { RpcError, serve, type Port } from './rpc';
import { portPair } from './testing';

// startBackend builds its OidcAuthenticator internally: record the environment it is given (the
// real authenticator still runs) to check how it reaches main and the renderers.
const captured = vi.hoisted(() => ({ envs: [] as unknown[] }));
vi.mock('../auth/oidc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth/oidc')>();
  class RecordingAuthenticator extends actual.OidcAuthenticator {
    constructor(env: OidcEnvironment) {
      super(env);
      captured.envs.push(env);
    }
  }
  return { ...actual, OidcAuthenticator: RecordingAuthenticator };
});

/** A `MainPortLike` over one end of an in-memory pair. */
function mainPort(port: Port): MainPortLike & { closeListeners: (() => void)[] } {
  const listeners = new Map<unknown, () => void>();
  const closeListeners: (() => void)[] = [];
  return {
    closeListeners,
    postMessage: (message) => port.send(message),
    on(event: 'message' | 'close', listener: ((e: { data: unknown }) => void) | (() => void)) {
      if (event === 'close') closeListeners.push(listener as () => void);
      else
        listeners.set(
          listener,
          port.onMessage((data) => listener({ data } as never)),
        );
      return this;
    },
    off(_event: 'message', listener: unknown) {
      listeners.get(listener)?.();
      return this;
    },
    start: () => undefined,
    close: () => port.close(),
  };
}

/** Fictitious MONGODB-OIDC profile on 127.0.0.2 (not in the driver's default ALLOWED_HOSTS). */
const OIDC_PROFILE: Profile = {
  id: 'oidc-1',
  name: 'Fictitious OIDC',
  connectionString: 'mongodb://127.0.0.2:9/?connectTimeoutMS=300',
  auth: { mechanism: 'MONGODB-OIDC', secretMode: 'none' },
  serverSelectionTimeoutMS: 300,
  readOnly: false,
  production: false,
};

/** A backend with a fake main; answers what main received for the oidc.* privileged calls. */
function oidcBackend(main: { openBrowser?: (url: string) => unknown } = {}) {
  let deliver: ((e: { data: unknown; ports: MainPortLike[] }) => void) | undefined;
  const parentPort: ParentPortLike = {
    on: (_event, listener) => {
      deliver = listener;
    },
  };
  const before = captured.envs.length;
  startBackend({ parentPort, pid: 5, log: vi.fn() });
  expect(captured.envs).toHaveLength(before + 1);
  const env = captured.envs[before] as OidcEnvironment;

  const calls: { method: string; params: unknown }[] = [];
  const [mainEnd, backendEnd] = portPair();
  serve(mainEnd, {
    table: privilegedMethods,
    route: 'main',
    handlers: {
      'profiles.forConnect': () => ({ profile: OIDC_PROFILE }),
      'secrets.get': () => ({ secrets: null }),
      'oidc.openBrowser': (params: { url: string }) => {
        calls.push({ method: 'oidc.openBrowser', params });
        return main.openBrowser ? main.openBrowser(params.url) : {};
      },
      'oidc.saveTokens': (params: unknown) => {
        calls.push({ method: 'oidc.saveTokens', params });
        return { saved: true };
      },
    },
  });
  deliver?.({ data: { type: 'privileged' }, ports: [mainPort(backendEnd)] });

  const connectRenderer = (window: number) => {
    const [renderer, backendSide] = portPair();
    const wrapped = mainPort(backendSide);
    deliver?.({ data: { type: 'renderer', window }, ports: [wrapped] });
    const messages: unknown[] = [];
    renderer.onMessage((m) => messages.push(m));
    return {
      renderer,
      prompts: () =>
        messages.filter((m) => (m as Event).stream === BROADCAST_STREAMS.oidcPrompt) as Event[],
      answer: async (id: string) => {
        await vi.waitFor(
          () => expect(messages.find((m) => (m as Response).id === id)).toBeDefined(),
          { timeout: 5_000 },
        );
        return messages.find((m) => (m as Response).id === id) as Response;
      },
      disconnect: () => {
        for (const listener of wrapped.closeListeners) listener();
      },
    };
  };
  return { env, calls, connectRenderer };
}

describe('startBackend: MONGODB-OIDC wiring (task oidc-auth)', () => {
  it('openBrowser asks main to open the URL over the privileged port', async () => {
    const b = oidcBackend();
    const url = 'https://idp.example.test/auth?client_id=thicket-test&state=s1';
    await expect(b.env.openBrowser(url)).resolves.toBeUndefined();
    expect(b.calls).toEqual([{ method: 'oidc.openBrowser', params: { url } }]);
  });

  it("main's refusal to open the browser rejects openBrowser (the device-flow fallback sees it)", async () => {
    const b = oidcBackend({
      openBrowser: () => {
        throw new RpcError('UNSUPPORTED', 'no handler for https');
      },
    });
    await expect(b.env.openBrowser('https://idp.example.test/auth')).rejects.toMatchObject({
      code: 'UNSUPPORTED',
    });
  });

  it('saveTokens asks main to store, and with null to clear, the profile token cache', async () => {
    const b = oidcBackend();
    await b.env.saveTokens('oidc-1', '{"v":1,"fictitious":"cache"}');
    await b.env.saveTokens('oidc-1', null);
    expect(b.calls).toEqual([
      {
        method: 'oidc.saveTokens',
        params: { profileId: 'oidc-1', tokens: '{"v":1,"fictitious":"cache"}' },
      },
      { method: 'oidc.saveTokens', params: { profileId: 'oidc-1', tokens: null } },
    ]);
  });

  it('prompt broadcasts oidc.prompt to every connected renderer, not to closed ones', async () => {
    const b = oidcBackend();
    const one = b.connectRenderer(1);
    const two = b.connectRenderer(2);
    const gone = b.connectRenderer(3);
    gone.disconnect();
    const prompt: OidcPrompt = {
      promptId: 'prompt-1',
      profileId: 'oidc-1',
      profileName: 'Fictitious OIDC',
      kind: 'device',
      verificationUri: 'https://idp.example.test/device',
      userCode: 'FICT-CODE',
      expiresInSeconds: 300,
    };
    b.env.prompt?.(prompt);
    await vi.waitFor(() => expect(one.prompts()).toHaveLength(1));
    await vi.waitFor(() => expect(two.prompts()).toHaveLength(1));
    const event = two.prompts()[0];
    expect(event).toMatchObject({ stream: 'oidc.prompt', kind: 'data' });
    expect(oidcPrompt.parse(event?.payload)).toEqual(prompt);
    expect(gone.prompts()).toEqual([]);
  });

  it('conn.open of an OIDC profile reaches the driver with the authenticator (not UNSUPPORTED)', async () => {
    const b = oidcBackend();
    const r = b.connectRenderer(1);
    r.renderer.send({ id: 'o', method: 'conn.open', params: { profileId: 'oidc-1' } });
    const answer = await r.answer('o');
    // The driver's host check refuses 127.0.0.2 before any sign-in: no browser, no tokens.
    expect(answer).toMatchObject({ ok: false, error: { code: 'AUTH_FAILED' } });
    expect(answer.ok ? '' : answer.error.message).toContain('oidcTrustedEndpoint');
    expect(b.calls).toEqual([]);
  });
});
