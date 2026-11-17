import { readFileSync } from 'node:fs';

import type { ProfileDraft } from '@thicket/contract';
import { parseConnectionString } from '@thicket/core';
import type { MongoClientOptions, W } from 'mongodb';

import { awsAuthOptions } from '../auth/aws';
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

/** Mechanisms this build connects with; the others belong to later tasks (LDAP, OIDC, Kerberos). */
const SUPPORTED_MECHANISMS = new Set([
  'NONE',
  'SCRAM-SHA-1',
  'SCRAM-SHA-256',
  'MONGODB-X509',
  'MONGODB-AWS',
]);

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
  if (auth?.mechanism === 'MONGODB-AWS') {
    Object.assign(options, awsAuthOptions(auth, secrets, uriUsername(profile.connectionString)));
  } else if (auth?.mechanism !== 'NONE' && auth?.mechanism !== 'MONGODB-X509') {
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
        const passphrase = secrets['tlsKeyPassphrase'];
        if (tls.keyFile === undefined) {
          options.tlsCertificateKeyFile = tls.certificateKeyFile;
          if (passphrase !== undefined) options.tlsCertificateKeyFilePassword = passphrase;
        } else {
          // Separate certificate and key files: the driver only reads PEM bundles itself.
          options.cert = readPem(tls.certificateKeyFile, 'client certificate');
          options.key = readPem(tls.keyFile, 'client certificate key');
          if (passphrase !== undefined) options.passphrase = passphrase;
        }
      }
      if (tls.allowInvalidHostnames !== undefined) {
        options.tlsAllowInvalidHostnames = tls.allowInvalidHostnames;
      }
      if (tls.allowInvalidCertificates !== undefined) {
        options.tlsAllowInvalidCertificates = tls.allowInvalidCertificates;
      }
    }
  }

  if (auth?.mechanism === 'MONGODB-X509') {
    if (tls?.enabled !== true || tls.certificateKeyFile === undefined) {
      throw new RpcError(
        'AUTH_FAILED',
        'MONGODB-X509 authentication needs TLS with a client certificate',
      );
    }
    options.authMechanism = 'MONGODB-X509';
    // X.509 users live in `$external`; another authSource only makes the driver refuse.
    options.authSource = '$external';
    // The server takes the user from the certificate's subject when no name is given.
    // The driver wants both keys; an empty password means "none" for MONGODB-X509.
    if (auth.username !== undefined) options.auth = { username: auth.username, password: '' };
  }

  const proxy = profile.proxy;
  if (proxy) {
    options.proxyHost = proxy.host;
    options.proxyPort = proxy.port;
    if (proxy.username !== undefined) {
      const proxyPassword = secrets['proxyPassword'];
      if (proxyPassword === undefined) {
        throw new RpcError(
          'AUTH_FAILED',
          `No password for proxy user ${proxy.username}: save it in the profile`,
        );
      }
      options.proxyUsername = proxy.username;
      options.proxyPassword = proxyPassword;
    }
  }

  if (profile.readPreference !== undefined) options.readPreference = profile.readPreference;
  if (profile.readPreferenceTags !== undefined) {
    options.readPreferenceTags = profile.readPreferenceTags.map((set) =>
      Object.fromEntries(set.map(({ name, value }) => [name, value])),
    );
  }
  const writeConcern = profile.writeConcern;
  if (writeConcern) {
    options.writeConcern = {
      // The driver types `w` as a number or 'majority'; custom write concern names (tag sets
      // in the replica set config) are passed on to the server as they are.
      ...(writeConcern.w !== undefined ? { w: writeConcern.w as W } : {}),
      ...(writeConcern.journal !== undefined ? { journal: writeConcern.journal } : {}),
      ...(writeConcern.wtimeoutMS !== undefined ? { wtimeoutMS: writeConcern.wtimeoutMS } : {}),
    };
  }
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

/** Reads a PEM file named in the profile; a missing or unreadable file is a `TLS_ERROR`. */
function readPem(path: string, what: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code ?? String(error);
    throw new RpcError('TLS_ERROR', `Cannot read the ${what} file ${path} (${reason})`);
  }
}
