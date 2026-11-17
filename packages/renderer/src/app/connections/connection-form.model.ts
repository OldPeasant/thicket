import type { OidcFlow, Profile, ProfileDraft } from '@thicket/contract';
import {
  ConnectionStringError,
  MASK,
  emptyConnectionModel,
  mask,
  parseConnectionString,
  toConnectionString,
  type ConnectionUriModel,
} from '@thicket/core/uri';

/**
 * The connection editor's state and its mapping to a profile and to a connection string. The
 * form fields and the connection-string tab edit the same `ConnectionUriModel` (core's
 * `uri` model), so a form edit shows up in the URI and a URI edit in the form. The password is
 * kept apart from the model: it is never part of a saved connection string, and the URI tab
 * shows it as `MASK`.
 */

/** Authentication mechanisms of a profile (`profileAuth.mechanism` in the contract). */
export type ProfileMechanism = NonNullable<Profile['auth']>['mechanism'];

export type SecretMode = NonNullable<Profile['auth']>['secretMode'];

/** Mechanisms the form offers (others of a loaded profile are kept as they are). */
export const FORM_MECHANISMS: readonly ProfileMechanism[] = [
  'NONE',
  'SCRAM-SHA-256',
  'SCRAM-SHA-1',
  'MONGODB-X509',
  'PLAIN',
  'MONGODB-OIDC',
  'MONGODB-AWS',
];

/**
 * Mechanisms whose users live in `$external`: the backend always authenticates against it, so the
 * form has no authentication database for them and the connection string carries no `authSource`.
 */
export function usesExternalSource(mechanism: ProfileMechanism): boolean {
  return (
    mechanism === 'MONGODB-X509' ||
    mechanism === 'PLAIN' ||
    mechanism === 'MONGODB-OIDC' ||
    mechanism === 'MONGODB-AWS' ||
    mechanism === 'GSSAPI'
  );
}

export type SshMethod = NonNullable<Profile['ssh']>['method'];

/** The SSH tunnel fields (`profile.ssh`); `enabled: false` keeps the typed values unsaved. */
export interface SshForm {
  enabled: boolean;
  host: string;
  port?: number;
  username: string;
  method: SshMethod;
  privateKeyFile?: string;
}

/** Secrets besides the database password that this editor stores with `profiles.setSecret`. */
export type ExtraSecretKind =
  'sshPassword' | 'sshKeyPassphrase' | 'tlsKeyPassphrase' | 'proxyPassword' | 'awsSessionToken';

/** Default SSH port. */
export const SSH_DEFAULT_PORT = 22;
/** Default SOCKS5 port (also what the backend uses without one). */
export const PROXY_DEFAULT_PORT = 1080;

export function emptySshForm(): SshForm {
  return { enabled: false, host: '', port: SSH_DEFAULT_PORT, username: '', method: 'password' };
}

/**
 * The extra secrets the current settings use (only these are stored on save): the SSH password
 * or key passphrase, the client key passphrase, the proxy password.
 */
export function usedSecretKinds(state: EditorState): ExtraSecretKind[] {
  const kinds: ExtraSecretKind[] = [];
  if (state.ssh.enabled) {
    if (state.ssh.method === 'password') kinds.push('sshPassword');
    if (state.ssh.method === 'privateKey') kinds.push('sshKeyPassphrase');
  }
  const tls = state.model.tls;
  const tlsOn = tls.enabled ?? state.model.scheme === 'mongodb+srv';
  if (tlsOn && nonEmpty(tls.certificateKeyFile) !== undefined) kinds.push('tlsKeyPassphrase');
  if (nonEmpty(state.model.proxy.host) !== undefined && nonEmpty(state.model.proxy.username)) {
    kinds.push('proxyPassword');
  }
  if (awsKeys(state)) kinds.push('awsSessionToken');
  return kinds;
}

/** Mechanism a user name without `authMechanism` gets (MongoDB's default since 4.0). */
export const DEFAULT_PASSWORD_MECHANISM: ProfileMechanism = 'SCRAM-SHA-256';

