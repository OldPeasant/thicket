import type { ErrorCode } from '@thicket/contract';
import { maskText } from '@thicket/core';

import { RpcError } from '../server/rpc';

/** Node/OpenSSL error codes of certificate and handshake failures. */
const TLS_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_SIGNATURE_FAILURE',
  'CERT_UNTRUSTED',
  'CERT_REJECTED',
  'HOSTNAME_MISMATCH',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'EPROTO',
]);
const DNS_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'EAI_FAIL',
  'EAI_NONAME',
  'ENODATA',
  'ESERVFAIL',
  'ENOTIMP',
  'EREFUSED',
  'EBADNAME',
]);
const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EHOSTDOWN',
  'ENETDOWN',
  'EPIPE',
  'ECONNABORTED',
]);
const TIMEOUT_CODES = new Set(['ETIMEDOUT', 'ETIMEOUT', 'ESOCKETTIMEDOUT']);
/** MongoDB `AuthenticationFailed`, `MechanismUnavailable`. */
const AUTH_SERVER_CODES = new Set([18, 334]);

const AUTH_NAMES = new Set(['MongoMissingCredentialsError']);
const TIMEOUT_NAMES = new Set([
  'MongoServerSelectionError',
  'MongoNetworkTimeoutError',
  'MongoOperationTimeoutError',
]);

/** One error in the chain the driver builds (`cause`, server selection `reason`, `errors`). */
interface Cause {
  name: string;
  message: string;
  code: unknown;
  codeName: unknown;
}

/** Every error reachable from `error`: itself, `cause`s, the servers of a selection failure. */
function causes(error: unknown): Cause[] {
  const found: Cause[] = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number) => {
    if (typeof value !== 'object' || value === null || seen.has(value) || depth > 8) return;
    seen.add(value);
    const e = value as Record<string, unknown>;
    if (value instanceof Error) {
      found.push({
        name: value.name,
        message: value.message,
        code: e['code'],
        codeName: e['codeName'],
      });
    }
    visit(e['cause'], depth + 1);
    if (Array.isArray(e['errors'])) for (const inner of e['errors']) visit(inner, depth + 1);
    // MongoServerSelectionError.reason is a TopologyDescription: servers → ServerDescription.error.
    const reason = e['reason'] as { servers?: unknown } | undefined;
    if (reason?.servers instanceof Map) {
      for (const server of reason.servers.values()) {
        visit((server as { error?: unknown }).error, depth + 1);
      }
    }
  };
  visit(error, 0);
  return found;
}

function isTls(c: Cause): boolean {
  if (
    typeof c.code === 'string' &&
    (TLS_CODES.has(c.code) || c.code.startsWith('ERR_SSL_') || c.code.startsWith('ERR_TLS_'))
  ) {
    return true;
  }
  return /certificate|\bSSL\b|\bTLS\b|handshake/i.test(c.message);
}

function isAuth(c: Cause): boolean {
  if (AUTH_NAMES.has(c.name)) return true;
  if (typeof c.code === 'number' && AUTH_SERVER_CODES.has(c.code)) return true;
  if (c.codeName === 'AuthenticationFailed') return true;
  return /authentication failed/i.test(c.message);
}

function isDns(c: Cause): boolean {
  if (typeof c.code === 'string' && DNS_CODES.has(c.code)) return true;
  return /getaddrinfo|querySrv|queryTxt/i.test(c.message);
}

function isNetwork(c: Cause): boolean {
  return typeof c.code === 'string' && NETWORK_CODES.has(c.code);
}

function isTimeout(c: Cause): boolean {
  if (TIMEOUT_NAMES.has(c.name)) return true;
  if (typeof c.code === 'string' && TIMEOUT_CODES.has(c.code)) return true;
  return /timed out/i.test(c.message);
}

/** The readable start of each classified message; the driver's own (masked) text follows. */
const PREFIX: Partial<Record<ErrorCode, string>> = {
  AUTH_FAILED: 'Authentication failed',
  TLS_ERROR: 'TLS connection failed',
  DNS_ERROR: 'Host name could not be resolved',
  NETWORK_ERROR: 'Server could not be reached',
  TIMEOUT: 'Server did not answer in time',
  SERVER_ERROR: 'The server refused the command',
  INTERNAL: 'Unexpected error while connecting',
};

/**
 * Which contract error code a driver error stands for. The most specific cause wins: an
 * authentication failure, then TLS, DNS, refused/unreachable, and a timeout (e.g. server
 * selection that found no answer) last.
 */
export function classifyCode(error: unknown): ErrorCode {
  if (error instanceof RpcError) return error.code;
  const all = causes(error);
  if (all.some(isAuth)) return 'AUTH_FAILED';
  if (all.some(isTls)) return 'TLS_ERROR';
  if (all.some(isDns)) return 'DNS_ERROR';
  if (all.some(isNetwork)) return 'NETWORK_ERROR';
  if (all.some(isTimeout)) return 'TIMEOUT';
  if (all.some((c) => c.name === 'MongoServerError' || typeof c.codeName === 'string')) {
    return 'SERVER_ERROR';
  }
  if (all.some((c) => c.name.startsWith('Mongo'))) return 'NETWORK_ERROR';
  return 'INTERNAL';
}

/**
 * Turns a driver error into the `RpcError` a handler answers with: a classified code and a
 * readable message with every connection string masked (and the given secret values removed).
 * `SERVER_ERROR`s keep the server's code and code name as `detail`.
 */
export function toConnectError(error: unknown, secrets: readonly string[] = []): RpcError {
  if (error instanceof RpcError) return error;
  const code = classifyCode(error);
  const raw = error instanceof Error ? error.message : String(error);
  const text = redact(raw, secrets);
  const prefix = PREFIX[code] ?? 'Connection failed';
  const message = text.length > 0 ? `${prefix}: ${text}` : prefix;
  if (code === 'SERVER_ERROR') {
    const e = error as { code?: unknown; codeName?: unknown };
    const detail: { serverCode?: number; codeName?: string } = {};
    if (typeof e.code === 'number' && Number.isInteger(e.code)) detail.serverCode = e.code;
    if (typeof e.codeName === 'string') detail.codeName = e.codeName;
    return new RpcError(code, message, detail);
  }
  return new RpcError(code, message);
}

/** Masks connection strings in `text` and replaces each (non-empty) secret value with `****`. */
export function redact(text: string, secrets: readonly string[] = []): string {
  let out = maskText(text);
  for (const secret of secrets) {
    if (secret.length > 0) out = out.split(secret).join('****');
  }
  return out;
}
