import ConnectionString from 'mongodb-connection-string-url';

import { maskText } from './mask';
import {
  AUTH_MECHANISMS,
  READ_PREFERENCE_MODES,
  TIMEOUT_OPTIONS,
  emptyConnectionModel,
  type AuthMechanism,
  type ConnectionUriModel,
  type ReadPreferenceMode,
  type UriHost,
} from './model';

/** A connection string that can't be parsed, or a model that can't be written as one. */
export class ConnectionStringError extends Error {
  override name = 'ConnectionStringError';
}

type Model = ConnectionUriModel;

/**
 * One URI option Thicket maps to a model field. `read` returns false for a value it can't
 * represent; the option then goes to `extra` unchanged. The order of `OPTIONS` is the order
 * `toConnectionString` writes them in.
 */
interface OptionSpec {
  key: string;
  aliases?: readonly string[];
  repeatable?: boolean;
  isSet(m: Model): boolean;
  read(m: Model, value: string): boolean;
  write(m: Model): string[];
}

const DIGITS = /^\d+$/;

function parseUint(value: string): number | undefined {
  if (!DIGITS.test(value)) return undefined;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : undefined;
}

function parsePort(value: string): number | undefined {
  const n = parseUint(value);
  return n !== undefined && n >= 1 && n <= 65535 ? n : undefined;
}

function parseBool(value: string): boolean | undefined {
  return value === 'true' ? true : value === 'false' ? false : undefined;
}

/**
 * Sets an own property even for keys like `__proto__` (keys come from user input; a plain
 * assignment would change the prototype instead of storing an entry).
 */
