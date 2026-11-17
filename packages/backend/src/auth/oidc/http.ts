import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

import { RpcError } from '../../server/rpc';

/** How the OIDC client talks to the identity provider. */
export interface OidcHttpOptions {
  /** Extra trusted CA certificates (PEM), e.g. a private IdP's CA; Node's default CAs otherwise. */
  ca?: string;
  /** Per request (default 30 s). */
  timeoutMS?: number;
  signal?: AbortSignal;
}

export interface HttpAnswer {
  status: number;
  body: unknown;
}

/** Largest IdP answer read (discovery documents and token answers are a few KB). */
const MAX_BODY = 1024 * 1024;

/** Whether `url` is `https:`, or `http:` to a loopback address (a local IdP in development). */
export function isAllowedIdpUrl(url: URL): boolean {
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && isLoopbackHost(url.hostname);
}

export function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '[::1]' ||
    hostname === '::1' ||
    /^127(\.\d{1,3}){3}$/.test(hostname)
  );
}

/**
 * GET (no `form`) or POST `application/x-www-form-urlencoded` to the IdP, JSON answer. Network
 * and TLS failures become `NETWORK_ERROR` / `TLS_ERROR` with the IdP's host in the message.
 */
export function idpRequest(
  url: string,
  form: Record<string, string> | undefined,
  options: OidcHttpOptions = {},
): Promise<HttpAnswer> {
  const target = new URL(url);
  if (!isAllowedIdpUrl(target)) {
    return Promise.reject(
      new RpcError('AUTH_FAILED', `The identity provider URL ${target.origin} is not https`),
    );
  }
  const body = form ? new URLSearchParams(form).toString() : undefined;
  const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise<HttpAnswer>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new RpcError('CANCELLED', 'Sign-in cancelled'));
      return;
    }
    const req = send(
      target,
      {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          accept: 'application/json',
          ...(body !== undefined
            ? {
                'content-type': 'application/x-www-form-urlencoded',
                'content-length': Buffer.byteLength(body),
              }
            : {}),
        },
        ...(options.ca !== undefined ? { ca: options.ca } : {}),
        timeout: options.timeoutMS ?? 30_000,
        ...(options.signal ? { signal: options.signal } : {}),
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BODY) {
            req.destroy(new Error('answer too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed: unknown;
          try {
            parsed = text.length > 0 ? JSON.parse(text) : undefined;
          } catch {
            parsed = undefined;
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
        res.on('error', (error) => reject(failure(target, error, options.signal)));
      },
    );
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', (error) => reject(failure(target, error, options.signal)));
    req.end(body);
  });
}

function failure(target: URL, error: Error, signal: AbortSignal | undefined): RpcError {
  if (signal?.aborted) return new RpcError('CANCELLED', 'Sign-in cancelled');
  const code = (error as NodeJS.ErrnoException).code ?? '';
  const tls =
    code.startsWith('ERR_TLS') ||
    code.startsWith('ERR_SSL') ||
    /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO/.test(code);
  return new RpcError(
    tls ? 'TLS_ERROR' : 'NETWORK_ERROR',
    `Cannot reach the identity provider ${target.host}: ${code || error.message}`,
  );
}
