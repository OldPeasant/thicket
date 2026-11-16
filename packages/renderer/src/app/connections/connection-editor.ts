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
import { Router, RouterLink } from '@angular/router';
import {
  READ_PREFERENCES,
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
  usesPassword,
  type EditorState,
  type ProfileMechanism,
  type SecretMode,
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
  imports: [RouterLink],
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

  protected readonly load = signal<LoadState>({ status: 'loading' });
  protected readonly state = signal<EditorState>(newEditorState('ask'));
  protected readonly storage = signal<SecretStorageStatus | null>(null);
  protected readonly storedSecrets = signal<readonly SecretKind[]>([]);
  protected readonly tab = signal<EditorTab>('form');
  /** Text in the connection-string tab while it is edited (it is not reformatted while typing). */
  protected readonly uriInput = signal('');
  protected readonly uriError = signal<string | null>(null);
  protected readonly showPassword = signal(false);
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
  protected readonly needsPassword = computed(() => usesPassword(this.state().mechanism));
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

  constructor() {
    this.tree.start();
    const navState = this.router.currentNavigation()?.extras.state;
    if (navState?.[SAVED_STATE] === true) this.savedNotice.set(true);
    inject(DestroyRef).onDestroy(() => this.testAbort?.abort());
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
      if (mechanism === 'NONE') {
        delete model.username;
        delete model.auth.mechanism;
        delete model.auth.source;
      } else {
        model.auth.mechanism = mechanism;
      }
      let secretMode = s.secretMode;
      if (!usesPassword(mechanism)) secretMode = 'none';
      else if (secretMode === 'none') secretMode = fallback;
      return {
        ...s,
        model,
        mechanism,
        secretMode,
        password: usesPassword(mechanism) ? s.password : '',
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
    const password =
      state.password !== '' && usesPassword(state.mechanism) ? state.password : undefined;
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
    this.saving.set(true);
    this.saveError.set(null);
    try {
      const { profile } = await this.api.request('profiles.save', {
        profile: profileDraftFromState(state),
      });
      const password = state.password;
      if (usesPassword(state.mechanism) && state.secretMode === 'saved' && password !== '') {
        await this.api.request('profiles.setSecret', {
          profileId: profile.id,
          kind: 'password',
          value: password,
        });
        this.storedSecrets.update((kinds) =>
          kinds.includes('password') ? kinds : [...kinds, 'password'],
        );
      } else if (state.secretMode !== 'saved') {
        this.storedSecrets.update((kinds) => kinds.filter((k) => k !== 'password'));
      }
      this.safety.set({
        id: profile.id,
        name: profile.name,
        readOnly: profile.readOnly,
        production: profile.production,
      });
      const fallback = this.storage()?.defaultSecretMode ?? 'ask';
      const saved = { ...editorStateFromProfile(profile, fallback), password: '' };
      this.state.set(saved);
      this.loadedDraft = this.draftKey(saved);
      this.attempted.set(false);
      this.savedNotice.set(true);
      void this.tree.reloadProfiles();
      if (state.id === undefined) {
        // Continue on the saved profile's own page (a new editor instance shows the notice).
        void this.router.navigate(['/connections', profile.id], {
          replaceUrl: true,
          state: { [SAVED_STATE]: true },
        });
      }
    } catch (error) {
      this.saveError.set(describeError(error));
    } finally {
      this.saving.set(false);
    }
  }

  protected hostLabel(index: number): string {
    return `Host ${String(index + 1)}`;
  }

  protected portText(port: number | undefined): string {
    return port === undefined ? '' : String(port);
  }
}
