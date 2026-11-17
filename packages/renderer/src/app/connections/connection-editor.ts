import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import {
  OIDC_FLOWS,
  READ_PREFERENCES,
  type FilePurpose,
  type OidcFlow,
  type Profile,
  type ProfileDraft,
  type ResultOf,
  type SecretKind,
  type SecretStorageStatus,
} from '@thicket/contract';
import type { ConnectionUriModel, ReadPreferenceMode, UriHost } from '@thicket/core/uri';

import { ApiError, describeError } from '../api/api-error';
import { ApiService } from '../api/api.service';
import { NAV } from '../layout/navigation';
import { ProfileSafetyService } from '../safety/profile-safety.service';
import { SidebarTreeService } from '../sidebar/sidebar-tree.service';
import {
  FORM_MECHANISMS,
  PROFILE_COLORS,
  applyConnectionString,
  connectionStringText,
  editorProblems,
  editorStateFromProfile,
  folderNames,
  newEditorState,
  profileDraftFromState,
  PROXY_DEFAULT_PORT,
  SSH_DEFAULT_PORT,
  formatTagSet,
  parseTagSet,
  parseW,
  awsKeys,
  passwordInUse,
  usedSecretKinds,
  usesExternalSource,
  usesPassword,
  type EditorState,
  type ExtraSecretKind,
  type ProfileMechanism,
  type SecretMode,
  type SshMethod,
} from './connection-form.model';

type EditorTab = 'form' | 'uri';

/** Navigation state key: the profile was just created (the new page says "Saved"). */
const SAVED_STATE = 'thicketProfileSaved';

/** Outcome of "Test connection" as the editor shows it. */
type TestState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'ok'; result: ResultOf<'conn.test'> }
  | { status: 'error'; code: string; explanation: string; message: string };

/** Load state of the editor (the profile and the secret storage status). */
type LoadState = { status: 'loading' } | { status: 'ready' } | { status: 'error'; message: string };

const MECHANISM_LABELS: Readonly<Record<ProfileMechanism, string>> = {
  NONE: 'No authentication',
  'SCRAM-SHA-256': 'Username and password (SCRAM-SHA-256)',
  'SCRAM-SHA-1': 'Username and password (SCRAM-SHA-1)',
  'MONGODB-X509': 'X.509 client certificate',
  PLAIN: 'LDAP (PLAIN)',
  'MONGODB-OIDC': 'OpenID Connect',
  'MONGODB-AWS': 'AWS IAM',
  GSSAPI: 'Kerberos (GSSAPI)',
};

/** What each extra secret is called in messages. */
const SECRET_LABELS: Readonly<Record<ExtraSecretKind, string>> = {
  sshPassword: 'SSH password',
  sshKeyPassphrase: 'SSH key passphrase',
  tlsKeyPassphrase: 'client key passphrase',
  proxyPassword: 'proxy password',
  awsSessionToken: 'AWS session token',
};

const OIDC_FLOW_LABELS: Readonly<Record<OidcFlow, string>> = {
  auto: 'Browser, or a device code when no browser can be opened',
  authCode: 'Browser on this computer',
  deviceCode: 'Device code (sign in on another device)',
};

const SSH_METHOD_LABELS: Readonly<Record<SshMethod, string>> = {
  password: 'Password',
  privateKey: 'Private key',
  agent: 'SSH agent',
};

const READ_PREFERENCE_LABELS: Readonly<Record<ReadPreferenceMode, string>> = {
  primary: 'Primary',
  primaryPreferred: 'Primary preferred',
  secondary: 'Secondary',
  secondaryPreferred: 'Secondary preferred',
  nearest: 'Nearest',
};

/**
 * Connection editor (`/connections/new`, `/connections/:id`): a form and a connection-string tab
 * over the same state (see `connection-form.model.ts`), password handling (saved in the OS
 * keychain or asked on every connect, with a warning when the keychain is weak), read-only and
 * production flags, and "Test connection" with the error explained.
 */
@Component({
  selector: 'app-connection-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, RouterLink],
  templateUrl: './connection-editor.html',
  styleUrl: './connection-editor.css',
})
export class ConnectionEditor {
  /** Route parameter: id of the edited profile; absent for a new one. */
  readonly id = input<string>();

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly tree = inject(SidebarTreeService);
  private readonly safety = inject(ProfileSafetyService);

