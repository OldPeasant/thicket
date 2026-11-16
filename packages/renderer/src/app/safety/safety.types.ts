import type { MethodName, Methods, WriteKind } from '@thicket/contract';

/** Contract methods that (always or conditionally) write: the ones `WriteGuard.run` accepts. */
export type WriteMethodName = {
  [M in MethodName]: Methods[M] extends { write: WriteKind } ? M : never;
}[MethodName];

/** Bulk writes that need confirmation on every profile, not only on production ones. */
export const BULK_WRITES: readonly WriteMethodName[] = ['docs.updateMany', 'docs.deleteMany'];

/**
 * Deletes of more documents than this ask the user to type the collection name
 * (SPEC.md M1 "Safety": "typing the collection name for deletes over 1 000 documents").
 */
export const TYPE_TO_CONFIRM_ABOVE = 1000;

/** The safety flags of a connection profile, as the write UIs need them. */
export interface SafetyProfile {
  id: string;
  /** Shown in the confirm dialog. */
  name: string;
  /** All write UI disabled; the backend refuses writes too. */
  readOnly: boolean;
  /** Red accent; every write asks first. */
  production: boolean;
}
