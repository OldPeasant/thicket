import type { z } from 'zod';

/** Process that serves a method: `main` (profiles, settings, native dialogs) or `backend` (driver work). */
export type Route = 'main' | 'backend';

/**
 * Whether a method writes to the server.
 * - `always`: the backend refuses it on read-only profiles and needs `confirmed: true` on production ones.
 * - `conditional`: writes only for some params (e.g. `agg.run` with `$out`/`$merge`); then the same rules apply.
 */
export type WriteKind = 'always' | 'conditional';

/** Contract of one method. */
export interface MethodDef<
  P extends z.ZodType = z.ZodType,
  R extends z.ZodType = z.ZodType,
  E extends z.ZodType | undefined = z.ZodType | undefined,
> {
  route: Route;
  /** Schema of `Request.params`. Params objects are strict: unknown keys are rejected. */
  params: P;
  /** Schema of `Response.result` when `ok` is true. */
  result: R;
  write?: WriteKind;
  /**
   * For streaming methods (the result is `{ streamId }`): schema of the `payload` of
   * `Event`s with `kind: 'data'`. `end` events carry `streamEnd`, `error` events an `ErrorInfo`.
   */
  stream?: E;
  /** One line for docs and error messages. */
  summary: string;
}

/** Identity helper that keeps the literal types of a group's method table. */
export function defineMethods<const T extends Record<string, MethodDef>>(methods: T): T {
  return methods;
}
