import type { ProfileDraft } from '@thicket/contract';
import { parseConnectionString } from '@thicket/core';
import type { MongoClientOptions } from 'mongodb';

import { RpcError } from '../server/rpc';

/** Secrets a connect may use, by `SecretKind` (from `secrets.get` or the request). */
export type ConnectSecrets = Partial<Record<string, string>>;

/** What `new MongoClient(uri, options)` gets for a profile. */
export interface ClientConfig {
  uri: string;
  options: MongoClientOptions;
}

/** `appName` when the profile sets none, so server logs show who connected. */
export const DEFAULT_APP_NAME = 'Thicket';

/** Mechanisms this build connects with; the others belong to later tasks (X.509, LDAP, OIDC, AWS, Kerberos). */
const SUPPORTED_MECHANISMS = new Set(['NONE', 'SCRAM-SHA-1', 'SCRAM-SHA-256']);

/**
 * Builds the driver configuration of a profile. The connection string stays as saved (hosts,
 * `mongodb+srv://`, `replicaSet`, `directConnection` and other URI options come from there); the
 * profile's form fields and the secrets are passed as driver options, which take precedence over
 * the same options in the URI. Passwords never go into the URI, so it can be logged masked.
 */
export function clientConfig(profile: ProfileDraft, secrets: ConnectSecrets): ClientConfig {
  if (profile.ssh) {
    throw new RpcError('UNSUPPORTED', 'SSH tunnels are not supported by this build yet');
  }
  const options: MongoClientOptions = { appName: profile.appName ?? DEFAULT_APP_NAME };

  const auth = profile.auth;
  if (auth && !SUPPORTED_MECHANISMS.has(auth.mechanism)) {
    throw new RpcError(
      'UNSUPPORTED',
      `Authentication mechanism ${auth.mechanism} is not supported by this build yet`,
    );
  }
  if (auth?.mechanism !== 'NONE') {
    const username = auth?.username ?? uriUsername(profile.connectionString);
    const needsPassword = auth !== undefined && auth.secretMode !== 'none';
    const password = auth?.secretMode === 'none' ? undefined : secrets['password'];
    if (username !== undefined && needsPassword && password === undefined) {
      throw new RpcError(
        'AUTH_FAILED',
        `No password for user ${username}: enter it or save it in the profile`,
      );
    }
    if (username !== undefined && password !== undefined) {
      options.auth = { username, password };
    } else if (auth?.username !== undefined) {
      options.auth = { username: auth.username };
    }
    if (auth?.mechanism === 'SCRAM-SHA-1' || auth?.mechanism === 'SCRAM-SHA-256') {
      options.authMechanism = auth.mechanism;
    }
    if (auth?.authSource !== undefined) options.authSource = auth.authSource;
  }

  const tls = profile.tls;
  if (tls) {
    options.tls = tls.enabled;
    if (tls.enabled) {
      if (tls.caFile !== undefined) options.tlsCAFile = tls.caFile;
      if (tls.certificateKeyFile !== undefined) {
        options.tlsCertificateKeyFile = tls.certificateKeyFile;
        const passphrase = secrets['tlsKeyPassphrase'];
        if (passphrase !== undefined) options.tlsCertificateKeyFilePassword = passphrase;
      }
      if (tls.allowInvalidHostnames !== undefined) {
        options.tlsAllowInvalidHostnames = tls.allowInvalidHostnames;
      }
      if (tls.allowInvalidCertificates !== undefined) {
        options.tlsAllowInvalidCertificates = tls.allowInvalidCertificates;
      }
    }
  }

  if (profile.readPreference !== undefined) options.readPreference = profile.readPreference;
  if (profile.connectTimeoutMS !== undefined) options.connectTimeoutMS = profile.connectTimeoutMS;
  if (profile.serverSelectionTimeoutMS !== undefined) {
    options.serverSelectionTimeoutMS = profile.serverSelectionTimeoutMS;
  }
  return { uri: profile.connectionString, options };
}

/** The (decoded) user name in a connection string's userinfo, if any. */
function uriUsername(uri: string): string | undefined {
  try {
    return parseConnectionString(uri).username;
  } catch {
    // The driver reports an invalid connection string itself, with a better message.
    return undefined;
  }
}
