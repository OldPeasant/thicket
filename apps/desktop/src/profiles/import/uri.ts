import type { ProfileDraft, SecretKind } from '@thicket/contract';
import {
  mask,
  parseConnectionString,
  toConnectionString,
  type ConnectionUriModel,
} from '@thicket/core/uri';

type Mechanism = NonNullable<ProfileDraft['auth']>['mechanism'];

/** A secret found in an imported connection string or Compass entry, to go to `secrets.bin`. */
export interface ImportedSecret {
  kind: SecretKind;
  value: string;
}

/** A profile built from an imported connection, plus the secrets that were taken out of it. */
export interface ImportedConnection {
  /** Without `id`; `auth.secretMode` is `saved` when a password was found (see `secrets`). */
  draft: ProfileDraft;
  secrets: ImportedSecret[];
}

/** Mechanisms whose `password` secret is the user's password. */
const PASSWORD_MECHANISMS = new Set<Mechanism>(['SCRAM-SHA-1', 'SCRAM-SHA-256', 'PLAIN']);

/** Query options whose whole value is a secret (lower case; URI keys are case-insensitive). */
const SECRET_OPTIONS = new Map<string, SecretKind>([
  ['proxypassword', 'proxyPassword'],
  ['tlscertificatekeyfilepassword', 'tlsKeyPassphrase'],
]);

/** `authMechanismProperties` key of the AWS session token (lower case). */
const AWS_SESSION_TOKEN = 'aws_session_token';

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value;
}

/** Takes the AWS session token out of an unparsed `KEY:value,...` (from `extra`). */
function takeSessionToken(value: string, found: (token: string) => void): string {
  return value
    .split(',')
    .filter((entry) => {
      const colon = entry.indexOf(':');
      const key = (colon < 0 ? entry : entry.slice(0, colon)).trim().toLowerCase();
      if (key !== AWS_SESSION_TOKEN) return true;
      if (colon >= 0) found(entry.slice(colon + 1));
      return false;
    })
    .join(',');
}

/**
 * Takes every secret out of the model, in place: the password, `proxyPassword`,
 * `tlsCertificateKeyFilePassword` and the `AWS_SESSION_TOKEN` auth mechanism property (also when
 * the parser kept them in `extra`). The password's kind is decided by the caller (`password`).
 */
function takeSecrets(model: ConnectionUriModel): {
  password?: string;
  others: ImportedSecret[];
} {
  const others: ImportedSecret[] = [];
  const add = (kind: SecretKind, value: string | undefined): void => {
    if (value !== undefined && value !== '' && !others.some((s) => s.kind === kind))
      others.push({ kind, value });
  };
  const password = model.password;
  delete model.password;
  add('proxyPassword', model.proxy.password);
  delete model.proxy.password;
  add('tlsKeyPassphrase', model.tls.certificateKeyFilePassword);
  delete model.tls.certificateKeyFilePassword;
  const props = model.auth.mechanismProperties;
  if (props) {
    for (const key of Object.keys(props)) {
      if (key.toLowerCase() === AWS_SESSION_TOKEN) {
        add('awsSessionToken', props[key]);
        Reflect.deleteProperty(props, key);
      }
    }
    if (Object.keys(props).length === 0) delete model.auth.mechanismProperties;
  }
  for (const [key, value] of Object.entries(model.extra)) {
    const lower = key.toLowerCase();
    const values = Array.isArray(value) ? value : [value];
    const kind = SECRET_OPTIONS.get(lower);
    if (kind !== undefined) {
      add(kind, values[0]);
      Reflect.deleteProperty(model.extra, key);
    } else if (lower === 'authmechanismproperties') {
      const kept = values
        .map((v) => takeSessionToken(v, (token) => add('awsSessionToken', token)))
        .filter((v) => v !== '');
      if (kept.length === 0) Reflect.deleteProperty(model.extra, key);
      else model.extra[key] = kept.length === 1 ? (kept[0] as string) : kept;
    }
  }
  return password === undefined || password === '' ? { others } : { password, others };
}

/**
 * A connection string without any secret (password, `proxyPassword`,
 * `tlsCertificateKeyFilePassword`, `AWS_SESSION_TOKEN`). One that can't be parsed is masked.
 */
export function uriWithoutSecrets(uri: string): string {
  try {
    const model = parseConnectionString(uri);
    takeSecrets(model);
    return toConnectionString(model);
  } catch {
    return mask(uri);
  }
}

/**
 * Takes every secret (password, `proxyPassword`, `tlsCertificateKeyFilePassword`,
 * `AWS_SESSION_TOKEN`) out of a connection string and reports the kinds that were removed. The
 * string is returned unchanged when it holds none. Throws `ConnectionStringError` for an invalid
 * URI (its message never contains the password).
 */
export function stripUriSecrets(uri: string): { uri: string; removed: SecretKind[] } {
  const model = parseConnectionString(uri);
  const { password, others } = takeSecrets(model);
  const removed: SecretKind[] = [
    ...(password !== undefined ? (['password'] as const) : []),
    ...others.map((s) => s.kind),
  ];
  return removed.length === 0 ? { uri, removed } : { uri: toConnectionString(model), removed };
}

/** `host:port, host2` (SRV: the host name) as a default profile name. */
export function defaultName(model: ConnectionUriModel): string {
  return model.hosts
    .map(({ host, port }) => {
      const name = host.includes(':') ? `[${host}]` : host;
      return port === undefined ? name : `${name}:${String(port)}`;
    })
    .join(', ');
}