function setOwn<T>(obj: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

/** `KEY:value,KEY2:value2` (authMechanismProperties, readPreferenceTags). */
function parsePairs(value: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  if (value === '') return out;
  for (const entry of value.split(',')) {
    const colon = entry.indexOf(':');
    if (colon <= 0) return undefined;
    const k = entry.slice(0, colon);
    if (Object.hasOwn(out, k)) return undefined;
    setOwn(out, k, entry.slice(colon + 1));
  }
  return out;
}

function writePairs(pairs: Record<string, string>): string {
  return Object.entries(pairs)
    .map(([k, v]) => `${k}:${v}`)
    .join(',');
}

function one(v: string | number | boolean | undefined): string[] {
  return v === undefined ? [] : [String(v)];
}

function stringOption(
  key: string,
  get: (m: Model) => string | undefined,
  set: (m: Model, v: string) => void,
): OptionSpec {
  return {
    key,
    isSet: (m) => get(m) !== undefined,
    read: (m, v) => {
      if (v === '') return false;
      set(m, v);
      return true;
    },
    write: (m) => one(get(m)),
  };
}

function boolOption(
  key: string,
  get: (m: Model) => boolean | undefined,
  set: (m: Model, v: boolean) => void,
  aliases?: readonly string[],
): OptionSpec {
  return {
    key,
    aliases,
    isSet: (m) => get(m) !== undefined,
    read: (m, v) => {
      const b = parseBool(v);
      if (b === undefined) return false;
      set(m, b);
      return true;
    },
    write: (m) => one(get(m)),
  };
}

function numberOption(
  key: string,
  get: (m: Model) => number | undefined,
  set: (m: Model, v: number) => void,
  parse: (v: string) => number | undefined = parseUint,
  aliases?: readonly string[],
): OptionSpec {
  return {
    key,
    aliases,
    isSet: (m) => get(m) !== undefined,
    read: (m, v) => {
      const n = parse(v);
      if (n === undefined) return false;
      set(m, n);
      return true;
    },
    write: (m) => one(get(m)),
  };
}

function enumOption<T extends string>(
  key: string,
  values: readonly T[],
  get: (m: Model) => T | undefined,
  set: (m: Model, v: T) => void,
): OptionSpec {
  return {
    key,
    isSet: (m) => get(m) !== undefined,
    read: (m, v) => {
      const match = values.find((x) => x === v);
      if (match === undefined) return false;
      set(m, match);
      return true;
    },
    write: (m) => one(get(m)),
  };
}

const OPTIONS: readonly OptionSpec[] = [
  stringOption(
    'replicaSet',
    (m) => m.replicaSet,
    (m, v) => (m.replicaSet = v),
  ),
  boolOption(
    'directConnection',
    (m) => m.directConnection,
    (m, v) => (m.directConnection = v),
  ),
  boolOption(
    'loadBalanced',
    (m) => m.loadBalanced,
    (m, v) => (m.loadBalanced = v),
  ),
  stringOption(
    'authSource',
    (m) => m.auth.source,
    (m, v) => (m.auth.source = v),
  ),
  enumOption<AuthMechanism>(
    'authMechanism',
    AUTH_MECHANISMS,
    (m) => m.auth.mechanism,
    (m, v) => (m.auth.mechanism = v),
  ),
  {
    key: 'authMechanismProperties',
    isSet: (m) => m.auth.mechanismProperties !== undefined,
    read: (m, v) => {
      const pairs = v === '' ? undefined : parsePairs(v);
      if (pairs === undefined) return false;
      m.auth.mechanismProperties = pairs;
      return true;
    },
    write: (m) => {
      const p = m.auth.mechanismProperties;
      return p === undefined || Object.keys(p).length === 0 ? [] : [writePairs(p)];
    },
  },
  boolOption(
    'tls',
    (m) => m.tls.enabled,
    (m, v) => (m.tls.enabled = v),
    ['ssl'],
  ),
  stringOption(
    'tlsCAFile',
    (m) => m.tls.caFile,
    (m, v) => (m.tls.caFile = v),
  ),
  stringOption(
    'tlsCertificateKeyFile',
    (m) => m.tls.certificateKeyFile,
    (m, v) => (m.tls.certificateKeyFile = v),
  ),
  stringOption(
    'tlsCertificateKeyFilePassword',
    (m) => m.tls.certificateKeyFilePassword,
    (m, v) => (m.tls.certificateKeyFilePassword = v),
  ),
  boolOption(
    'tlsAllowInvalidCertificates',
    (m) => m.tls.allowInvalidCertificates,
    (m, v) => (m.tls.allowInvalidCertificates = v),
  ),
  boolOption(
    'tlsAllowInvalidHostnames',
    (m) => m.tls.allowInvalidHostnames,
    (m, v) => (m.tls.allowInvalidHostnames = v),
  ),
  boolOption(
    'tlsInsecure',
    (m) => m.tls.insecure,
    (m, v) => (m.tls.insecure = v),
  ),
  enumOption<ReadPreferenceMode>(
    'readPreference',
    READ_PREFERENCE_MODES,
    (m) => m.readPreference.mode,
    (m, v) => (m.readPreference.mode = v),
  ),
  {
    key: 'readPreferenceTags',
    repeatable: true,
    isSet: () => false,
    read: (m, v) => {
      const pairs = parsePairs(v);
      if (pairs === undefined) return false;
      (m.readPreference.tags ??= []).push(pairs);
      return true;
    },
    write: (m) => (m.readPreference.tags ?? []).map(writePairs),
  },
  numberOption(
    'maxStalenessSeconds',
    (m) => m.readPreference.maxStalenessSeconds,
    (m, v) => (m.readPreference.maxStalenessSeconds = v),
    (v) => (v === '-1' ? -1 : parseUint(v)),
  ),
  {
    key: 'w',
    isSet: (m) => m.writeConcern.w !== undefined,
    read: (m, v) => {
      if (v === '') return false;
      m.writeConcern.w = parseUint(v) ?? v;
      return true;
    },
    write: (m) => one(m.writeConcern.w),
  },
  boolOption(
    'journal',
    (m) => m.writeConcern.journal,
    (m, v) => (m.writeConcern.journal = v),
    ['j'],
  ),
  numberOption(
    'wtimeoutMS',
    (m) => m.writeConcern.wtimeoutMS,
    (m, v) => (m.writeConcern.wtimeoutMS = v),
    parseUint,
    ['wtimeout'],
  ),
  ...TIMEOUT_OPTIONS.map((key) =>
    numberOption(
      key,
      (m) => m.timeouts[key],
      (m, v) => (m.timeouts[key] = v),
    ),
  ),
  stringOption(
    'proxyHost',
    (m) => m.proxy.host,
    (m, v) => (m.proxy.host = v),
  ),
  numberOption(
    'proxyPort',
    (m) => m.proxy.port,
    (m, v) => (m.proxy.port = v),
    parsePort,
  ),
  stringOption(
    'proxyUsername',
    (m) => m.proxy.username,
    (m, v) => (m.proxy.username = v),
  ),
  stringOption(
    'proxyPassword',
    (m) => m.proxy.password,
    (m, v) => (m.proxy.password = v),
  ),
  stringOption(
    'appName',
    (m) => m.appName,
    (m, v) => (m.appName = v),
  ),
];

/** URI option keys are case-insensitive; aliases map to their canonical option. */
const OPTION_BY_KEY = new Map<string, OptionSpec>();
for (const spec of OPTIONS) {
  OPTION_BY_KEY.set(spec.key.toLowerCase(), spec);
  for (const alias of spec.aliases ?? []) OPTION_BY_KEY.set(alias.toLowerCase(), spec);
}

function addExtra(m: Model, key: string, value: string): void {
  const prev = Object.hasOwn(m.extra, key) ? m.extra[key] : undefined;
  if (prev === undefined) setOwn(m.extra, key, value);
  else if (Array.isArray(prev)) prev.push(value);
  else setOwn(m.extra, key, [prev, value]);
}

function decode(part: string, what: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    throw new ConnectionStringError(`Invalid percent-encoding in the ${what}`);
  }
}

