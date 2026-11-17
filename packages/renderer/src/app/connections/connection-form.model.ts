import type { Profile, ProfileDraft } from '@thicket/contract';
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

/** Mechanisms the M1 form edits (the others are kept as they are, see `conn-ui-m2`). */
export const FORM_MECHANISMS: readonly ProfileMechanism[] = [
  'NONE',
  'SCRAM-SHA-256',
  'SCRAM-SHA-1',
];

/** Mechanism a user name without `authMechanism` gets (MongoDB's default since 4.0). */
export const DEFAULT_PASSWORD_MECHANISM: ProfileMechanism = 'SCRAM-SHA-256';

/** Mechanisms that authenticate with a user name and the profile's `password` secret. */
export function usesPassword(mechanism: ProfileMechanism): boolean {
  return mechanism === 'SCRAM-SHA-1' || mechanism === 'SCRAM-SHA-256' || mechanism === 'PLAIN';
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
  /**
   * Secret options of the connection string (`proxyPassword`, ...) that were removed from it:
   * the editor never keeps them, it only tells the user they were not stored.
   */
  droppedSecrets?: readonly string[];
  /**
   * The profile as loaded, for the fields this form does not edit (SSH, the separate TLS key
   * file): saving keeps them.
   */
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
    secretMode: auth?.secretMode ?? (usesPassword(mechanism) ? fallbackSecretMode : 'none'),
    readOnly: profile.readOnly,
    production: profile.production,
    ...(droppedSecrets.length > 0 ? { droppedSecrets } : {}),
    base: profile,
  };
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
    if (nonEmpty(model.username) === undefined) delete model.username;
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
    const shown = state.password !== '' && usesPassword(state.mechanism) ? MASK : undefined;
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
  let password = '';
  if (typed === MASK) password = state.password;
  else if (typed !== undefined) password = typed;
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
  if (usesPassword(state.mechanism) && nonEmpty(state.model.username) === undefined) {
    problems.push('Enter the user name, or choose "No authentication".');
  }
  const uri = connectionStringText(state);
  if (uri.error !== undefined && problems.length === 0) problems.push(uri.error);
  return problems;
}

/** The profile draft to save or test. Never contains the password or another secret. */
export function profileDraftFromState(state: EditorState): ProfileDraft {
  const model = uriModel(state, undefined);
  const base = state.base;
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
    draft.auth = {
      mechanism: state.mechanism,
      secretMode: usesPassword(state.mechanism) ? state.secretMode : 'none',
    };
    if (model.username !== undefined) draft.auth.username = model.username;
    const source = nonEmpty(model.auth.source);
    if (source !== undefined) draft.auth.authSource = source;
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
      if (base?.tls?.keyFile !== undefined) draft.tls.keyFile = base.tls.keyFile;
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
    draft.proxy = { host: proxyHost, port: model.proxy.port ?? 1080 };
    const proxyUser = nonEmpty(model.proxy.username);
    if (proxyUser !== undefined) draft.proxy.username = proxyUser;
  }
  if (base?.ssh) draft.ssh = base.ssh;
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
