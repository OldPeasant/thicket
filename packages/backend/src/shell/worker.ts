/**
 * Entry point of a shell worker (`worker_thread`, one per console session; bundled to
 * `apps/desktop/dist/shell-worker.cjs`, run from source in tests). It owns one `ShellRuntime` and
 * answers `ToWorker` messages from `ShellHost`. A synchronous endless loop blocks this thread
 * only; the host then terminates it (docs/mongosh.md "Interrupt").
 */
import { parentPort } from 'node:worker_threads';

import {
  withAwsCredentials,
  type FromWorker,
  type ToWorker,
  type WorkerError,
} from './protocol.ts';
import { ShellRuntime } from './runtime.ts';

if (!parentPort) throw new Error('The shell worker must run in a worker_thread');
const port = parentPort;

const post = (message: FromWorker) => port.postMessage(message);

function workerError(error: unknown): WorkerError {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return {
      name: error.name,
      message: error.message,
      ...(typeof code === 'number' || typeof code === 'string' ? { code } : {}),
    };
  }
  return { name: 'Error', message: String(error) };
}

let runtime: ShellRuntime | undefined;

port.on('message', (message: ToWorker) => {
  void handle(message);
});

async function handle(message: ToWorker): Promise<void> {
  switch (message.type) {
    case 'open':
      try {
        runtime = await ShellRuntime.open(
          message.uri,
          withAwsCredentials(message.options, message.awsCredentials),
          message.db,
        );
        post({ type: 'opened', db: runtime.db() });
      } catch (error) {
        post({ type: 'openFailed', error: workerError(error) });
      }
      return;
    case 'eval': {
      const { id } = message;
      try {
        if (!runtime) throw new Error('The shell session is not open');
        await runtime.evaluate(message.code, (output) => post({ type: 'output', id, output }));
      } catch (error) {
        post({ type: 'output', id, output: { kind: 'error', text: workerError(error).message } });
      }
      post({ type: 'evalDone', id });
      return;
    }
    case 'complete': {
      const { id } = message;
      try {
        if (!runtime) throw new Error('The shell session is not open');
        post({ type: 'completions', id, completions: await runtime.complete(message.code) });
      } catch (error) {
        post({ type: 'completeFailed', id, error: workerError(error) });
      }
      return;
    }
    case 'interrupt':
      await runtime?.interrupt().catch(() => undefined);
      return;
    case 'close':
      await runtime?.close().catch(() => undefined);
      runtime = undefined;
      post({ type: 'closed' });
      port.close();
      return;
  }
}
