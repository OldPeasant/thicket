import {
  WRITE_METHODS,
  methods,
  type MethodDef,
  type MethodName,
  type Profile,
} from '@thicket/contract';

import { RpcError, type Handler, type HandlerContext } from '../server/rpc';

/** The bulk writes that need `confirmed: true` on every profile (SPEC.md M1 "Safety"). */
export const BULK_WRITE_METHODS: readonly string[] = ['docs.updateMany', 'docs.deleteMany'];

/** The profile flags the guard looks at. */
export type GuardedProfile = Pick<Profile, 'readOnly' | 'production'>;

/** What every write request carries (contract `writeFields`). */
export interface WriteParams {
  profileId: string;
  confirmed?: boolean;
}

/**
 * Refuses a write that the profile does not allow, by throwing an `RpcError`:
 * - `READ_ONLY` on a read-only profile (whatever `confirmed` says);
 * - `CONFIRMATION_REQUIRED` on a production profile, and for the bulk writes on every profile,
 *   unless `confirmed` is exactly `true`.
 */
export function checkWrite(method: string, profile: GuardedProfile, params: WriteParams): void {
  if (profile.readOnly) {
    throw new RpcError('READ_ONLY', `${method} writes, and the connection's profile is read-only`);
  }
  if (params.confirmed === true) return;
  if (BULK_WRITE_METHODS.includes(method)) {
    throw new RpcError(
      'CONFIRMATION_REQUIRED',
      `${method} changes many documents and needs confirmed: true`,
    );
  }
  if (profile.production) {
    throw new RpcError(
      'CONFIRMATION_REQUIRED',
      `${method} writes to a production connection and needs confirmed: true`,
    );
  }
}

/**
 * Stages that make an aggregation pipeline write (the one list: `agg` refuses them in previews and
 * explains them only in `queryPlanner` mode).
 */
export const WRITING_STAGES: readonly string[] = ['$out', '$merge'];

/**
 * Whether an `agg.run` pipeline (canonical EJSON text) writes: true when any stage is `$out` or
 * `$merge`. Text that can't be read as an array of stages counts as a write (fails closed).
 */
export function pipelineWrites(pipeline: string): boolean {
  let stages: unknown;
  try {
    stages = JSON.parse(pipeline);
  } catch {
    return true;
  }
  if (!Array.isArray(stages)) return true;
  return stages.some(
    (stage) =>
      typeof stage !== 'object' ||
      stage === null ||
      Object.keys(stage).some((key) => WRITING_STAGES.includes(key)),
  );
}

/**
 * For `write: 'conditional'` methods: whether these params write. A conditional method without
 * an entry here is always treated as a write (fails closed).
 */
export const CONDITIONAL_WRITES: Readonly<Record<string, (params: unknown) => boolean>> = {
  'agg.run': (params) => pipelineWrites((params as { pipeline: string }).pipeline),
};

/** Whether a call of `method` with `params` is a write the guard must check. */
export function isWrite(method: string, params: unknown): boolean {
  if (!WRITE_METHODS.includes(method as MethodName)) return false;
  const kind = (methods[method as MethodName] as MethodDef).write;
  if (kind !== 'conditional') return true;
  const predicate = Object.hasOwn(CONDITIONAL_WRITES, method)
    ? CONDITIONAL_WRITES[method]
    : undefined;
  return predicate ? predicate(params) : true;
}

/** Loads the profile a write targets (`NOT_FOUND` / `NOT_CONNECTED` errors pass through). */
export type ProfileLookup = (profileId: string) => GuardedProfile | Promise<GuardedProfile>;

/**
 * Wraps the handlers of the write methods (`WRITE_METHODS`) so each one runs only after
 * `checkWrite` allowed it. Every write handler the backend serves goes through this, so the
 * read-only and production rules hold whatever the renderer does. Other handlers are unchanged.
 */
export function guardWrites(
  handlers: Readonly<Record<string, Handler>>,
  lookup: ProfileLookup,
): Record<string, Handler> {
  const guarded: Record<string, Handler> = { ...handlers };
  for (const [method, handler] of Object.entries(handlers)) {
    if (!WRITE_METHODS.includes(method as MethodName)) continue;
    guarded[method] = async (params: never, context: HandlerContext) => {
      if (isWrite(method, params)) {
        const write = params as WriteParams;
        checkWrite(method, await lookup(write.profileId), write);
      }
      return handler(params, context);
    };
  }
  return guarded;
}
