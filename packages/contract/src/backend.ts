import { z } from 'zod';

import { count, emptyParams, profileId } from './common';
import { defineMethods } from './define';
import { profile } from './profiles';

/** Longest `backend.sleep`, so a forgotten test request cannot hold the backend for long. */
export const MAX_SLEEP_MS = 600_000;

/**
 * Diagnostics of the process wiring (renderer ↔ main ↔ backend). Harmless in production: they
 * read nothing and write nothing; tests and the status bar use them to see that a process answers.
 */
export const backendMethods = defineMethods({
  'backend.ping': {
    summary: 'Answer from the backend process; also checks its privileged port to main',
    route: 'backend',
    params: emptyParams,
    result: z.object({
      process: z.literal('backend'),
      pid: z.number().int().positive(),
      /** The backend reached `main` over its privileged port. */
      mainReachable: z.boolean(),
    }),
  },
  'backend.sleep': {
    summary: 'Wait in the backend (for cancel tests); cancellable, answers CANCELLED',
    route: 'backend',
    params: z.strictObject({ ms: z.number().int().positive().max(MAX_SLEEP_MS) }),
    result: z.object({ sleptMs: count }),
  },
});

/** Payload of the `backend.restarted` broadcast event (see `BROADCAST_STREAMS`). */
export const backendRestarted = z.object({
  /** Restarts since the app started. */
  restarts: count,
  /** Why the previous backend process ended (exit code or signal). */
  reason: z.string(),
});

export type BackendRestarted = z.infer<typeof backendRestarted>;

/**
 * The privileged port between `main` and the backend. It uses the same envelope (`Request` /
 * `Response`) but its methods are **not** part of `methods`: `route()` doesn't know them, the
 * renderer can't call them, and `main` never hands this port to a renderer. Secrets only travel here.
 */
export const privilegedMethods = defineMethods({
  'main.ping': {
    summary: 'The backend checks that main answers',
    route: 'main',
    params: emptyParams,
    result: z.object({ process: z.literal('main') }),
  },
  'secrets.get': {
    summary: "A profile's secrets, decrypted by main for the backend's connect",
    route: 'main',
    params: z.strictObject({ profileId }),
    /** `null` when the profile has no stored secrets. */
    result: z.object({ secrets: z.record(z.string(), z.string()).nullable() }),
  },
  'profiles.forConnect': {
    summary:
      "A saved profile (without secrets), read by main for the backend's connect and write guard",
    route: 'main',
    params: z.strictObject({ profileId }),
    /** Answers `NOT_FOUND` for an unknown profile. */
    result: z.object({ profile }),
  },
});

export type PrivilegedMethodName = keyof typeof privilegedMethods;