/**
 * Mechanisms that can authenticate with the profile's `password` secret (and so have a secret
 * mode): SCRAM and LDAP always, AWS IAM when an access key ID is given (the secret access key is
 * its `password`; without a key ID the default AWS credential chain needs no secret).
 */
export function usesPassword(mechanism: ProfileMechanism): boolean {
  return (
    mechanism === 'SCRAM-SHA-1' ||
    mechanism === 'SCRAM-SHA-256' ||
    mechanism === 'PLAIN' ||
    mechanism === 'MONGODB-AWS'
  );
}

/** AWS IAM with explicit keys: an access key ID (the user name) is given. */
export function awsKeys(state: Pick<EditorState, 'mechanism' | 'model'>): boolean {
  return state.mechanism === 'MONGODB-AWS' && nonEmpty(state.model.username) !== undefined;
}

/**
 * Whether the current settings authenticate with the password field: SCRAM and LDAP, AWS IAM
 * with an access key ID (the password field is then its secret access key).
 */
export function passwordInUse(state: Pick<EditorState, 'mechanism' | 'model'>): boolean {
  return state.mechanism === 'MONGODB-AWS' ? awsKeys(state) : usesPassword(state.mechanism);
}

/** Default OIDC sign-in flow (the browser, the device flow when none can be opened). */
export const DEFAULT_OIDC_FLOW: OidcFlow = 'auto';

/** MONGODB-OIDC settings of the profile (`profile.auth.oidcFlow`, `oidcTrustedEndpoint`). */
export interface OidcForm {
  flow: OidcFlow;
  trustedEndpoint: boolean;
}

export interface EditorState {
  /** Id of the edited profile; absent for a new one. */
  id?: string;
  name: string;
  color?: string;
  folder?: string;
  /** Hosts, options and user name; `password` is always unset here. */
  model: ConnectionUriModel;
  mechanism: ProfileMechanism;
  /** Password typed in this editor ('' = none typed; a saved one is not known to the renderer). */
  password: string;
  secretMode: SecretMode;
  readOnly: boolean;
  production: boolean;
  /** SSH tunnel (not part of the connection string). */
  ssh: SshForm;
  /** MONGODB-OIDC sign-in settings (kept while another mechanism is chosen, saved only for OIDC). */
  oidc: OidcForm;
  /** Separate private key file of `tls.certificateKeyFile` (`profile.tls.keyFile`). */
  tlsKeyFile?: string;
  /** Extra secrets typed in this editor ('' or absent = none typed; saved ones are not known). */
  secrets: Partial<Record<ExtraSecretKind, string>>;
  /**
   * Secret options of the connection string (`proxyPassword`, ...) that were removed from it:
   * the editor never keeps them, it only tells the user they were not stored.
   */
  droppedSecrets?: readonly string[];
  /** The profile as loaded. */
  base?: Profile;
}