function parseHost(raw: string): UriHost {
  let host: string;
  let portText: string | undefined;
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    if (end < 0) throw new ConnectionStringError(`Invalid IPv6 host: ${raw}`);
    host = raw.slice(1, end);
    const rest = raw.slice(end + 1);
    if (rest !== '') {
      if (!rest.startsWith(':')) throw new ConnectionStringError(`Invalid host: ${raw}`);
      portText = rest.slice(1);
    }
  } else {
    const colon = raw.lastIndexOf(':');
    host = colon < 0 ? raw : raw.slice(0, colon);
    portText = colon < 0 ? undefined : raw.slice(colon + 1);
    host = decode(host, 'host');
  }
  if (host === '') throw new ConnectionStringError('Empty host name');
  if (portText === undefined) return { host };
  const port = parsePort(portText);
  if (port === undefined) throw new ConnectionStringError(`Invalid port in host ${raw}`);
  return { host, port };
}

/**
 * Parses a `mongodb://` or `mongodb+srv://` connection string into the profile's connection
 * model. Throws `ConnectionStringError` (whose message never contains the password).
 */
export function parseConnectionString(uri: string): ConnectionUriModel {
  let cs: ConnectionString;
  try {
    cs = new ConnectionString(uri.trim());
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new ConnectionStringError(`Invalid connection string: ${maskText(reason)}`);
  }
  const m = emptyConnectionModel();
  m.scheme = cs.isSRV ? 'mongodb+srv' : 'mongodb';
  m.hosts = cs.hosts.map(parseHost);
  if (cs.username !== '') m.username = decode(cs.username, 'user name');
  if (cs.password !== '') m.password = decode(cs.password, 'password');
  const path = cs.pathname.replace(/^\//, '');
  if (path !== '') m.database = decode(path, 'database name');

  for (const [key, value] of cs.searchParams) {
    const spec = OPTION_BY_KEY.get(key.toLowerCase());
    if (spec === undefined || (!spec.repeatable && spec.isSet(m)) || !spec.read(m, value)) {
      addExtra(m, key, value);
    }
  }
  return m;
}

/** Percent-encodes a query key or value, leaving `,` `:` `/` readable (they're safe there). */
function encodeQuery(s: string): string {
  return encodeURIComponent(s).replace(/%2C/gi, ',').replace(/%3A/gi, ':').replace(/%2F/gi, '/');
}

function formatHost({ host, port }: UriHost): string {
  if (host === '') throw new ConnectionStringError('Empty host name');
  // A Unix socket path (contains '/') is percent-encoded even if it contains ':'; only an IPv6
  // address goes in brackets.
  const name = host.includes(':') && !host.includes('/') ? `[${host}]` : encodeURIComponent(host);
  if (port === undefined) return name;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConnectionStringError(`Invalid port ${String(port)} for host ${host}`);
  }
  return `${name}:${String(port)}`;
}

/**
 * Percent-encodes user info. Unlike `encodeURIComponent`, also encodes `'`, so a password in a
 * written URI never contains a quote that could end it early in log scanners.
 */
function encodeUserinfo(s: string): string {
  return encodeURIComponent(s).replace(/'/g, '%27');
}

/**
 * Writes the model as a connection string: known options in a fixed order, then `extra` in its
 * own order. Throws `ConnectionStringError` for a model the driver would reject (no host, SRV
 * with several hosts or a port, a password without a user name). An empty user name counts as
 * none.
 */
export function toConnectionString(model: ConnectionUriModel): string {
  if (model.hosts.length === 0) throw new ConnectionStringError('At least one host is required');
  if (model.scheme === 'mongodb+srv') {
    const [srv] = model.hosts;
    if (model.hosts.length !== 1 || srv?.port !== undefined) {
      throw new ConnectionStringError('mongodb+srv needs exactly one host name and no port');
    }
  }
  const username = model.username === '' ? undefined : model.username;
  if (username === undefined && model.password !== undefined) {
    throw new ConnectionStringError('A password needs a user name');
  }
  let out = `${model.scheme}://`;
  if (username !== undefined) {
    out += encodeUserinfo(username);
    if (model.password !== undefined) out += `:${encodeUserinfo(model.password)}`;
    out += '@';
  }
  out += model.hosts.map(formatHost).join(',');

  const query: string[] = [];
  for (const spec of OPTIONS) {
    for (const value of spec.write(model)) query.push(`${spec.key}=${encodeQuery(value)}`);
  }
  for (const [key, value] of Object.entries(model.extra)) {
    for (const v of Array.isArray(value) ? value : [value]) {
      query.push(`${encodeQuery(key)}=${encodeQuery(v)}`);
    }
  }
  if (model.database !== undefined && model.database !== '') {
    out += `/${encodeURIComponent(model.database)}`;
  } else if (query.length > 0) {
    out += '/';
  }
  if (query.length > 0) out += `?${query.join('&')}`;
  return out;
}
