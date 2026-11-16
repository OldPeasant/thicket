import { describe, expect, it } from 'vitest';

import { RpcError } from '../server/rpc';
import { classifyCode, redact, toConnectError } from './errors';

/** A driver-like error: an `Error` with the given name and extra fields (`code`, `cause`, ...). */
function driverError(name: string, message: string, fields: Record<string, unknown> = {}): Error {
  const error = Object.assign(new Error(message), fields);
  error.name = name;
  return error;
}

function sysError(code: string, message = `${code} something`): Error {
  return driverError('Error', message, { code });
}

/** A MongoServerSelectionError whose topology description lists the given server errors. */
function selectionError(...serverErrors: (Error | undefined)[]): Error {
  const servers = new Map<string, { error?: Error }>();
  serverErrors.forEach((error, i) => servers.set(`db${i}.example.test:27017`, { error }));
  return driverError('MongoServerSelectionError', 'Server selection timed out after 30000 ms', {
    reason: { type: 'Unknown', servers },
  });
}

const FICTITIOUS_PASSWORD = 'fictitious-S3cret';

describe('classifyCode', () => {
  it('passes RpcError codes through', () => {
    expect(classifyCode(new RpcError('CANCELLED', 'stop'))).toBe('CANCELLED');
  });

  it.each([
    ['MongoMissingCredentialsError name', driverError('MongoMissingCredentialsError', 'x')],
    ['server code 18', driverError('MongoServerError', 'bad', { code: 18 })],
    ['server code 334', driverError('MongoServerError', 'bad', { code: 334 })],
    ['codeName', driverError('MongoServerError', 'bad', { codeName: 'AuthenticationFailed' })],
    ['message', driverError('MongoServerError', 'Authentication failed.')],
  ])('AUTH_FAILED by %s', (_label, error) => {
    expect(classifyCode(error)).toBe('AUTH_FAILED');
  });

  it.each([
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', sysError('UNABLE_TO_VERIFY_LEAF_SIGNATURE')],
    ['ERR_SSL_ prefix', sysError('ERR_SSL_WRONG_VERSION_NUMBER')],
    ['ERR_TLS_ prefix', sysError('ERR_TLS_HANDSHAKE_TIMEOUT')],
    [
      'message "self-signed certificate"',
      new Error('self-signed certificate in certificate chain'),
    ],
    [
      'message "handshake"',
      new Error('Client network socket disconnected before secure handshake'),
    ],
  ])('TLS_ERROR by %s', (_label, error) => {
    expect(classifyCode(error)).toBe('TLS_ERROR');
  });

  it.each([
    ['ENOTFOUND', sysError('ENOTFOUND')],
    ['EAI_AGAIN', sysError('EAI_AGAIN')],
    ['querySrv message', new Error('querySrv ENODATA _mongodb._tcp.cluster0.example.test')],
    ['getaddrinfo message', new Error('getaddrinfo failed for db.example.test')],
  ])('DNS_ERROR by %s', (_label, error) => {
    expect(classifyCode(error)).toBe('DNS_ERROR');
  });

  it.each(['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH'])('NETWORK_ERROR by %s', (code) => {
    expect(classifyCode(sysError(code))).toBe('NETWORK_ERROR');
  });

  it.each([
    ['MongoServerSelectionError without server errors', selectionError()],
    ['MongoNetworkTimeoutError', driverError('MongoNetworkTimeoutError', 'x')],
    ['ETIMEDOUT', sysError('ETIMEDOUT')],
    ['message', new Error('connection timed out')],
  ])('TIMEOUT by %s', (_label, error) => {
    expect(classifyCode(error)).toBe('TIMEOUT');
  });

  it('SERVER_ERROR for other server errors; NETWORK_ERROR for other Mongo errors; else INTERNAL', () => {
    expect(classifyCode(driverError('MongoServerError', 'not allowed', { code: 13 }))).toBe(
      'SERVER_ERROR',
    );
    expect(classifyCode(driverError('Error', 'x', { codeName: 'Unauthorized' }))).toBe(
      'SERVER_ERROR',
    );
    expect(classifyCode(driverError('MongoTopologyClosedError', 'closed'))).toBe('NETWORK_ERROR');
    expect(classifyCode(new TypeError('oops'))).toBe('INTERNAL');
    expect(classifyCode('a string')).toBe('INTERNAL');
    expect(classifyCode(null)).toBe('INTERNAL');
    expect(classifyCode(undefined)).toBe('INTERNAL');
  });

  it('finds the cause of a wrapped error (cause chain)', () => {
    const inner = sysError('ENOTFOUND', 'getaddrinfo ENOTFOUND db.example.test');
    const middle = driverError('MongoNetworkError', 'connection failed', { cause: inner });
    expect(classifyCode(driverError('MongoError', 'outer', { cause: middle }))).toBe('DNS_ERROR');
  });

  it('finds causes in errors[] (AggregateError-like)', () => {
    const aggregate = driverError('AggregateError', '', {
      errors: [sysError('ECONNREFUSED'), sysError('CERT_HAS_EXPIRED')],
    });
    expect(classifyCode(aggregate)).toBe('TLS_ERROR');
  });

  it('looks into the servers of a server selection failure', () => {
    const dns = driverError('MongoNetworkError', 'getaddrinfo ENOTFOUND db0.example.test', {
      cause: sysError('ENOTFOUND'),
    });
    expect(classifyCode(selectionError(undefined, dns))).toBe('DNS_ERROR');
    const auth = driverError('MongoServerError', 'Authentication failed.', { code: 18 });
    expect(classifyCode(selectionError(auth))).toBe('AUTH_FAILED');
    const refused = driverError('MongoNetworkError', 'connect refused', {
      cause: sysError('ECONNREFUSED'),
    });
    expect(classifyCode(selectionError(refused))).toBe('NETWORK_ERROR');
  });

  it('ignores a reason without a servers Map', () => {
    const error = driverError('MongoServerSelectionError', 'Server selection timed out', {
      reason: { servers: { 'db.example.test:27017': { error: sysError('ENOTFOUND') } } },
    });
    expect(classifyCode(error)).toBe('TIMEOUT');
  });

  it('priority: AUTH_FAILED > TLS_ERROR > DNS_ERROR > NETWORK_ERROR > TIMEOUT > SERVER_ERROR', () => {
    const auth = driverError('MongoServerError', 'Authentication failed.', { code: 18 });
    const tls = sysError('CERT_HAS_EXPIRED');
    const dns = sysError('ENOTFOUND');
    const net = sysError('ECONNREFUSED');
    const timeout = sysError('ETIMEDOUT');
    const server = driverError('MongoServerError', 'refused', { code: 13 });
    const all = (...errors: Error[]) => driverError('Error', 'outer', { errors });
    expect(classifyCode(all(server, timeout, net, dns, tls, auth))).toBe('AUTH_FAILED');
    expect(classifyCode(all(server, timeout, net, dns, tls))).toBe('TLS_ERROR');
    expect(classifyCode(all(server, timeout, net, dns))).toBe('DNS_ERROR');
    expect(classifyCode(all(server, timeout, net))).toBe('NETWORK_ERROR');
    expect(classifyCode(all(server, timeout))).toBe('TIMEOUT');
    expect(classifyCode(all(server))).toBe('SERVER_ERROR');
  });

  it('terminates on cyclic cause chains and very deep chains', () => {
    const a = driverError('MongoError', 'a');
    const b = driverError('MongoError', 'b', { cause: a });
    Object.assign(a, { cause: b });
    expect(classifyCode(a)).toBe('NETWORK_ERROR');

    let deep: Error = sysError('ENOTFOUND');
    for (let i = 0; i < 20; i++) deep = new Error(`level ${i}`, { cause: deep });
    // Causes deeper than the walk limit are not looked at; nothing else matches.
    expect(classifyCode(deep)).toBe('INTERNAL');
  });

  it('walks plain-object wrappers but only classifies Error instances', () => {
    expect(classifyCode({ cause: sysError('ENOTFOUND') })).toBe('DNS_ERROR');
    expect(classifyCode({ name: 'MongoServerError', code: 18, message: 'x' })).toBe('INTERNAL');
  });
});