  protected readonly nav = NAV;
  protected readonly colors = PROFILE_COLORS;
  protected readonly readPreferences = READ_PREFERENCES;
  protected readonly readPreferenceLabels = READ_PREFERENCE_LABELS;
  protected readonly mechanismLabels = MECHANISM_LABELS;
  protected readonly sshMethods: readonly SshMethod[] = ['password', 'privateKey', 'agent'];
  protected readonly sshMethodLabels = SSH_METHOD_LABELS;
  protected readonly sshDefaultPort = SSH_DEFAULT_PORT;
  protected readonly proxyDefaultPort = PROXY_DEFAULT_PORT;
  protected readonly formatTagSet = formatTagSet;
  protected readonly oidcFlows = OIDC_FLOWS;
  protected readonly oidcFlowLabels = OIDC_FLOW_LABELS;

  protected readonly load = signal<LoadState>({ status: 'loading' });
  protected readonly state = signal<EditorState>(newEditorState('ask'));
  protected readonly storage = signal<SecretStorageStatus | null>(null);
  protected readonly storedSecrets = signal<readonly SecretKind[]>([]);
  protected readonly tab = signal<EditorTab>('form');
  /** Text in the connection-string tab while it is edited (it is not reformatted while typing). */
  protected readonly uriInput = signal('');
  protected readonly uriError = signal<string | null>(null);
  protected readonly showPassword = signal(false);
  /** "Copied" feedback of the copy button (cleared by the next edit). */
  protected readonly copied = signal<'idle' | 'ok' | 'failed'>('idle');
  protected readonly test = signal<TestState>({ status: 'idle' });
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly savedNotice = signal(false);
  /** Problems are shown once the user tried to save or test. */
  protected readonly attempted = signal(false);

  /** The draft as loaded: Test uses the saved profile (and its stored secrets) while unchanged. */
  private loadedDraft: string | null = null;
  private testAbort: AbortController | null = null;

  protected readonly isNew = computed(() => this.state().id === undefined);
  protected readonly heading = computed(() =>
    this.id() === undefined && this.isNew() ? 'New connection' : 'Edit connection',
  );
  protected readonly uri = computed(() => connectionStringText(this.state()));
  protected readonly problems = computed(() => editorProblems(this.state()));
  protected readonly folders = computed(() => folderNames(this.tree.profileList()));
  /** The password field is shown (for AWS IAM it is the secret access key of a given key ID). */
  protected readonly needsPassword = computed(() => passwordInUse(this.state()));
  /** The user name field must be filled in (SCRAM and LDAP). */
  protected readonly needsUsername = computed(() => {
    const mechanism = this.state().mechanism;
    return usesPassword(mechanism) && mechanism !== 'MONGODB-AWS';
  });
  protected readonly awsKeys = computed(() => awsKeys(this.state()));
  /** No authentication database field: the mechanism's users live in `$external`. */
  protected readonly externalSource = computed(() => usesExternalSource(this.state().mechanism));
  /** What the password field is called. */
  protected readonly passwordLabel = computed(() =>
    this.state().mechanism === 'MONGODB-AWS'
      ? 'Secret access key'
      : this.state().mechanism === 'PLAIN'
        ? 'LDAP password'
        : 'Password',
  );
  /** `passwordLabel` within a sentence. */
  protected readonly passwordNoun = computed(() =>
    this.state().mechanism === 'PLAIN' ? 'LDAP password' : this.passwordLabel().toLowerCase(),
  );
  protected readonly usernameLabel = computed(() => {
    switch (this.state().mechanism) {
      case 'MONGODB-AWS':
        return 'Access key ID';
      case 'PLAIN':
        return 'LDAP user name';
      case 'MONGODB-OIDC':
        return 'User name (optional)';
      default:
        return 'User name';
    }
  });
  protected readonly usernamePlaceholder = computed(() => {
    switch (this.state().mechanism) {
      case 'MONGODB-X509':
        return 'from the certificate';
      case 'MONGODB-AWS':
        return 'default AWS credential chain';
      case 'MONGODB-OIDC':
        return 'from the identity provider';
      default:
        return '';
    }
  });
  protected readonly mechanisms = computed(() => {
    const current = this.state().mechanism;
    return FORM_MECHANISMS.includes(current) ? FORM_MECHANISMS : [...FORM_MECHANISMS, current];
  });
  /** `tls` as the driver would use it: explicit, else on for SRV. */
  protected readonly tlsOn = computed(() => {
    const model = this.state().model;
    return model.tls.enabled ?? model.scheme === 'mongodb+srv';
  });
  protected readonly passwordSaved = computed(
    () => this.storedSecrets().includes('password') && this.state().secretMode === 'saved',
  );
  protected readonly canSave = computed(() => this.storage()?.level !== 'unavailable');
  /** Whether a dropped connection-string secret has a field of its own in this editor. */
  protected readonly droppedHasField = computed(() =>
    (this.state().droppedSecrets ?? []).some(
      (name) =>
        name === 'proxyPassword' ||
        name === 'tlsCertificateKeyFilePassword' ||
        (this.state().mechanism === 'MONGODB-AWS' &&
          name.toLowerCase() === 'authmechanismproperties aws_session_token'),
    ),
  );
  /** Extra secrets the current settings use (their fields are shown, and stored on save). */
  protected readonly secretKinds = computed(() => usedSecretKinds(this.state()));
  /** The SSH tunnel or proxy is on: drawn as the route the connection takes. */
  protected readonly route = computed(() => {
    const s = this.state();
    const hosts = s.model.hosts.map((h) => h.host || '…');
    const target = s.model.scheme === 'mongodb+srv' ? `${hosts[0] ?? '…'} (SRV)` : hosts.join(', ');
    if (s.ssh.enabled) {
      return { via: `${s.ssh.username || '…'}@${s.ssh.host || '…'}`, kind: 'SSH', target };
    }
    const proxy = s.model.proxy.host?.trim();
    if (proxy) return { via: proxy, kind: 'SOCKS5', target };
    return null;
  });

