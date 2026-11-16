import { type ErrorCode, type ErrorInfo, isErrorCode } from '@thicket/contract';

/**
 * Readable explanation per contract error code, shown above the backend's own (masked) message.
 * `Record<ErrorCode, ...>` makes a new code in the contract a type error here until it gets a text.
 */
export const ERROR_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  AUTH_FAILED: 'Authentication failed. Check the user name, password and authentication mechanism.',
  TLS_ERROR:
    'The TLS connection could not be established. Check the certificates and TLS settings.',
  DNS_ERROR: 'The host name could not be resolved. Check the host and the DNS (SRV) settings.',
  TIMEOUT: 'The server did not answer in time.',
  NETWORK_ERROR: 'The server could not be reached. Check the host, the port and your network.',
  SSH_ERROR: 'The SSH tunnel could not be established. Check the SSH host, user and key.',
  CONFLICT:
    'The document was changed on the server since you loaded it. Reload it and apply your edits again.',
  READ_ONLY: 'This connection is read-only, so changes are not allowed.',
  CONFIRMATION_REQUIRED: 'This change must be confirmed before it is sent.',
  NOT_FOUND: 'The item does not exist (any more).',
  NOT_CONNECTED: 'The connection is not open. Connect first.',
  SERVER_ERROR: 'The server refused the operation.',
  CANCELLED: 'The operation was cancelled.',
  INVALID_PARAMS: 'The request was not valid.',
  UNKNOWN_METHOD: 'This operation is not supported by this version of Thicket.',
  UNSUPPORTED: 'This operation is not supported by this server or this build of Thicket.',
  INTERNAL: 'Something went wrong inside Thicket.',
};

/** Error of a failed request or stream, with the contract's `code`, `message` and `detail`. */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly code: ErrorCode;
  readonly detail: unknown;

  constructor(info: ErrorInfo) {
    super(info.message);
    this.code = info.code;
    this.detail = info.detail;
  }

  /** The readable explanation for `code` (see `ERROR_MESSAGES`). */
  get explanation(): string {
    return ERROR_MESSAGES[this.code];
  }

  /** Builds an `ApiError` from anything that came over the bridge; malformed input becomes `INTERNAL`. */
  static from(value: unknown): ApiError {
    if (value instanceof ApiError) return value;
    if (isErrorInfo(value)) return new ApiError(value);
    const message = value instanceof Error ? value.message : 'Malformed error from the bridge';
    return new ApiError({ code: 'INTERNAL', message, detail: value });
  }
}

function isErrorInfo(value: unknown): value is ErrorInfo {
  if (typeof value !== 'object' || value === null) return false;
  const { code, message } = value as Record<string, unknown>;
  return isErrorCode(code) && typeof message === 'string';
}

/**
 * Text for the user: the code's explanation, followed by the backend's message when it adds
 * something. Accepts an `ApiError`, an `ErrorInfo` or anything else (shown as `INTERNAL`).
 */
export function describeError(error: unknown): string {
  const apiError = ApiError.from(error);
  const explanation = apiError.explanation;
  const message = apiError.message.trim();
  return message && message !== explanation ? `${explanation}\n${message}` : explanation;
}