/**
 * Builds a profile from a connection string, the way the connection editor would save it: the
 * URI without any secret becomes `connectionString`, and its user, mechanism, `authSource`, TLS
 * files and flags, read preference, write concern, app name, timeouts and SOCKS5 proxy are
 * mirrored into the profile's fields. Secrets found in it are returned in `secrets` (the password
 * as `password`, for MONGODB-AWS as the secret access key), and `auth.secretMode` is `saved` when
 * a password was there, `ask` when a password mechanism has none. Throws `ConnectionStringError`
 * for an invalid URI (its message never contains the password).
 */
export function profileFromUri(uri: string, name?: string): ImportedConnection {
  const model = parseConnectionString(uri);
  const { password, others } = takeSecrets(model);
  const secrets: ImportedSecret[] = [];

  const username = nonEmpty(model.username);
  const uriMechanism = model.auth.mechanism;
  const mechanism: Mechanism =
    uriMechanism !== undefined && uriMechanism !== 'DEFAULT'
      ? uriMechanism
      : username !== undefined
        ? 'SCRAM-SHA-256'
        : 'NONE';
  if (mechanism === 'MONGODB-AWS') {
    // The backend wants the access key ID in the profile, never in the connection string.
    delete model.username;
  }

  const draft: ProfileDraft = {
    name: nonEmpty(name)?.trim() ?? defaultName(model),
    connectionString: toConnectionString(model),
    readOnly: false,
    production: false,
  };

  if (mechanism !== 'NONE') {
    const usesSecret = PASSWORD_MECHANISMS.has(mechanism) || mechanism === 'MONGODB-AWS';
    if (usesSecret && password !== undefined) secrets.push({ kind: 'password', value: password });
    draft.auth = {
      mechanism,
      secretMode: !usesSecret ? 'none' : password !== undefined ? 'saved' : 'ask',
    };
    if (username !== undefined) draft.auth.username = username;
    const source = nonEmpty(model.auth.source);
    if (source !== undefined && mechanism !== 'MONGODB-X509' && mechanism !== 'MONGODB-AWS')
      draft.auth.authSource = source;
  }

  const tls = model.tls;
  const tlsSet =
    tls.enabled !== undefined ||
    nonEmpty(tls.caFile) !== undefined ||
    nonEmpty(tls.certificateKeyFile) !== undefined ||
    tls.allowInvalidHostnames !== undefined ||
    tls.allowInvalidCertificates !== undefined;
  if (tlsSet) {
    draft.tls = { enabled: tls.enabled ?? model.scheme === 'mongodb+srv' };
    const caFile = nonEmpty(tls.caFile);
    if (caFile !== undefined) draft.tls.caFile = caFile;
    const certificateKeyFile = nonEmpty(tls.certificateKeyFile);
    if (certificateKeyFile !== undefined) draft.tls.certificateKeyFile = certificateKeyFile;
    if (tls.allowInvalidHostnames !== undefined)
      draft.tls.allowInvalidHostnames = tls.allowInvalidHostnames;
    if (tls.allowInvalidCertificates !== undefined)
      draft.tls.allowInvalidCertificates = tls.allowInvalidCertificates;
  }

  const mode = model.readPreference.mode;
  if (mode !== undefined) draft.readPreference = mode;
  const tags = model.readPreference.tags;
  if (mode !== undefined && mode !== 'primary' && tags && tags.length > 0) {
    const sets = tags.map((set) =>
      Object.entries(set).map(([key, value]) => ({ name: key, value })),
    );
    if (sets.every((set) => set.every((tag) => tag.name !== ''))) draft.readPreferenceTags = sets;
  }
  const wc = model.writeConcern;
  if (wc.w !== undefined || wc.journal !== undefined || wc.wtimeoutMS !== undefined) {
    draft.writeConcern = {};
    if (wc.w !== undefined && wc.w !== '') draft.writeConcern.w = wc.w;
    if (wc.journal !== undefined) draft.writeConcern.journal = wc.journal;
    if (wc.wtimeoutMS !== undefined) draft.writeConcern.wtimeoutMS = wc.wtimeoutMS;
  }
  const appName = nonEmpty(model.appName);
  if (appName !== undefined) draft.appName = appName;
  const { connectTimeoutMS, serverSelectionTimeoutMS } = model.timeouts;
  if (connectTimeoutMS !== undefined && connectTimeoutMS > 0)
    draft.connectTimeoutMS = connectTimeoutMS;
  if (serverSelectionTimeoutMS !== undefined && serverSelectionTimeoutMS > 0)
    draft.serverSelectionTimeoutMS = serverSelectionTimeoutMS;
  const proxyHost = nonEmpty(model.proxy.host);
  if (proxyHost !== undefined) {
    draft.proxy = { host: proxyHost, port: model.proxy.port ?? 1080 };
    const proxyUser = nonEmpty(model.proxy.username);
    if (proxyUser !== undefined) draft.proxy.username = proxyUser;
  }

  for (const secret of others) {
    // Only secrets the profile uses are kept (a proxy password needs a proxy user, ...).
    if (secret.kind === 'proxyPassword' && draft.proxy?.username === undefined) continue;
    if (secret.kind === 'tlsKeyPassphrase' && draft.tls?.certificateKeyFile === undefined) continue;
    if (secret.kind === 'awsSessionToken' && mechanism !== 'MONGODB-AWS') continue;
    secrets.push(secret);
  }
  return { draft, secrets };
}
