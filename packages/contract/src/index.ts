import { z } from 'zod';

import { adminMethods } from './admin';
import { aggMethods } from './agg';
import { appMethods } from './app';
import { backendMethods } from './backend';
import { collMethods } from './coll';
import { connMethods } from './conn';
import { dbMethods } from './db';
import type { MethodDef, Route } from './define';
import { docsMethods } from './docs';
import { gridfsMethods } from './gridfs';
import { historyMethods } from './history';
import type { ErrorInfo } from './errors';
import { idxMethods } from './idx';
import { ioMethods } from './io';
import { pipelinesMethods } from './pipelines';
import { profilesMethods } from './profiles';
import { schemaMethods } from './schema';
import { shellMethods } from './shell';

export * from './admin';
export * from './agg';
export * from './app';
export * from './backend';
export * from './coll';
export * from './common';
export * from './conn';
export * from './db';
export * from './define';
export * from './docs';
export * from './envelope';
export * from './errors';
export * from './gridfs';
export * from './history';
export * from './idx';
export * from './io';
export * from './pipelines';
export * from './profiles';
export * from './schema';
export * from './shell';

/** Every method of the contract, by name (`<group>.<method>`). */
export const methods = {
  ...profilesMethods,
  ...connMethods,
  ...dbMethods,
  ...collMethods,
  ...docsMethods,
  ...aggMethods,
  ...idxMethods,
  ...schemaMethods,
  ...ioMethods,
  ...gridfsMethods,
  ...shellMethods,
  ...adminMethods,
  ...pipelinesMethods,
  ...historyMethods,
  ...appMethods,
  ...backendMethods,
} as const satisfies Record<string, MethodDef>;

export type Methods = typeof methods;
export type MethodName = keyof Methods;

/** What the caller sends as `params` (defaults may be omitted). */
export type ParamsOf<M extends MethodName> = z.input<Methods[M]['params']>;
/** What the handler receives after validation. */
export type ParsedParamsOf<M extends MethodName> = z.output<Methods[M]['params']>;
/** `result` of a successful response. */
export type ResultOf<M extends MethodName> = z.output<Methods[M]['result']>;

/** Methods that return a `streamId`, and the payload type of their `data` events. */
export type StreamMethodName = {
  [M in MethodName]: Methods[M] extends { stream: z.ZodType } ? M : never;
}[MethodName];
export type StreamDataOf<M extends StreamMethodName> = Methods[M] extends {
  stream: infer S extends z.ZodType;
}
  ? z.output<S>
  : never;

const methodTable: Readonly<Record<string, MethodDef>> = methods;

export function isMethodName(name: string): name is MethodName {
  return Object.hasOwn(methodTable, name);
}

/** All method names, in contract order. */
export const METHOD_NAMES = Object.keys(methods) as MethodName[];

/** Names of the methods that (always or conditionally) write to the server. */
export const WRITE_METHODS = METHOD_NAMES.filter((name) => methodTable[name]?.write !== undefined);

/**
 * Which process serves a method: `main` (profiles.*, app.*, io.* with their native dialogs)
 * or `backend`. `undefined` for names that are not in the contract.
 */
export function route(method: string): Route | undefined {
  return isMethodName(method) ? methodTable[method]?.route : undefined;
}

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: ErrorInfo };

function invalid(method: string, what: string, error: z.ZodError): { ok: false; error: ErrorInfo } {
  return {
    ok: false,
    error: {
      code: 'INVALID_PARAMS',
      message: `Invalid ${what} for ${method}:\n${z.prettifyError(error)}`,
      detail: error.issues.map((issue) => ({
        path: issue.path.map(String),
        message: issue.message,
      })),
    },
  };
}

function unknownMethod(method: string): { ok: false; error: ErrorInfo } {
  return { ok: false, error: { code: 'UNKNOWN_METHOD', message: `Unknown method "${method}"` } };
}

/** Validate a request's params; the error is ready to send back as `Response.error`. */
export function parseParams<M extends MethodName>(
  method: M,
  params: unknown,
): ParseResult<ParsedParamsOf<M>>;
export function parseParams(method: string, params: unknown): ParseResult<unknown>;
export function parseParams(method: string, params: unknown): ParseResult<unknown> {
  return parseParamsIn(methodTable, method, params);
}

/**
 * `parseParams` against another method table (the privileged main ↔ backend port uses
 * `privilegedMethods`). Unknown names, including inherited keys, answer `UNKNOWN_METHOD`.
 */
export function parseParamsIn(
  table: Readonly<Record<string, MethodDef>>,
  method: string,
  params: unknown,
): ParseResult<unknown> {
  const def = Object.hasOwn(table, method) ? table[method] : undefined;
  if (!def) return unknownMethod(method);
  const parsed = def.params.safeParse(params);
  return parsed.success ? { ok: true, data: parsed.data } : invalid(method, 'params', parsed.error);
}

/** Validate a handler's result before it is sent (and in tests). */
export function parseResult<M extends MethodName>(
  method: M,
  result: unknown,
): ParseResult<ResultOf<M>>;
export function parseResult(method: string, result: unknown): ParseResult<unknown>;
export function parseResult(method: string, result: unknown): ParseResult<unknown> {
  return parseResultIn(methodTable, method, result);
}

/** `parseResult` against another method table; a mismatch is an `INTERNAL` error (a bug). */
export function parseResultIn(
  table: Readonly<Record<string, MethodDef>>,
  method: string,
  result: unknown,
): ParseResult<unknown> {
  const def = Object.hasOwn(table, method) ? table[method] : undefined;
  if (!def) return unknownMethod(method);
  const parsed = def.result.safeParse(result);
  if (parsed.success) return { ok: true, data: parsed.data };
  const failure = invalid(method, 'result', parsed.error);
  return { ok: false, error: { ...failure.error, code: 'INTERNAL' } };
}