  constructor() {
    this.tree.start();
    const navState = this.router.currentNavigation()?.extras.state;
    if (navState?.[SAVED_STATE] === true) this.savedNotice.set(true);
    inject(DestroyRef).onDestroy(() => {
      this.testAbort?.abort();
      // A destroyed editor (the user left the page) ignores answers that arrive later.
      ++this.loadGeneration;
    });
    // Loads the profile, again when the route switches to another one (same editor instance).
    effect(() => {
      const id = this.id();
      untracked(() => void this.loadProfile(id));
    });
  }

  /** Generation of the latest load: switching profiles drops the answers of an older one. */
  private loadGeneration = 0;

  private async loadProfile(id: string | undefined): Promise<void> {
    const gen = ++this.loadGeneration;
    this.testAbort?.abort();
    this.testAbort = null;
    this.load.set({ status: 'loading' });
    this.test.set({ status: 'idle' });
    this.tab.set('form');
    this.attempted.set(false);
    this.saveError.set(null);
    this.storedSecrets.set([]);
    this.loadedDraft = null;
    // The "Saved" notice of a just created profile survives only its first load.
    if (gen > 1) this.savedNotice.set(false);
    try {
      const storage = await this.api.request('profiles.secretStorage', {});
      if (gen !== this.loadGeneration) return;
      this.storage.set(storage);
      if (id === undefined) {
        this.state.set(newEditorState(storage.defaultSecretMode));
      } else {
        const { profile, storedSecrets } = await this.api.request('profiles.get', {
          profileId: id,
        });
        if (gen !== this.loadGeneration) return;
        this.storedSecrets.set(storedSecrets);
        const state = editorStateFromProfile(profile, storage.defaultSecretMode);
        this.state.set(state);
        this.loadedDraft = this.draftKey(state);
      }
      this.load.set({ status: 'ready' });
    } catch (error) {
      if (gen === this.loadGeneration) {
        this.load.set({ status: 'error', message: describeError(error) });
      }
    }
  }

  private draftKey(state: EditorState): string | null {
    try {
      return JSON.stringify(profileDraftFromState(state));
    } catch {
      return null;
    }
  }

