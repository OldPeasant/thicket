import type { ProfileDraft } from '@thicket/contract';
import { describe, expect, it } from 'vitest';

import { RpcError } from '../../server/rpc';
import { ldapAuthOptions } from './ldap';

/** Fictitious test password; generated per run would add nothing for a pure mapping. */
const PASSWORD = 'fictitious-ldap-password';

type Auth = NonNullable<ProfileDraft['auth']>;

function auth(extra: Partial<Auth> = {}): Auth {
  return { mechanism: 'PLAIN', secretMode: 'saved', ...extra };
}

function errorOf(run: () => unknown): RpcError | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    expect(error).toBeInstanceOf(RpcError);
    return error as RpcError;
  }
}

describe('ldapAuthOptions', () => {
  it('passes the profile user and the password to PLAIN against $external', () => {
    expect(ldapAuthOptions(auth({ username: 'alice' }), { password: PASSWORD }, undefined)).toEqual(
      {
        authMechanism: 'PLAIN',
        authSource: '$external',
        auth: { username: 'alice', password: PASSWORD },
      },
    );
  });

  it('always uses $external, whatever authSource the profile has', () => {
    const options = ldapAuthOptions(
      auth({ username: 'alice', authSource: 'admin' }),
      { password: PASSWORD },
      undefined,
    );
    expect(options.authSource).toBe('$external');
  });

  it('takes the user name from the connection string when the profile has none', () => {
    const options = ldapAuthOptions(auth(), { password: PASSWORD }, 'bob');
    expect(options.auth).toEqual({ username: 'bob', password: PASSWORD });
  });

  it('prefers the profile user name over the one in the connection string', () => {
    const options = ldapAuthOptions(auth({ username: 'alice' }), { password: PASSWORD }, 'bob');
    expect(options.auth?.username).toBe('alice');
  });

  it('answers AUTH_FAILED without a user name', () => {
    const error = errorOf(() => ldapAuthOptions(auth(), { password: PASSWORD }, undefined));
    expect(error?.code).toBe('AUTH_FAILED');
  });

  it('answers AUTH_FAILED without a password, naming the user but no secret', () => {
    const error = errorOf(() =>
      ldapAuthOptions(auth({ username: 'alice' }), { tlsKeyPassphrase: PASSWORD }, undefined),
    );
    expect(error?.code).toBe('AUTH_FAILED');
    expect(error?.message).toContain('alice');
    expect(error?.message).not.toContain(PASSWORD);
  });

  it("answers AUTH_FAILED with secretMode 'none' (LDAP has no password-less bind)", () => {
    const error = errorOf(() =>
      ldapAuthOptions(
        auth({ username: 'alice', secretMode: 'none' }),
        { password: PASSWORD },
        undefined,
      ),
    );
    expect(error?.code).toBe('AUTH_FAILED');
  });
});
