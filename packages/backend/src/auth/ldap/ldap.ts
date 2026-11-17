import type { ProfileDraft } from '@thicket/contract';
import type { MongoClientOptions } from 'mongodb';

import { RpcError } from '../../server/rpc';

/** Secrets a connect may use, by `SecretKind` (same shape as `ConnectSecrets`). */
type Secrets = Partial<Record<string, string>>;

type ProfileAuth = NonNullable<ProfileDraft['auth']>;

/**
 * Driver options for LDAP authentication (`PLAIN`, MongoDB Enterprise or Atlas): the server checks
 * the user name and password against its LDAP directory, so both go to the server as they are
 * (use TLS outside a test setup: PLAIN sends the password in clear text).
 *
 * - The user name is the profile's, else the one in the connection string; there must be one.
 * - The password is the `password` secret (typed at connect, or the saved one; the connection
 *   manager already drops a saved one for `secretMode: 'ask'`). `secretMode: 'none'` or no password
 *   is `AUTH_FAILED`: LDAP has no password-less bind.
 * - LDAP users live in `$external`, whatever `authSource` the profile has.
 */
export function ldapAuthOptions(
  auth: ProfileAuth,
  secrets: Secrets,
  uriUsername: string | undefined,
): MongoClientOptions {
  const username = auth.username ?? uriUsername;
  if (username === undefined) {
    throw new RpcError('AUTH_FAILED', 'LDAP authentication needs a user name');
  }
  const password = auth.secretMode === 'none' ? undefined : secrets['password'];
  if (password === undefined) {
    throw new RpcError(
      'AUTH_FAILED',
      `No password for LDAP user ${username}: enter it or save it in the profile`,
    );
  }
  return {
    authMechanism: 'PLAIN',
    authSource: '$external',
    auth: { username, password },
  };
}