  // ---- editing -----------------------------------------------------------------------------

  private update(change: (state: EditorState) => EditorState): void {
    this.state.update(change);
    this.savedNotice.set(false);
    this.copied.set('idle');
    if (this.test().status !== 'running') this.test.set({ status: 'idle' });
  }

  private updateModel(change: (model: ConnectionUriModel) => void): void {
    this.update((state) => {
      const model = structuredClone(state.model);
      change(model);
      return { ...state, model };
    });
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  protected setName(name: string): void {
    this.update((s) => ({ ...s, name }));
  }

  protected setColor(color: string | undefined): void {
    this.update((s) => ({ ...s, color }));
  }

  protected setFolder(folder: string): void {
    this.update((s) => ({ ...s, folder }));
  }

  protected setFlag(flag: 'readOnly' | 'production', on: boolean): void {
    this.update((s) => ({ ...s, [flag]: on }));
  }

  protected setScheme(srv: boolean): void {
    this.updateModel((m) => {
      m.scheme = srv ? 'mongodb+srv' : 'mongodb';
      if (srv) {
        const first = m.hosts[0];
        m.hosts = [{ host: first?.host ?? '' }];
        delete m.directConnection;
      } else if (m.hosts.length === 1 && m.hosts[0]?.port === undefined) {
        m.hosts = [{ host: m.hosts[0]?.host ?? '', port: 27017 }];
      }
    });
  }

  protected setHost(index: number, host: string): void {
    this.updateModel((m) => {
      const current = m.hosts[index];
      if (current) current.host = host.trim();
    });
  }

  protected setPort(index: number, text: string): void {
    this.updateModel((m) => {
      const current = m.hosts[index];
      if (!current) return;
      const trimmed = text.trim();
      if (trimmed === '') delete current.port;
      else current.port = Number(trimmed);
    });
  }

  protected addHost(): void {
    this.updateModel((m) => {
      m.hosts = [...m.hosts, { host: '', port: 27017 } satisfies UriHost];
    });
  }

  protected removeHost(index: number): void {
    this.updateModel((m) => {
      if (m.hosts.length > 1) m.hosts = m.hosts.filter((_, i) => i !== index);
    });
  }

  protected setReplicaSet(name: string): void {
    this.updateModel((m) => {
      if (name.trim() === '') delete m.replicaSet;
      else m.replicaSet = name.trim();
    });
  }

  protected setDirect(on: boolean): void {
    this.updateModel((m) => {
      if (on) m.directConnection = true;
      else delete m.directConnection;
    });
  }

  protected setMechanism(mechanism: ProfileMechanism): void {
    const fallback: SecretMode = this.storage()?.defaultSecretMode ?? 'ask';
    this.update((s) => {
      const model = structuredClone(s.model);
      // An AWS access key ID and secret are no database user name and password (nor the reverse).
      const awsSwitch = (mechanism === 'MONGODB-AWS') !== (s.mechanism === 'MONGODB-AWS');
      if (awsSwitch) delete model.username;
      if (mechanism === 'NONE') {
        delete model.username;
        delete model.auth.mechanism;
        delete model.auth.source;
      } else {
        model.auth.mechanism = mechanism;
        // The authentication database field is hidden for $external mechanisms (X.509, ...).
        if (usesExternalSource(mechanism)) delete model.auth.source;
      }
      let secretMode = s.secretMode;
      if (!usesPassword(mechanism)) secretMode = 'none';
      else if (secretMode === 'none') secretMode = fallback;
      return {
        ...s,
        model,
        mechanism,
        secretMode,
        password: usesPassword(mechanism) && !awsSwitch ? s.password : '',
      };
    });
  }

  protected setUsername(username: string): void {
    this.updateModel((m) => {
      if (username === '') delete m.username;
      else m.username = username;
    });
  }

  protected setPassword(password: string): void {
    this.update((s) => ({ ...s, password }));
  }

  protected setAuthSource(source: string): void {
    this.updateModel((m) => {
      if (source.trim() === '') delete m.auth.source;
      else m.auth.source = source.trim();
    });
  }

  protected setSecretMode(secretMode: SecretMode): void {
    this.update((s) => ({ ...s, secretMode }));
  }

  protected setOidcFlow(flow: OidcFlow): void {
    this.update((s) => ({ ...s, oidc: { ...s.oidc, flow } }));
  }

  protected setOidcTrustedEndpoint(on: boolean): void {
    this.update((s) => ({ ...s, oidc: { ...s.oidc, trustedEndpoint: on } }));
  }

  protected setTls(on: boolean): void {
    this.updateModel((m) => {
      m.tls.enabled = on;
    });
  }

  protected setTlsFlag(flag: 'allowInvalidHostnames' | 'allowInvalidCertificates', on: boolean) {
    this.updateModel((m) => {
      // Off removes the option (the driver default) rather than writing `=false`.
      if (flag === 'allowInvalidHostnames') {
        if (on) m.tls.allowInvalidHostnames = true;
        else delete m.tls.allowInvalidHostnames;
      } else if (on) m.tls.allowInvalidCertificates = true;
      else delete m.tls.allowInvalidCertificates;
    });
  }

  protected setCaFile(path: string): void {
    this.updateModel((m) => {
      if (path.trim() === '') delete m.tls.caFile;
      else m.tls.caFile = path;
    });
  }

  protected async chooseCaFile(): Promise<void> {
    try {
      const { path } = await this.api.request('profiles.chooseFile', { purpose: 'tlsCaFile' });
      if (path !== null) this.setCaFile(path);
    } catch (error) {
      this.saveError.set(describeError(error));
    }
  }

  protected async chooseFile(purpose: FilePurpose, apply: (path: string) => void): Promise<void> {
    try {
      const { path } = await this.api.request('profiles.chooseFile', { purpose });
      if (path !== null) apply(path);
    } catch (error) {
      this.saveError.set(describeError(error));
    }
  }

  protected setCertificateFile(path: string): void {
    this.updateModel((m) => {
      if (path.trim() === '') delete m.tls.certificateKeyFile;
      else m.tls.certificateKeyFile = path;
    });
  }

  protected setTlsKeyFile(path: string): void {
    this.update((s) => {
      const next = { ...s };
      if (path.trim() === '') delete next.tlsKeyFile;
      else next.tlsKeyFile = path;
      return next;
    });
  }

  protected setSecret(kind: ExtraSecretKind, value: string): void {
    this.update((s) => {
      const next: EditorState = { ...s, secrets: { ...s.secrets, [kind]: value } };
      // A newly typed value replaces the stored one instead of removing it.
      if (value !== '' && s.removedSecrets?.includes(kind)) {
        next.removedSecrets = s.removedSecrets.filter((k) => k !== kind);
      }
      return next;
    });
  }

  protected secretSaved(kind: ExtraSecretKind): boolean {
    return this.storedSecrets().includes(kind);
  }

  /** The stored secret is marked to be removed on save. */
  protected secretRemoved(kind: ExtraSecretKind): boolean {
    return this.state().removedSecrets?.includes(kind) === true;
  }

  /** Marks a stored secret to be removed on save (drops a typed value), or keeps it again. */
  protected toggleRemoveSecret(kind: ExtraSecretKind): void {
    this.update((s) => {
      const removed = s.removedSecrets ?? [];
      if (removed.includes(kind)) {
        return { ...s, removedSecrets: removed.filter((k) => k !== kind) };
      }
      return {
        ...s,
        secrets: { ...s.secrets, [kind]: '' },
        removedSecrets: [...removed, kind],
      };
    });
  }

  protected secretValue(kind: ExtraSecretKind): string {
    return this.state().secrets[kind] ?? '';
  }

  protected chooseCertificateFile(): Promise<void> {
    return this.chooseFile('tlsCertificateKeyFile', (path) => this.setCertificateFile(path));
  }

  protected chooseTlsKeyFile(): Promise<void> {
    return this.chooseFile('tlsCertificateKeyFile', (path) => this.setTlsKeyFile(path));
  }

  protected chooseSshKeyFile(): Promise<void> {
    return this.chooseFile('sshPrivateKeyFile', (path) => this.setSshKeyFile(path));
  }

  // ---- SSH ----

  protected setSshEnabled(on: boolean): void {
    this.update((s) => ({ ...s, ssh: { ...s.ssh, enabled: on } }));
  }

  protected setSshText(key: 'host' | 'username', text: string): void {
    this.update((s) => ({ ...s, ssh: { ...s.ssh, [key]: text.trim() } }));
  }

  protected setSshPort(text: string): void {
    this.update((s) => {
      const ssh = { ...s.ssh };
      if (text.trim() === '') delete ssh.port;
      else ssh.port = Number(text.trim());
      return { ...s, ssh };
    });
  }

  protected setSshMethod(method: SshMethod): void {
    this.update((s) => ({ ...s, ssh: { ...s.ssh, method } }));
  }

  protected setSshKeyFile(path: string): void {
    this.update((s) => {
      const ssh = { ...s.ssh };
      if (path.trim() === '') delete ssh.privateKeyFile;
      else ssh.privateKeyFile = path;
      return { ...s, ssh };
    });
  }

  // ---- proxy ----

  protected setProxyText(key: 'host' | 'username', text: string): void {
    this.updateModel((m) => {
      if (text.trim() === '') Reflect.deleteProperty(m.proxy, key);
      else m.proxy[key] = text.trim();
    });
  }

  protected setProxyPort(text: string): void {
    this.updateModel((m) => {
      if (text.trim() === '') delete m.proxy.port;
      else m.proxy.port = Number(text.trim());
    });
  }

  // ---- read preference tags and write concern ----

  protected addTagSet(): void {
    this.updateModel((m) => {
      m.readPreference.tags = [...(m.readPreference.tags ?? []), {}];
    });
  }

  protected setTagSet(index: number, text: string): void {
    this.updateModel((m) => {
      const tags = [...(m.readPreference.tags ?? [])];
      if (index < tags.length) tags[index] = parseTagSet(text);
      m.readPreference.tags = tags;
    });
  }

  protected removeTagSet(index: number): void {
    this.updateModel((m) => {
      const tags = (m.readPreference.tags ?? []).filter((_, i) => i !== index);
      if (tags.length === 0) delete m.readPreference.tags;
      else m.readPreference.tags = tags;
    });
  }

  protected setW(text: string): void {
    this.updateModel((m) => {
      const w = parseW(text);
      if (w === undefined) delete m.writeConcern.w;
      else m.writeConcern.w = w;
    });
  }

  protected setJournal(value: string): void {
    this.updateModel((m) => {
      if (value === '') delete m.writeConcern.journal;
      else m.writeConcern.journal = value === 'true';
    });
  }

  protected setWtimeout(text: string): void {
    this.updateModel((m) => {
      const n = Number(text.trim());
      if (text.trim() !== '' && Number.isInteger(n) && n >= 0) m.writeConcern.wtimeoutMS = n;
      else delete m.writeConcern.wtimeoutMS;
    });
  }

  protected journalValue(): string {
    const journal = this.state().model.writeConcern.journal;
    return journal === undefined ? '' : String(journal);
  }

  // ---- copy ----

  /** Copies the connection string as shown: the password stays masked. */
  protected async copyUri(): Promise<void> {
    const uri = this.uri();
    if (uri.error !== undefined) return;
    try {
      await navigator.clipboard.writeText(uri.text);
      this.copied.set('ok');
    } catch {
      this.copied.set('failed');
    }
  }

  protected setReadPreference(mode: string): void {
    this.updateModel((m) => {
      if (mode === '') delete m.readPreference.mode;
      else m.readPreference.mode = mode as ReadPreferenceMode;
    });
  }

  protected setAppName(name: string): void {
    this.updateModel((m) => {
      if (name.trim() === '') delete m.appName;
      else m.appName = name;
    });
  }

  protected setTimeout(key: 'connectTimeoutMS' | 'serverSelectionTimeoutMS', text: string): void {
    this.updateModel((m) => {
      const n = Number(text.trim());
      const valid = text.trim() !== '' && Number.isInteger(n) && n > 0;
      const timeouts = new Map(Object.entries(m.timeouts));
      if (valid) timeouts.set(key, n);
      else timeouts.delete(key);
      m.timeouts = Object.fromEntries(timeouts);
    });
  }

  // ---- tabs and the connection string -------------------------------------------------------

  protected selectTab(tab: EditorTab): void {
    if (tab === 'uri') {
      const uri = this.uri();
      this.uriInput.set(uri.error === undefined ? uri.text : '');
      this.uriError.set(uri.error ?? null);
    }
    this.tab.set(tab);
  }

  protected onTabKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next: EditorTab = this.tab() === 'form' ? 'uri' : 'form';
    this.selectTab(next);
    const host = (event.currentTarget as HTMLElement).parentElement;
    host?.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus();
  }