/** State for a new profile on `localhost:27017`. */
export function newEditorState(defaultSecretMode: 'saved' | 'ask'): EditorState {
  return {
    name: '',
    model: emptyConnectionModel(),
    mechanism: 'NONE',
    password: '',
    secretMode: defaultSecretMode,
    readOnly: false,
    production: false,
    ssh: emptySshForm(),
    oidc: { flow: DEFAULT_OIDC_FLOW, trustedEndpoint: false },
    secrets: {},
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value;
}

/** Query options whose whole value is a secret (lower case; URI keys are case-insensitive). */
const SECRET_OPTIONS = new Map([
  ['proxypassword', 'proxyPassword'],
  ['tlscertificatekeyfilepassword', 'tlsCertificateKeyFilePassword'],
]);
/** `authMechanismProperties` entries whose value is a secret (lower case). */
const SECRET_MECHANISM_PROPERTIES = new Set(['aws_session_token']);

/** `KEY:value,...` without its secret entries (for an unparsed `authMechanismProperties`). */
function withoutSecretProperties(value: string): string {
  return value
    .split(',')
    .filter((entry) => {
      const colon = entry.indexOf(':');
      const key = (colon < 0 ? entry : entry.slice(0, colon)).trim().toLowerCase();
      return !SECRET_MECHANISM_PROPERTIES.has(key);
    })
    .join(',');
}

/**
 * Removes the secrets a connection string can carry besides the password (`proxyPassword`,
 * `tlsCertificateKeyFilePassword`, the `AWS_SESSION_TOKEN` auth mechanism property, also when
 * they ended up in `extra`), in place. Returns the names of the removed options. These secrets
 * belong in the OS keychain, never in a saved or tested connection string.
 */
export function stripUriSecrets(model: ConnectionUriModel): string[] {
  const dropped = new Set<string>();
  if (model.proxy.password !== undefined) {
    delete model.proxy.password;
    dropped.add('proxyPassword');
  }
  if (model.tls.certificateKeyFilePassword !== undefined) {
    delete model.tls.certificateKeyFilePassword;
    dropped.add('tlsCertificateKeyFilePassword');
  }
  const props = model.auth.mechanismProperties;
  if (props) {
    for (const key of Object.keys(props)) {
      if (SECRET_MECHANISM_PROPERTIES.has(key.toLowerCase())) {
        Reflect.deleteProperty(props, key);
        dropped.add(`authMechanismProperties ${key}`);
      }
    }
    if (Object.keys(props).length === 0) delete model.auth.mechanismProperties;
  }
  for (const [key, value] of Object.entries(model.extra)) {
    const lower = key.toLowerCase();
    const secret = SECRET_OPTIONS.get(lower);
    if (secret !== undefined) {
      Reflect.deleteProperty(model.extra, key);
      dropped.add(secret);
    } else if (lower === 'authmechanismproperties') {
      const values = (Array.isArray(value) ? value : [value]).map(withoutSecretProperties);
      const kept = values.filter((v) => v !== '');
      const before = Array.isArray(value) ? value : [value];
      if (values.some((v, i) => v !== before[i])) dropped.add('authMechanismProperties');
      if (kept.length === 0) Reflect.deleteProperty(model.extra, key);
      else model.extra[key] = kept.length === 1 ? (kept[0] as string) : kept;
    }
  }
  return [...dropped];
}

/**
 * Mechanism of a parsed connection string: its `authMechanism`, else the default password
 * mechanism when it names a user, else none.
 */
function mechanismOf(model: ConnectionUriModel): ProfileMechanism {
  const m = model.auth.mechanism;
  if (m !== undefined && m !== 'DEFAULT') return m;
  return nonEmpty(model.username) === undefined ? 'NONE' : DEFAULT_PASSWORD_MECHANISM;
}

/**
 * The editor state of a saved profile. The profile's fields win over the same options in its
 * connection string (the backend passes them as driver options, which take precedence).
 */
export function editorStateFromProfile(
  profile: Profile,
  fallbackSecretMode: SecretMode,
): EditorState {
  let model: ConnectionUriModel;
  try {
    model = parseConnectionString(profile.connectionString);
  } catch {
    model = emptyConnectionModel();
  }
  delete model.password;
  const droppedSecrets = stripUriSecrets(model);
  const auth = profile.auth;
  let mechanism = mechanismOf(model);
  if (auth) {
    mechanism = auth.mechanism;
    if (auth.username !== undefined) model.username = auth.username;
    if (auth.authSource !== undefined) model.auth.source = auth.authSource;
  }
  if (mechanism === 'NONE') {
    delete model.username;
    delete model.auth.mechanism;
  } else {
    model.auth.mechanism = mechanism;
  }
  if (usesExternalSource(mechanism)) delete model.auth.source;
  const tls = profile.tls;
  if (tls) {
    model.tls.enabled = tls.enabled;
    if (tls.caFile !== undefined) model.tls.caFile = tls.caFile;
    if (tls.certificateKeyFile !== undefined) model.tls.certificateKeyFile = tls.certificateKeyFile;
    if (tls.allowInvalidHostnames !== undefined) {
      model.tls.allowInvalidHostnames = tls.allowInvalidHostnames;
    }
    if (tls.allowInvalidCertificates !== undefined) {
      model.tls.allowInvalidCertificates = tls.allowInvalidCertificates;
    }
  }
  if (profile.readPreference !== undefined) model.readPreference.mode = profile.readPreference;
  if (profile.readPreferenceTags !== undefined) {
    model.readPreference.tags = profile.readPreferenceTags.map((set) =>
      Object.fromEntries(set.map(({ name, value }) => [name, value])),
    );
  }
  if (profile.writeConcern) model.writeConcern = { ...profile.writeConcern };
  if (profile.appName !== undefined) model.appName = profile.appName;
  if (profile.connectTimeoutMS !== undefined) {
    model.timeouts.connectTimeoutMS = profile.connectTimeoutMS;
  }
  if (profile.serverSelectionTimeoutMS !== undefined) {
    model.timeouts.serverSelectionTimeoutMS = profile.serverSelectionTimeoutMS;
  }
  if (profile.proxy) {
    model.proxy.host = profile.proxy.host;
    model.proxy.port = profile.proxy.port;
    if (profile.proxy.username !== undefined) model.proxy.username = profile.proxy.username;
  }
  return {
    id: profile.id,
    name: profile.name,
    color: profile.color,
    folder: profile.folder,
    model,
    mechanism,
    password: '',
    secretMode: loadedSecretMode(auth?.secretMode, mechanism, fallbackSecretMode),
    readOnly: profile.readOnly,
    production: profile.production,
    ssh: profile.ssh ? { enabled: true, ...profile.ssh } : emptySshForm(),
    oidc: {
      flow: auth?.oidcFlow ?? DEFAULT_OIDC_FLOW,
      trustedEndpoint: auth?.oidcTrustedEndpoint === true,
    },
    ...(tls?.keyFile !== undefined ? { tlsKeyFile: tls.keyFile } : {}),
    secrets: {},
    ...(droppedSecrets.length > 0 ? { droppedSecrets } : {}),
    base: profile,
  };
}

/**
 * Secret mode of a loaded profile. An AWS IAM profile on the default credential chain is saved
 * with `none`; the editor keeps a real mode for it, used once an access key ID is entered.
 */
function loadedSecretMode(
  saved: SecretMode | undefined,
  mechanism: ProfileMechanism,
  fallback: SecretMode,
): SecretMode {
  if (!usesPassword(mechanism)) return saved ?? 'none';
  if (saved === undefined || (saved === 'none' && mechanism === 'MONGODB-AWS')) return fallback;
  return saved;
}

/**
 * The model as it goes into a connection string: mechanism applied, `password` as given, other
 * secrets removed.
 */
function uriModel(state: EditorState, password: string | undefined): ConnectionUriModel {
  const model = structuredClone(state.model);
  delete model.password;
  stripUriSecrets(model);
  if (state.mechanism === 'NONE') {
    delete model.username;
    delete model.auth.mechanism;
    delete model.auth.source;
  } else {
    model.auth.mechanism = state.mechanism;
    // X.509, LDAP, OIDC and AWS always authenticate against $external (the backend sets it);
    // another authSource only makes the driver refuse the string.
    if (usesExternalSource(state.mechanism)) delete model.auth.source;
    // The driver refuses a user name (and password) in the string for MONGODB-AWS: the access key
    // ID and secret are profile fields, given to the driver as a credential provider.
    if (nonEmpty(model.username) === undefined || state.mechanism === 'MONGODB-AWS') {
      delete model.username;
    }
    if (password !== undefined && model.username !== undefined) model.password = password;
  }
  return model;
}

/**
 * Text of the connection-string tab (password shown as `MASK`, any other secret masked too), or
 * the reason there is none.
 */
export function connectionStringText(
  state: EditorState,
): { text: string; error?: undefined } | { text?: undefined; error: string } {
  try {
    const shown = state.password !== '' && passwordInUse(state) ? MASK : undefined;
    return { text: mask(toConnectionString(uriModel(state, shown))) };
  } catch (error) {
    return { error: readable(error) };
  }
}

function readable(error: unknown): string {
  if (error instanceof ConnectionStringError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

/**
 * Applies a connection string typed or pasted into the URI tab. A password in it moves to the
 * password field (`MASK` keeps the one already typed); a missing password clears the typed one.
 * Other secret options are removed and listed in `droppedSecrets` (they are not stored).
 * Name, color, folder, flags and the secret mode stay as they are.
 */
export function applyConnectionString(
  state: EditorState,
  text: string,
): { state: EditorState; error?: undefined } | { state?: undefined; error: string } {
  let model: ConnectionUriModel;
  try {
    model = parseConnectionString(text);
  } catch (error) {
    return { error: readable(error) };
  }
  const typed = model.password;
  delete model.password;
  const droppedSecrets = stripUriSecrets(model);
  const mechanism = mechanismOf(model);
  if (mechanism !== 'NONE') model.auth.mechanism = mechanism;
  if (usesExternalSource(mechanism)) delete model.auth.source;
  let password = '';
  if (typed === MASK) password = state.password;
  else if (typed !== undefined) password = typed;
  if (
    mechanism === 'MONGODB-AWS' &&
    state.mechanism === 'MONGODB-AWS' &&
    model.username === undefined &&
    typed === undefined
  ) {
    // The access key ID and secret access key are not part of an AWS connection string (the tab
    // never shows them): editing the string keeps them. One pasted with a user name replaces them.
    if (state.model.username !== undefined) model.username = state.model.username;
    password = state.password;
  }
  let secretMode = state.secretMode;
  if (!usesPassword(mechanism)) secretMode = 'none';
  else if (secretMode === 'none') secretMode = 'ask';
  const next: EditorState = { ...state, model, mechanism, password, secretMode };
  if (droppedSecrets.length > 0) next.droppedSecrets = droppedSecrets;
  else delete next.droppedSecrets;
  return { state: next };
}

/** Problems that keep the profile from being saved or tested (empty when there are none). */
export function editorProblems(state: EditorState): string[] {
  const problems: string[] = [];
  if (state.name.trim() === '') problems.push('Enter a name for the connection.');
  const hosts = state.model.hosts;
  if (hosts.length === 0 || hosts.some((h) => h.host.trim() === '')) {
    problems.push('Enter a host name for every host.');
  }
  if (
    hosts.some(
      (h) => h.port !== undefined && (!Number.isInteger(h.port) || h.port < 1 || h.port > 65535),
    )
  ) {
    problems.push('Ports are whole numbers from 1 to 65535.');
  }
  if (
    state.model.scheme === 'mongodb+srv' &&
    (hosts.length !== 1 || hosts[0]?.port !== undefined)
  ) {
    problems.push('An SRV connection has exactly one host name and no port.');
  }
  if (
    usesPassword(state.mechanism) &&
    state.mechanism !== 'MONGODB-AWS' &&
    nonEmpty(state.model.username) === undefined
  ) {
    problems.push('Enter the user name, or choose "No authentication".');
  }
  const model = state.model;
  const tls = model.tls;
  const tlsOn = tls.enabled ?? model.scheme === 'mongodb+srv';
  const certificate = tlsOn && nonEmpty(tls.certificateKeyFile) !== undefined;
  if (state.mechanism === 'MONGODB-X509' && !certificate) {
    problems.push('X.509 authentication needs TLS and a client certificate file.');
  }
  if (
    tlsOn &&
    nonEmpty(state.tlsKeyFile) !== undefined &&
    nonEmpty(tls.certificateKeyFile) === undefined
  ) {
    problems.push('A private key file needs the client certificate file it belongs to.');
  }
  const tags = model.readPreference.tags;
  if (tags && tags.length > 0) {
    const mode = model.readPreference.mode;
    if (mode === undefined || mode === 'primary') {
      problems.push('Read preference tags need a read preference other than Primary.');
    }
    if (tags.some((set) => Object.keys(set).some((name) => name.trim() === ''))) {
      problems.push('Every read preference tag needs a name (name:value).');
    }
  }
  const ssh = state.ssh;
  if (ssh.enabled) {
    if (ssh.host.trim() === '') problems.push('Enter the SSH server.');
    if (!validPort(ssh.port ?? SSH_DEFAULT_PORT)) {
      problems.push('The SSH port is a whole number from 1 to 65535.');
    }
    if (ssh.username.trim() === '') problems.push('Enter the SSH user name.');
    if (ssh.method === 'privateKey' && nonEmpty(ssh.privateKeyFile) === undefined) {
      problems.push('Choose the SSH private key file.');
    }
  }
  const proxyHost = nonEmpty(model.proxy.host);
  if (proxyHost === undefined && nonEmpty(model.proxy.username) !== undefined) {
    problems.push('Enter the proxy host, or remove the proxy user name.');
  }
  if (proxyHost !== undefined && !validPort(model.proxy.port ?? PROXY_DEFAULT_PORT)) {
    problems.push('The proxy port is a whole number from 1 to 65535.');
  }
  if (ssh.enabled && proxyHost !== undefined) {
    problems.push('Use either an SSH tunnel or a SOCKS5 proxy, not both.');
  }
  const uri = connectionStringText(state);
  if (uri.error !== undefined && problems.length === 0) problems.push(uri.error);
  return problems;
}

function validPort(port: number | undefined): boolean {
  return port !== undefined && Number.isInteger(port) && port >= 1 && port <= 65535;
}

/** A read preference tag set as the form shows it: `dc:east, rack:1` ('' matches any member). */
export function formatTagSet(set: Readonly<Record<string, string>>): string {
  return Object.entries(set)
    .map(([name, value]) => `${name}:${value}`)
    .join(', ');
}

/** Parses `dc:east, rack:1` (a name without `:` gets an empty value). */
export function parseTagSet(text: string): Record<string, string> {
  const set = new Map<string, string>();
  for (const entry of text.split(',')) {
    if (entry.trim() === '') continue;
    const colon = entry.indexOf(':');
    const name = (colon < 0 ? entry : entry.slice(0, colon)).trim();
    const value = colon < 0 ? '' : entry.slice(colon + 1).trim();
    set.set(name, value);
  }
  return Object.fromEntries(set);
}

/**
 * Parses the write concern `w` field: a whole number of members, or `majority` / a custom
 * write concern name; `undefined` for an empty field.
 */
export function parseW(text: string): number | string | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  return /^\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
}

/** The profile draft to save or test. Never contains the password or another secret. */
export function profileDraftFromState(state: EditorState): ProfileDraft {
  const model = uriModel(state, undefined);
  const draft: ProfileDraft = {
    name: state.name.trim(),
    connectionString: toConnectionString(model),
    readOnly: state.readOnly,
    production: state.production,
  };
  if (state.id !== undefined) draft.id = state.id;
  const color = nonEmpty(state.color);
  if (color !== undefined) draft.color = color;
  const folder = nonEmpty(state.folder)
    ?.split('/')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join('/');
  if (folder) draft.folder = folder;

  if (state.mechanism === 'NONE') {
    draft.auth = { mechanism: 'NONE', secretMode: 'none' };
  } else {
    const secretMode =
      passwordInUse(state) && state.secretMode !== 'none' ? state.secretMode : 'none';
    draft.auth = { mechanism: state.mechanism, secretMode };
    // The URI model has no user name for AWS (the driver refuses one there): take the form's.
    const username =
      state.mechanism === 'MONGODB-AWS' ? nonEmpty(state.model.username)?.trim() : model.username;
    if (username !== undefined) draft.auth.username = username;
    const source = nonEmpty(model.auth.source);
    if (source !== undefined && !usesExternalSource(state.mechanism)) {
      draft.auth.authSource = source;
    }
    if (state.mechanism === 'MONGODB-OIDC') {
      if (state.oidc.flow !== DEFAULT_OIDC_FLOW) draft.auth.oidcFlow = state.oidc.flow;
      if (state.oidc.trustedEndpoint) draft.auth.oidcTrustedEndpoint = true;
    }
  }

  const tls = model.tls;
  const hasTls =
    tls.enabled !== undefined ||
    nonEmpty(tls.caFile) !== undefined ||
    nonEmpty(tls.certificateKeyFile) !== undefined ||
    tls.allowInvalidHostnames !== undefined ||
    tls.allowInvalidCertificates !== undefined;
  if (hasTls) {
    draft.tls = { enabled: tls.enabled ?? model.scheme === 'mongodb+srv' };
    const caFile = nonEmpty(tls.caFile);
    if (caFile !== undefined) draft.tls.caFile = caFile;
    const certificateKeyFile = nonEmpty(tls.certificateKeyFile);
    if (certificateKeyFile !== undefined) {
      draft.tls.certificateKeyFile = certificateKeyFile;
      const keyFile = nonEmpty(state.tlsKeyFile);
      if (keyFile !== undefined) draft.tls.keyFile = keyFile;
    }
    if (tls.allowInvalidHostnames !== undefined) {
      draft.tls.allowInvalidHostnames = tls.allowInvalidHostnames;
    }
    if (tls.allowInvalidCertificates !== undefined) {
      draft.tls.allowInvalidCertificates = tls.allowInvalidCertificates;
    }
  }

  const readPreference = model.readPreference.mode;
  if (readPreference !== undefined) draft.readPreference = readPreference;
  const tags = model.readPreference.tags;
  if (readPreference !== undefined && readPreference !== 'primary' && tags && tags.length > 0) {
    const sets = tags.map((set) => Object.entries(set).map(([name, value]) => ({ name, value })));
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
  if (connectTimeoutMS !== undefined && connectTimeoutMS > 0) {
    draft.connectTimeoutMS = connectTimeoutMS;
  }
  if (serverSelectionTimeoutMS !== undefined && serverSelectionTimeoutMS > 0) {
    draft.serverSelectionTimeoutMS = serverSelectionTimeoutMS;
  }
  const proxyHost = nonEmpty(model.proxy.host);
  if (proxyHost !== undefined) {
    draft.proxy = { host: proxyHost, port: model.proxy.port ?? PROXY_DEFAULT_PORT };
    const proxyUser = nonEmpty(model.proxy.username);
    if (proxyUser !== undefined) draft.proxy.username = proxyUser;
  }
  const ssh = state.ssh;
  if (ssh.enabled) {
    draft.ssh = {
      host: ssh.host.trim(),
      port: ssh.port ?? SSH_DEFAULT_PORT,
      username: ssh.username.trim(),
      method: ssh.method,
    };
    const keyFile = nonEmpty(ssh.privateKeyFile);
    if (ssh.method === 'privateKey' && keyFile !== undefined) draft.ssh.privateKeyFile = keyFile;
  }
  return draft;
}

/** One-line description of where a profile connects to (no credentials). */
export function hostSummary(connectionString: string): string {
  try {
    const model = parseConnectionString(connectionString);
    const hosts = model.hosts
      .map(({ host, port }) => {
        const name = host.includes(':') ? `[${host}]` : host;
        return port === undefined ? name : `${name}:${String(port)}`;
      })
      .join(', ');
    return model.scheme === 'mongodb+srv' ? `${hosts} (SRV)` : hosts;
  } catch {
    return '';
  }
}

/** Folder paths in use, sorted, for the folder suggestions. */
export function folderNames(profiles: readonly Profile[]): string[] {
  return [...new Set(profiles.map((p) => p.folder).filter((f): f is string => !!f))].sort((a, b) =>
    a.localeCompare(b),
  );
}

/** Preset profile colors (user data: drawn on the sidebar's guide line and the editor's edge). */
export const PROFILE_COLORS: readonly { name: string; value: string }[] = [
  { name: 'Teal', value: '#1f9d8b' },
  { name: 'Blue', value: '#3b7dd8' },
  { name: 'Violet', value: '#8a5cd0' },
  { name: 'Amber', value: '#d49a1f' },
  { name: 'Green', value: '#4f9d3a' },
  { name: 'Slate', value: '#6b7a8c' },
];
