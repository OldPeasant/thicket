import type { ProfileDraft } from '@thicket/contract';
import type { MongoClientOptions } from 'mongodb';

import { RpcError } from '../../server/rpc';

/** Secrets a connect may use, by `SecretKind` (same shape as `ConnectSecrets`). */
type Secrets = Partial<Record<string, string>>;

type ProfileAuth = NonNullable<ProfileDraft['auth']>;

/**
 * Driver options for MONGODB-AWS (driver 7 takes AWS credentials only from a credential provider,
 * never from `auth` or `AWS_SESSION_TOKEN`).
 *
 * - Explicit keys: the profile's user name is the access key ID; the secret access key is the
 *   `password` secret, i.e. the one typed at connect or the stored `password` kind (the profile's
 *   primary secret and what the connection editor saves; with `secretMode: 'ask'` only the typed
 *   one), which wins over a stored `awsSecretAccessKey`, a fallback used only with
 *   `secretMode: 'saved'`; a stored `awsSessionToken` is added for temporary credentials. `secretMode: 'none'` with an access key ID is refused (no secret to sign with).
 *   They go to the driver as a static `AWS_CREDENTIAL_PROVIDER`.
 * - No user name: the default AWS credential chain of `@aws-sdk/credential-providers`
 *   (environment, SSO, web identity, shared config/credentials files and `AWS_PROFILE`, ECS/EC2
 *   instance role), which the driver builds itself (honouring `AWS_REGION` and
 *   `AWS_STS_REGIONAL_ENDPOINTS`) when no provider is given.
 *
 * `uriUsername` is the user name in the connection string: the driver refuses one for MONGODB-AWS.
 */
export function awsAuthOptions(
  auth: ProfileAuth,
  secrets: Secrets,
  uriUsername: string | undefined,
): MongoClientOptions {
  if (uriUsername !== undefined) {
    throw new RpcError(
      'AUTH_FAILED',
      'MONGODB-AWS takes no user name in the connection string: put the access key ID in the profile',
    );
  }
  // AWS users live in `$external`, whatever the profile says.
  const options: MongoClientOptions = { authMechanism: 'MONGODB-AWS', authSource: '$external' };
  const accessKeyId = auth.username;
  if (accessKeyId === undefined) return options;

  // `password` (typed, or the stored primary secret) wins; the stored `awsSecretAccessKey` is only
  // a fallback for `secretMode: 'saved'`.
  const secretAccessKey =
    auth.secretMode === 'none'
      ? undefined
      : (secrets['password'] ??
        (auth.secretMode === 'saved' ? secrets['awsSecretAccessKey'] : undefined));
  if (secretAccessKey === undefined) {
    throw new RpcError(
      'AUTH_FAILED',
      `No secret access key for AWS access key ${accessKeyId}: enter it or save it in the profile`,
    );
  }
  const sessionToken = secrets['awsSessionToken'];
  const credentials = {
    accessKeyId,
    secretAccessKey,
    ...(sessionToken !== undefined ? { sessionToken } : {}),
  };
  options.authMechanismProperties = { AWS_CREDENTIAL_PROVIDER: () => Promise.resolve(credentials) };
  return options;
}
