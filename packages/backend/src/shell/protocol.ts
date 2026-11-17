import type { ShellOutput } from '@thicket/contract';
import type { AWSCredentials, MongoClientOptions } from 'mongodb';

/**
 * Messages between the backend thread (`ShellHost`) and one shell worker (`worker.ts`).
 * Everything here crosses `postMessage` (structured clone): no BSON objects, no cursors.
 */
export type ToWorker =
  | {
      type: 'open';
      uri: string;
      /** Without functions (`AWS_CREDENTIAL_PROVIDER` is replaced by `awsCredentials`). */
      options: MongoClientOptions;
      db: string | undefined;
      /** MONGODB-AWS credentials the host resolved; the worker turns them back into a provider. */
      awsCredentials?: AWSCredentials;
    }
  | { type: 'eval'; id: number; code: string }
  | { type: 'complete'; id: number; code: string }
  /** Cooperative interrupt of the running evaluation (only reaches a worker that yields). */
  | { type: 'interrupt' }
  | { type: 'close' };

export type FromWorker =
  | { type: 'opened'; db: string }
  | { type: 'openFailed'; error: WorkerError }
  | { type: 'output'; id: number; output: ShellOutput }
  | { type: 'evalDone'; id: number }
  | { type: 'completions'; id: number; completions: string[] }
  | { type: 'completeFailed'; id: number; error: WorkerError }
  | { type: 'closed' };

export interface WorkerError {
  name: string;
  message: string;
  code?: number | string;
}

/**
 * The worker side of `awsCredentials`: the driver options with a static `AWS_CREDENTIAL_PROVIDER`
 * for them again (driver 7 takes AWS credentials only from a provider; a function can't cross
 * `postMessage`).
 */
export function withAwsCredentials(
  options: MongoClientOptions,
  credentials: AWSCredentials | undefined,
): MongoClientOptions {
  if (credentials === undefined) return options;
  return {
    ...options,
    authMechanismProperties: {
      ...options.authMechanismProperties,
      AWS_CREDENTIAL_PROVIDER: () => Promise.resolve(credentials),
    },
  };
}
