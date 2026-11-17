import { inspect } from 'node:util';

import type { ShellOutput } from '@thicket/contract';
import { BSON } from 'mongodb';

/** What mongosh's evaluator returns (and the `onPrint` listener gets) for one value. */
export interface ShellResultLike {
  type: string | null;
  printable: unknown;
}

/** Result types shown as text only (their printable is not data). */
const TEXT_ONLY_TYPES = new Set(['Help', 'ShowBannerResult']);

const INSPECT = { depth: 8, colors: false, breakLength: 100, maxArrayLength: 1000 } as const;

/** One printed value as mongosh would print it: strings as they are, the rest inspected. */
export function printableText(value: unknown): string {
  return typeof value === 'string' ? value : inspect(value, INSPECT);
}

/** A `print()`/`printjson()`/`console.log()` call: its values joined by spaces. */
export function printOutput(values: readonly ShellResultLike[], kind?: string): ShellOutput {
  const texts = values.map((v) =>
    kind === 'printjson' ? inspect(v.printable, INSPECT) : printableText(v.printable),
  );
  return { kind: 'print', text: texts.join(' ') };
}

/** A mongosh cursor batch (`Cursor`, `AggregationCursor`, `it`). */
interface CursorBatch {
  cursorHasMore: boolean;
  documents: unknown[];
}

function isCursorBatch(value: unknown): value is CursorBatch {
  return (
    typeof value === 'object' &&
    value !== null &&
    'documents' in value &&
    Array.isArray((value as { documents: unknown }).documents) &&
    'cursorHasMore' in value
  );
}

/**
 * The output of an evaluation result; `undefined` for results that show nothing (`undefined`,
 * e.g. a declaration). Documents and other data go out as canonical EJSON in `value` (a cursor
 * batch as the array of its documents); `text` is the plain-text rendering.
 */
export function resultOutput(result: ShellResultLike): ShellOutput | undefined {
  const { printable } = result;
  const type = result.type ?? undefined;
  if (printable === undefined && type === undefined) return undefined;
  let data: unknown = printable;
  let text: string;
  if (isCursorBatch(printable)) {
    data = printable.documents;
    text = printable.documents.length === 0 ? '' : inspect(printable.documents, INSPECT);
    if (printable.cursorHasMore) text += `${text ? '\n' : ''}Type "it" for more`;
  } else {
    text = printableText(printable);
  }
  const value = type && TEXT_ONLY_TYPES.has(type) ? undefined : toEjson(data);
  return {
    kind: 'result',
    text,
    ...(value !== undefined ? { value } : {}),
    ...(type !== undefined ? { type } : {}),
  };
}

/** Canonical EJSON of a value, or `undefined` when it isn't data (functions, cycles, ...). */
export function toEjson(value: unknown): string | undefined {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return undefined;
  }
  try {
    const text = BSON.EJSON.stringify(value, { relaxed: false });
    return typeof text === 'string' && text.trim() !== '' ? text : undefined;
  } catch {
    return undefined;
  }
}

/** The text of an evaluation error: `Name[codeName]: message` like mongosh shows it. */
export function errorOutput(error: unknown): ShellOutput {
  // User code runs in a `vm` context: its errors are not `instanceof Error` of this realm.
  if (isErrorLike(error)) {
    const codeName = (error as { codeName?: unknown }).codeName;
    const name = typeof codeName === 'string' ? `${error.name}[${codeName}]` : error.name;
    return { kind: 'error', text: `${name}: ${error.message}` };
  }
  return { kind: 'error', text: `Uncaught ${printableText(error)}` };
}

function isErrorLike(value: unknown): value is { name: string; message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { name?: unknown }).name === 'string' &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}
