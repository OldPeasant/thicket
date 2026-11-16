import { z } from 'zod';

import { ejsonDocument } from './common';

/**
 * Stable error codes (SPEC.md section 4). The renderer maps them to readable explanations;
 * never rename one, only add.
 */
export const ERROR_CODES = [
  /** Authentication failed (wrong user/password, mechanism not supported, ...). */
  'AUTH_FAILED',
  /** TLS handshake or certificate problem. */
  'TLS_ERROR',
  /** Host name or SRV record could not be resolved. */
  'DNS_ERROR',
  /** Server or operation did not answer in time (server selection, maxTimeMS, ...). */
  'TIMEOUT',
  /** TCP connection refused or reset, host unreachable. */
  'NETWORK_ERROR',
  /** SSH tunnel could not be established (auth, host key, forwarding). */
  'SSH_ERROR',
  /**
   * The update's conflict filter matched nothing: the document changed on the server (detail:
   * `ConflictDetail`). Bulk writes (`docs.updateMany/deleteMany`) answer it without detail when
   * more documents match than their `expectedCount`.
   */
  'CONFLICT',
  /** A write was sent for a read-only profile. */
  'READ_ONLY',
  /** A write to a production profile (or a bulk write) arrived without `confirmed: true`. */
  'CONFIRMATION_REQUIRED',
  /** Profile, connection, database, collection, document, stream or session does not exist. */
  'NOT_FOUND',
  /** The profile has no open connection. */
  'NOT_CONNECTED',
  /** The server refused the command (permissions, validation, duplicate key, ...). */
  'SERVER_ERROR',
  /** The operation was cancelled by the user. */
  'CANCELLED',
  /** Request params failed validation against the contract. */
  'INVALID_PARAMS',
  /** The method is not part of the contract. */
  'UNKNOWN_METHOD',
  /** The method or option is not supported (by this build or this server). */
  'UNSUPPORTED',
  /** Unexpected failure inside Thicket (a bug). */
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const errorCode = z.enum(ERROR_CODES);

/** Error payload of a failed `Response` and of a stream's `error` event. */
export const errorInfo = z.object({
  code: errorCode,
  /** Readable, already masked (no passwords in URIs). */
  message: z.string(),
  /** Code-specific detail, e.g. `ConflictDetail` for `CONFLICT`. */
  detail: z.unknown().optional(),
});

export type ErrorInfo = z.infer<typeof errorInfo>;

/** `ErrorInfo` without `detail`, for errors embedded in results (connection state, import failures). */
export const errorSummary = errorInfo.pick({ code: true, message: true });

export type ErrorSummary = z.infer<typeof errorSummary>;

/** `detail` of a `CONFLICT` error: the current server version of the document, as EJSON text (`null` if deleted). */
export const conflictDetail = z.object({
  current: ejsonDocument('current server document').nullable(),
});

export type ConflictDetail = z.infer<typeof conflictDetail>;

/** `detail` of a `SERVER_ERROR`: the server's numeric code and code name, if known. */
export const serverErrorDetail = z.object({
  serverCode: z.number().int().optional(),
  codeName: z.string().optional(),
});

export type ServerErrorDetail = z.infer<typeof serverErrorDetail>;

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}