  protected onUriInput(text: string): void {
    this.uriInput.set(text);
    const applied = applyConnectionString(this.state(), text);
    if (applied.error !== undefined) {
      this.uriError.set(applied.error);
      return;
    }
    this.uriError.set(null);
    this.update(() => applied.state);
  }

  // ---- test and save ------------------------------------------------------------------------

  protected async testConnection(): Promise<void> {
    this.attempted.set(true);
    if (this.problems().length > 0) return;
    const state = this.state();
    this.testAbort?.abort();
    const abort = new AbortController();
    this.testAbort = abort;
    this.test.set({ status: 'running' });
    const password = state.password !== '' && passwordInUse(state) ? state.password : undefined;
    let params: { profileId: string } | { profile: ProfileDraft };
    if (
      state.id !== undefined &&
      password === undefined &&
      this.draftKey(state) === this.loadedDraft
    ) {
      params = { profileId: state.id };
    } else {
      params = { profile: profileDraftFromState(state) };
    }
    try {
      const result = await this.api.request(
        'conn.test',
        password === undefined ? params : { ...params, password },
        { signal: abort.signal },
      );
      if (this.testAbort === abort) this.test.set({ status: 'ok', result });
    } catch (error) {
      if (this.testAbort !== abort) return;
      const apiError = ApiError.from(error);
      if (apiError.code === 'CANCELLED') {
        this.test.set({ status: 'idle' });
        return;
      }
      this.test.set({
        status: 'error',
        code: apiError.code,
        explanation: apiError.explanation,
        message: apiError.message.trim() === apiError.explanation ? '' : apiError.message.trim(),
      });
    } finally {
      if (this.testAbort === abort) this.testAbort = null;
    }
  }

