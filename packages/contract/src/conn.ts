import { z } from 'zod';

import { ejsonDocument, emptyResult, profileId } from './common';
import { defineMethods } from './define';
import { errorSummary } from './errors';
import { profileDraft } from './profiles';

/**
 * Connections. One open connection per profile, keyed by `profileId`. Secrets for saved
 * profiles are fetched by the backend from `main`; `password` is only sent for profiles
 * whose secret mode is "ask".
 */

export const CONN_STATES = ['connecting', 'connected', 'disconnected', 'error'] as const;

export const TOPOLOGIES = [
  'standalone',
  'replicaSet',
  'sharded',
  'loadBalanced',
  'unknown',
] as const;

export const connStatus = z.object({
  profileId,
  state: z.enum(CONN_STATES),
  /** Set when `state` is `error`. */
  error: errorSummary.optional(),
});

export type ConnStatus = z.infer<typeof connStatus>;

export const serverInfo = z.object({
  version: z.string(),
  topology: z.enum(TOPOLOGIES),
  enterprise: z.boolean(),
  /** `buildInfo` / `hello` output, for the details view. */
  raw: ejsonDocument('server info'),
});

export type ServerInfo = z.infer<typeof serverInfo>;

const password = z.string().optional();

/**
 * Payload of the `ssh.hostKey` broadcast (`BROADCAST_STREAMS.sshHostKey`): a connect through an
 * SSH tunnel met a host key that is not in Thicket's `known_hosts`. The connect waits until a
 * renderer answers with `conn.trustHostKey` (or `timeoutMS` passed: "no"). A host key that differs
 * from the trusted one is never asked about: the connect fails with `SSH_ERROR`.
 */
export const sshHostKeyPrompt = z.object({
  promptId: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  /** `ssh-ed25519`, `ecdsa-sha2-nistp256`, `ssh-rsa`, ... */
  keyType: z.string().min(1),
  /** OpenSSH style: `SHA256:` + unpadded base64 of the key's SHA-256. */
  fingerprint: z.string().min(1),
  /** How long the backend waits for the answer. */
  timeoutMS: z.number().int().positive(),
});

export type SshHostKeyPrompt = z.infer<typeof sshHostKeyPrompt>;

const oidcPromptBase = {
  /** Same id for a prompt and its `finished` event. */
  promptId: z.string().min(1),
  /** The saved profile that connects (missing for `conn.test` of an unsaved draft). */
  profileId: profileId.optional(),
  profileName: z.string(),
};

/**
 * Payload of the `oidc.prompt` broadcast (`BROADCAST_STREAMS.oidcPrompt`): a MONGODB-OIDC connect
 * needs the user to sign in at the identity provider. `browser`: the sign-in page was opened in
 * the system browser (`url`, to open it again or copy it); `device`: enter `userCode` at
 * `verificationUri` on any device; `finished`: that sign-in is over (signed in, failed or
 * cancelled), the app hides the prompt. Tokens never travel in this event.
 */
export const oidcPrompt = z.discriminatedUnion('kind', [
  z.object({
    ...oidcPromptBase,
    kind: z.literal('browser'),
    url: z.string().min(1),
  }),
  z.object({
    ...oidcPromptBase,
    kind: z.literal('device'),
    verificationUri: z.string().min(1),
    /** The verification page with the code filled in, when the IdP offers one. */
    verificationUriComplete: z.string().min(1).optional(),
    userCode: z.string().min(1),
    expiresInSeconds: z.number().int().positive(),
  }),
  z.object({
    ...oidcPromptBase,
    kind: z.literal('finished'),
    ok: z.boolean(),
  }),
]);

export type OidcPrompt = z.infer<typeof oidcPrompt>;

export const connMethods = defineMethods({
  'conn.test': {
    summary: 'Try to connect with a saved profile or an unsaved draft, then disconnect',
    route: 'backend',
    params: z
      .strictObject({
        profileId: profileId.optional(),
        profile: profileDraft.optional(),
        password,
      })
      .refine((p) => (p.profileId === undefined) !== (p.profile === undefined), {
        message: 'conn.test needs exactly one of profileId or profile',
      }),
    result: z.object({ latencyMS: z.number().nonnegative(), server: serverInfo }),
  },
  'conn.open': {
    summary: 'Open the connection of a profile',
    route: 'backend',
    params: z.strictObject({ profileId, password }),
    result: connStatus,
  },
  'conn.close': {
    summary: 'Close the connection of a profile (cancels its streams and shells)',
    route: 'backend',
    params: z.strictObject({ profileId }),
    result: emptyResult,
  },
  'conn.status': {
    summary: 'State of one connection, or of all when `profileId` is missing',
    route: 'backend',
    params: z.strictObject({ profileId: profileId.optional() }),
    result: z.object({ connections: z.array(connStatus) }),
  },
  'conn.trustHostKey': {
    summary: 'Answer an ssh.hostKey prompt: trust the host key (saved in known_hosts) or not',
    route: 'backend',
    /** `NOT_FOUND` when the prompt is no longer open (answered, timed out, connect cancelled). */
    params: z.strictObject({ promptId: z.string().min(1), trust: z.boolean() }),
    result: emptyResult,
  },
  'conn.serverInfo': {
    summary: 'Server version, topology and build info of an open connection',
    route: 'backend',
    params: z.strictObject({ profileId }),
    result: serverInfo,
  },
});
