/**
 * The connection part of a profile, as edited by the connection form. `parseConnectionString`
 * fills it from a URI and `toConnectionString` turns it back into one; options Thicket has no
 * field for are kept verbatim in `extra`, so a round trip never drops anything.
 */

export type UriScheme = 'mongodb' | 'mongodb+srv';

export interface UriHost {
  /** Host name, IPv4/IPv6 address (without brackets) or Unix socket path (decoded). */
  host: string;
  /** Absent when the URI names no port (the driver then uses 27017). */
  port?: number;
}

export const AUTH_MECHANISMS = [
  'DEFAULT',
  'SCRAM-SHA-1',
  'SCRAM-SHA-256',
  'MONGODB-X509',
  'MONGODB-AWS',
  'MONGODB-OIDC',
  'GSSAPI',
  'PLAIN',
] as const;
export type AuthMechanism = (typeof AUTH_MECHANISMS)[number];

export const READ_PREFERENCE_MODES = [
  'primary',
  'primaryPreferred',
  'secondary',
  'secondaryPreferred',
  'nearest',
] as const;
export type ReadPreferenceMode = (typeof READ_PREFERENCE_MODES)[number];

export interface AuthOptions {
  mechanism?: AuthMechanism;
  /** `authSource`: the database that holds the user. */
  source?: string;
  /** `authMechanismProperties`, e.g. `{ SERVICE_NAME: 'mongodb' }`. */
  mechanismProperties?: Record<string, string>;
}

export interface TlsOptions {
  /** `tls` (or the legacy alias `ssl`). Absent: driver default (on for SRV, off otherwise). */
  enabled?: boolean;
  caFile?: string;
  certificateKeyFile?: string;
  /** Secret: masked by `mask()`. */
  certificateKeyFilePassword?: string;
  allowInvalidHostnames?: boolean;
  allowInvalidCertificates?: boolean;
  insecure?: boolean;
}

export interface ReadPreferenceOptions {
  mode?: ReadPreferenceMode;
  /** One entry per `readPreferenceTags` option, in order; `{}` matches any member. */
  tags?: Record<string, string>[];
  maxStalenessSeconds?: number;
}

export interface WriteConcernOptions {
  /** A number of members, `'majority'` or a custom write concern tag name. */
  w?: number | string;
  journal?: boolean;
  wtimeoutMS?: number;
}

export const TIMEOUT_OPTIONS = [
  'connectTimeoutMS',
  'serverSelectionTimeoutMS',
  'socketTimeoutMS',
  'maxIdleTimeMS',
  'waitQueueTimeoutMS',
  'heartbeatFrequencyMS',
  'localThresholdMS',
  'timeoutMS',
] as const;
export type TimeoutOption = (typeof TIMEOUT_OPTIONS)[number];
export type TimeoutOptions = Partial<Record<TimeoutOption, number>>;

export interface ProxyOptions {
  /** SOCKS5 proxy host (`proxyHost`). */
  host?: string;
  port?: number;
  username?: string;
  /** Secret: masked by `mask()`. */
  password?: string;
}

export interface ConnectionUriModel {
  scheme: UriScheme;
  /** At least one host; exactly one without port for `mongodb+srv`. */
  hosts: UriHost[];
  /** Decoded user name. */
  username?: string;
  /** Decoded password. Secret: masked by `mask()`. */
  password?: string;
  /** Default database from the URI path (decoded). */
  database?: string;
  replicaSet?: string;
  directConnection?: boolean;
  loadBalanced?: boolean;
  auth: AuthOptions;
  tls: TlsOptions;
  readPreference: ReadPreferenceOptions;
  writeConcern: WriteConcernOptions;
  appName?: string;
  timeouts: TimeoutOptions;
  proxy: ProxyOptions;
  /**
   * Every option Thicket has no field for, plus known options whose value is invalid or repeated,
   * with the key as written in the URI and the decoded value. Repeated keys keep all values.
   */
  extra: Record<string, string | string[]>;
}

/** An empty model for a new profile: `mongodb://localhost:27017`. */
export function emptyConnectionModel(): ConnectionUriModel {
  return {
    scheme: 'mongodb',
    hosts: [{ host: 'localhost', port: 27017 }],
    auth: {},
    tls: {},
    readPreference: {},
    writeConcern: {},
    timeouts: {},
    proxy: {},
    extra: {},
  };
}
