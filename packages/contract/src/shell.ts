import { z } from 'zod';

import { dbName, ejsonValue, emptyResult, profileId, streamResult } from './common';
import { defineMethods } from './define';

/**
 * Embedded mongosh console. The shell runs user JavaScript in the backend; the server's own
 * permissions are its only write guard, so `shell.eval` is not a contract write.
 */

const sessionId = z.string().min(1);

/** One output item of `shell.eval`. */
export const shellOutput = z.discriminatedUnion('kind', [
  /** `print()` / `console.log` text. */
  z.object({ kind: z.literal('print'), text: z.string() }),
  /** Evaluation result: any BSON value or document as EJSON, plus mongosh's own text rendering. */
  z.object({
    kind: z.literal('result'),
    value: ejsonValue('result value').optional(),
    text: z.string(),
    /** mongosh result type (`Cursor`, `Document`, `InsertOneResult`, ...). */
    type: z.string().optional(),
  }),
  z.object({ kind: z.literal('error'), text: z.string() }),
  /** The current database changed (`use db`). */
  z.object({ kind: z.literal('db'), db: z.string() }),
]);

export type ShellOutput = z.infer<typeof shellOutput>;

export const shellMethods = defineMethods({
  'shell.open': {
    summary: 'Open a mongosh session on a connection',
    route: 'backend',
    params: z.strictObject({ profileId, db: dbName.optional() }),
    result: z.object({ sessionId, db: z.string() }),
  },
  'shell.eval': {
    summary: 'Evaluate input in a session; output arrives on the returned stream',
    route: 'backend',
    params: z.strictObject({ sessionId, code: z.string() }),
    result: streamResult,
    stream: shellOutput,
  },
  'shell.complete': {
    summary: 'Completions for the input at a cursor position',
    route: 'backend',
    params: z.strictObject({ sessionId, code: z.string(), cursor: z.number().int().nonnegative() }),
    result: z.object({ completions: z.array(z.string()) }),
  },
  'shell.close': {
    summary: 'Close a session',
    route: 'backend',
    params: z.strictObject({ sessionId }),
    result: emptyResult,
  },
});