  protected cancelTest(): void {
    this.testAbort?.abort();
    this.testAbort = null;
    this.test.set({ status: 'idle' });
  }

  protected async save(event?: Event): Promise<void> {
    event?.preventDefault();
    this.attempted.set(true);
    if (this.problems().length > 0 || this.saving()) return;
    const state = this.state();
    // Decided against the profile as loaded (its key ID, its stored secrets), before saving.
    const toRemove = this.secretsToRemove(state);
    // A profile switch while saving (same editor instance) or leaving the page (destroyed
    // instance) must not show the saved profile or navigate to it.
    const gen = this.loadGeneration;
    const current = (): boolean => gen === this.loadGeneration;
    this.saving.set(true);
    this.saveError.set(null);
    try {
      let profile: Profile;
      try {
        ({ profile } = await this.api.request('profiles.save', {
          profile: profileDraftFromState(state),
        }));
      } catch (error) {
        if (current()) this.saveError.set(describeError(error));
        return;
      }
      // The profile exists now: adopt it before storing the password, so a retry after a
      // failed setSecret updates it instead of creating a second one.
      this.safety.set({
        id: profile.id,
        name: profile.name,
        readOnly: profile.readOnly,
        production: profile.production,
      });
      void this.tree.reloadProfiles();
      const fallback = this.storage()?.defaultSecretMode ?? 'ask';
      const adopted: EditorState = { ...editorStateFromProfile(profile, fallback), password: '' };
      if (state.droppedSecrets) adopted.droppedSecrets = state.droppedSecrets;
      // Keeps the typed password and other secrets, and the removals, until they are done.
      const pending: EditorState = {
        ...adopted,
        password: state.password,
        secrets: state.secrets,
        ...(toRemove.length > 0 ? { removedSecrets: toRemove } : {}),
      };
      if (current()) {
        this.state.set(pending);
        this.loadedDraft = this.draftKey(adopted);
      }

      const password = state.password;
      if (passwordInUse(state) && state.secretMode === 'saved' && password !== '') {
        try {
          await this.api.request('profiles.setSecret', {
            profileId: profile.id,
            kind: 'password',
            value: password,
          });
        } catch (error) {
          if (current()) {
            this.saveError.set(
              `Saved, but the password could not be stored: ${describeError(error)}`,
            );
          }
          return;
        }
        if (current()) {
          this.storedSecrets.update((kinds) =>
            kinds.includes('password') ? kinds : [...kinds, 'password'],
          );
        }
      } else if (state.secretMode !== 'saved' && current()) {
        this.storedSecrets.update((kinds) => kinds.filter((k) => k !== 'password'));
      }
      if (!current()) return;
      const failed = await this.storeSecrets(profile.id, state, toRemove, current);
      if (!current()) return;
      if (failed.length > 0) {
        this.saveError.set(`Saved, but ${failed.join('; ')}`);
        return;
      }
      // Edits made while the password was being stored stay, and are not reported as saved.
      const unchanged = this.state() === pending;
      if (unchanged) this.state.set(adopted);
      this.attempted.set(false);
      this.savedNotice.set(unchanged);
      if (this.id() === undefined) {
        // Continue on the saved profile's own page (a new editor instance shows the notice).
        void this.router.navigate(['/connections', profile.id], {
          replaceUrl: true,
          state: { [SAVED_STATE]: true },
        });
      }
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Stored extra secrets to remove on save: those the user marked for removal, and a stored AWS
   * session token when the access key ID changed and no new token was typed. Only secrets the
   * current settings use are considered.
   */
  private secretsToRemove(state: EditorState): ExtraSecretKind[] {
    const stored = this.storedSecrets();
    const used = usedSecretKinds(state);
    const typed = (kind: ExtraSecretKind) => (state.secrets[kind] ?? '') !== '';
    const remove = (state.removedSecrets ?? []).filter(
      (kind) => used.includes(kind) && stored.includes(kind) && !typed(kind),
    );
    // A session token belongs to the one temporary access key it was issued with: with another
    // key ID the backend would still send the stored token, and AWS refuses the pair.
    const kind = 'awsSessionToken';
    if (
      state.base !== undefined &&
      used.includes(kind) &&
      stored.includes(kind) &&
      !typed(kind) &&
      !remove.includes(kind) &&
      state.model.username?.trim() !== state.base.auth?.username
    ) {
      remove.push(kind);
    }
    return remove;
  }

  /**
   * Stores the extra secrets typed for the current settings and removes `toRemove` with
   * `profiles.clearSecret`. Returns what failed, as text. Other stored secrets are left alone,
   * also those the settings no longer use; the backend may still read some of them (a stored
   * AWS session token is sent with any access key ID), which is why a changed key ID removes the
   * token. Typed values and removals are kept in the editor until the whole save succeeds, so a
   * retry after a partial failure does them again.
   */
  private async storeSecrets(
    profileId: string,
    state: EditorState,
    toRemove: readonly ExtraSecretKind[],
    current: () => boolean,
  ): Promise<string[]> {
    const failed: string[] = [];
    for (const kind of toRemove) {
      try {
        await this.api.request('profiles.clearSecret', { profileId, kind });
      } catch (error) {
        failed.push(`the ${SECRET_LABELS[kind]} could not be removed: ${describeError(error)}`);
        continue;
      }
      if (!current()) return failed;
      this.storedSecrets.update((kinds) => kinds.filter((k) => k !== kind));
    }
    for (const kind of usedSecretKinds(state)) {
      const value = state.secrets[kind];
      if (value === undefined || value === '') continue;
      try {
        await this.api.request('profiles.setSecret', { profileId, kind, value });
      } catch (error) {
        failed.push(`the ${SECRET_LABELS[kind]} could not be stored: ${describeError(error)}`);
        continue;
      }
      if (!current()) return failed;
      this.storedSecrets.update((kinds) => (kinds.includes(kind) ? kinds : [...kinds, kind]));
    }
    return failed;
  }

  protected hostLabel(index: number): string {
    return `Host ${String(index + 1)}`;
  }

  protected portText(port: number | undefined): string {
    return port === undefined ? '' : String(port);
  }
}