describe('toConnectError', () => {
  it('returns RpcErrors unchanged', () => {
    const original = new RpcError('NOT_FOUND', 'No profile p1');
    expect(toConnectError(original)).toBe(original);
  });

  it('prefixes a readable text to the driver message', () => {
    const error = toConnectError(sysError('ENOTFOUND', 'getaddrinfo ENOTFOUND db.example.test'));
    expect(error).toBeInstanceOf(RpcError);
    expect(error.code).toBe('DNS_ERROR');
    expect(error.message).toBe(
      'Host name could not be resolved: getaddrinfo ENOTFOUND db.example.test',
    );
    expect(error.detail).toBeUndefined();
  });

  it.each([
    [
      'AUTH_FAILED',
      driverError('MongoServerError', 'Authentication failed.', { code: 18 }),
      'Authentication failed',
    ],
    ['TLS_ERROR', sysError('CERT_HAS_EXPIRED', 'certificate has expired'), 'TLS connection failed'],
    ['NETWORK_ERROR', sysError('ECONNREFUSED'), 'Server could not be reached'],
    ['TIMEOUT', selectionError(), 'Server did not answer in time'],
    ['INTERNAL', new TypeError('boom'), 'Unexpected error while connecting'],
  ])('%s messages start with their prefix', (code, error, prefix) => {
    const failure = toConnectError(error);
    expect(failure.code).toBe(code);
    expect(failure.message.startsWith(`${prefix}: `)).toBe(true);
  });

  it('answers the prefix alone for an empty message', () => {
    expect(toConnectError(new Error('')).message).toBe('Unexpected error while connecting');
  });

  it('stringifies non-Error values', () => {
    const failure = toConnectError('plain failure');
    expect(failure.code).toBe('INTERNAL');
    expect(failure.message).toBe('Unexpected error while connecting: plain failure');
  });

  it('keeps the server code and code name of SERVER_ERRORs as detail', () => {
    const failure = toConnectError(
      driverError('MongoServerError', 'not authorized on admin', {
        code: 13,
        codeName: 'Unauthorized',
      }),
    );
    expect(failure.code).toBe('SERVER_ERROR');
    expect(failure.message).toBe('The server refused the command: not authorized on admin');
    expect(failure.detail).toEqual({ serverCode: 13, codeName: 'Unauthorized' });
  });

  it('leaves non-integer or missing server codes out of the detail', () => {
    const failure = toConnectError(
      driverError('MongoServerError', 'odd', { code: 1.5, codeName: 'Odd' }),
    );
    expect(failure.detail).toEqual({ codeName: 'Odd' });
    const bare = toConnectError(driverError('MongoServerError', 'odd'));
    expect(bare.code).toBe('SERVER_ERROR');
    expect(bare.detail).toEqual({});
  });

  it('masks connection strings and removes the given secret values from the message', () => {
    const failure = toConnectError(
      sysError(
        'ECONNREFUSED',
        `connect to mongodb://alice:${FICTITIOUS_PASSWORD}@db.example.test:27017 refused; ` +
          `password was ${FICTITIOUS_PASSWORD}`,
      ),
      [FICTITIOUS_PASSWORD],
    );
    expect(failure.code).toBe('NETWORK_ERROR');
    expect(failure.message).not.toContain(FICTITIOUS_PASSWORD);
    expect(failure.message).toContain('db.example.test');
    expect(failure.message).toContain('****');
  });

  it('masks a password in a connection string even when it is not among the secrets', () => {
    const failure = toConnectError(
      new Error(`bad uri mongodb://alice:${FICTITIOUS_PASSWORD}@db.example.test/`),
    );
    expect(failure.message).not.toContain(FICTITIOUS_PASSWORD);
  });
});

describe('redact', () => {
  it('replaces every occurrence of each secret, literally (no regex)', () => {
    const secret = 'a.b*c(d)';
    expect(redact(`x ${secret} y ${secret} axbbc`, [secret])).toBe('x **** y **** axbbc');
  });

  it('ignores empty secrets and leaves text without secrets alone', () => {
    expect(redact('nothing to hide', ['', 'absent'])).toBe('nothing to hide');
    expect(redact('nothing to hide')).toBe('nothing to hide');
  });

  it('masks the password of a connection string and keeps the user and host', () => {
    const out = redact(`using mongodb+srv://alice:${FICTITIOUS_PASSWORD}@cluster0.example.test/db`);
    expect(out).not.toContain(FICTITIOUS_PASSWORD);
    expect(out).toContain('cluster0.example.test');
  });
});
