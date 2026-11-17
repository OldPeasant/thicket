import type { ShellOutput } from '@thicket/contract';
import type { MongoClientOptions } from 'mongodb';

/**
 * Messages between the backend thread (`ShellHost`) and one shell worker (`worker.ts`).
 * Everything here crosses `postMessage` (structured clone): no BSON objects, no cursors.
 */
export type ToWorker =
  | { type: 'open'; uri: string; options: MongoClientOptions; db: string | undefined }
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
