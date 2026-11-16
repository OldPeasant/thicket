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
  'conn.serverInfo': {
    summary: 'Server version, topology and build info of an open connection',
    route: 'backend',
    params: z.strictObject({ profileId }),
    result: serverInfo,
  },
});
