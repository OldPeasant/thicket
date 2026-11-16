import { SECRET_KINDS, type SecretKind, type SecretStorageStatus } from '@thicket/contract';
import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';

/** The part of Electron's `safeStorage` the store uses (the async API; the sync one is deprecated). */
export interface SafeStorageLike {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(plainText: string): Promise<Buffer>;
  decryptStringAsync(encrypted: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
  /** Linux only. */
  getSelectedStorageBackend(): string;
  /** Linux only; a no-op elsewhere. */
  setUsePlainTextEncryption(usePlainText: boolean): void;
}

/** File operations, replaceable in tests. */
export interface SecretsFs {
  readFile(file: string): Promise<Buffer>;
  writeFile(file: string, data: Buffer): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(file: string): Promise<void>;
}

const nodeFs: SecretsFs = {
  readFile: (file) => readFile(file),
  writeFile: (file, data) => writeFile(file, data, { mode: 0o600 }),
  rename: (from, to) => rename(from, to),
  rm: (file) => rm(file, { force: true }),
};

export interface SecretsStoreOptions {
  /** Path of `secrets.bin` (in `userData`). */
  file: string;
  safeStorage: SafeStorageLike;
  platform: NodeJS.Platform;
  fs?: SecretsFs;
  log?: (message: string) => void;
  /** For the name of a moved-aside corrupt file. */
  now?: () => Date;
}

/** Stored secrets of one profile. */
export type ProfileSecrets = Partial<Record<SecretKind, string>>;

/**
 * What `secrets.bin` decrypts to: `{ "version": 1, "profiles": { <id>: { <kind>: <value> } } }`.
 * In memory the profiles are a `Map`, so no profile id (not even `__proto__`) can collide with
 * object internals.
 */
type Secrets = Map<string, ProfileSecrets>;

const FILE_VERSION = 1;

/** Linux backends that mean "no keyring": the key is hard-coded (or not determined yet). */
const WEAK_LINUX_BACKENDS = new Set(['basic_text', 'unknown']);

/** What `safeStorage` uses on the other platforms (it has no backend getter there). */
const PLATFORM_BACKENDS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'keychain',
  win32: 'dpapi',
};

/** Thrown when secrets cannot be saved at all (`level: 'unavailable'`). */
export class SecretStorageUnavailableError extends Error {
  constructor() {
    super('No encryption is available to save secrets on this system');
    this.name = 'SecretStorageUnavailableError';
  }
}

function isSecretKind(value: string): value is SecretKind {
  return (SECRET_KINDS as readonly string[]).includes(value);
}

/** Validates a decrypted file; returns `undefined` when it isn't a secrets file. */
function parseSecretsFile(text: string): Secrets | undefined {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined;
  const { version, profiles } = data as Record<string, unknown>;
  if (version !== FILE_VERSION || typeof profiles !== 'object' || profiles === null)
    return undefined;
  if (Array.isArray(profiles)) return undefined;
  const result: Secrets = new Map();
  for (const [id, entry] of Object.entries(profiles)) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return undefined;
    const secrets: ProfileSecrets = {};
    for (const [kind, value] of Object.entries(entry as Record<string, unknown>)) {
      if (!isSecretKind(kind) || typeof value !== 'string') return undefined;
      secrets[kind] = value;
    }
    if (Object.keys(secrets).length > 0) result.set(id, secrets);
  }
  return result;
}

function serialize(secrets: Secrets): string {
  return JSON.stringify({ version: FILE_VERSION, profiles: Object.fromEntries(secrets) });
}

/**
 * `secrets.bin`: every profile's secrets, keyed by profile id, as one JSON document encrypted
 * with Electron's `safeStorage` (so not even the profile ids are readable). Lives in `main` only;
 * the backend gets a profile's secrets over the privileged port, the renderer never does.
 *
 * - Loaded on first use and kept in memory; every change rewrites the file atomically (temp
 *   file + rename, mode 0600).
 * - A file that cannot be decrypted or parsed (corrupt, or encrypted with another keychain key) is
 *   moved aside to `secrets.bin.corrupt-<timestamp>` and the store starts empty: the user has to
 *   enter the passwords again, but the app keeps working and the old file is not lost.
 * - Operations run one after another, so concurrent writes never interleave.
 */
export class SecretsStore {
  private readonly file: string;
  private readonly safeStorage: SafeStorageLike;
  private readonly platform: NodeJS.Platform;
  private readonly fs: SecretsFs;
  private readonly log: (message: string) => void;
  private readonly now: () => Date;
  private data: Secrets | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private statusPromise: Promise<SecretStorageStatus> | undefined;

  constructor(options: SecretsStoreOptions) {
    this.file = options.file;
    this.safeStorage = options.safeStorage;
    this.platform = options.platform;
    this.fs = options.fs ?? nodeFs;
    this.log = options.log ?? (() => undefined);
    this.now = options.now ?? (() => new Date());
  }

  /**
   * How well secrets are protected. On Linux without a keyring (`basic_text`) the store enables
   * Electron's plain-text key so a user who insists can still save secrets, and reports `weak`.
   * Must be called after the app is ready (the Linux backend is `unknown` before).
   */
  status(): Promise<SecretStorageStatus> {
    this.statusPromise ??= this.detectStatus();
    return this.statusPromise;
  }

  private async detectStatus(): Promise<SecretStorageStatus> {
    let backend: string;
    let weak = false;
    if (this.platform === 'linux') {
      backend = this.safeStorage.getSelectedStorageBackend();
      weak = WEAK_LINUX_BACKENDS.has(backend);
      if (weak) this.safeStorage.setUsePlainTextEncryption(true);
    } else {
      backend = PLATFORM_BACKENDS[this.platform] ?? 'unknown';
    }
    const available = await this.safeStorage
      .isAsyncEncryptionAvailable()
      .catch((error: unknown) => {
        this.log(`safeStorage availability check failed: ${String(error)}`);
        return false;
      });
    if (!available) return { level: 'unavailable', backend, defaultSecretMode: 'ask' };
    return weak
      ? { level: 'weak', backend, defaultSecretMode: 'ask' }
      : { level: 'secure', backend, defaultSecretMode: 'saved' };
  }

  /** A profile's secrets, or `null` when none are stored. */
  get(profileId: string): Promise<ProfileSecrets | null> {
    return this.run(async () => {
      const secrets = (await this.load()).get(profileId);
      return secrets ? { ...secrets } : null;
    });
  }

  /** Which kinds of secrets a profile has (never their values). */
  kinds(profileId: string): Promise<SecretKind[]> {
    return this.run(async () => {
      const secrets = (await this.load()).get(profileId) ?? {};
      return SECRET_KINDS.filter((kind) => secrets[kind] !== undefined);
    });
  }

  /** Stores one secret; throws `SecretStorageUnavailableError` when nothing can be encrypted. */
  set(profileId: string, kind: SecretKind, value: string): Promise<void> {
    return this.run(async () => {
      if ((await this.status()).level === 'unavailable') throw new SecretStorageUnavailableError();
      const next = new Map(await this.load());
      next.set(profileId, { ...next.get(profileId), [kind]: value });
      await this.save(next);
    });
  }

  /** Removes one secret, or all of a profile's secrets without `kind`. */
  delete(profileId: string, kind?: SecretKind): Promise<void> {
    return this.run(async () => {
      const loaded = await this.load();
      const current = loaded.get(profileId);
      if (!current || (kind !== undefined && current[kind] === undefined)) return;
      const next = new Map(loaded);
      const rest = Object.fromEntries(
        Object.entries(current).filter(([key]) => key !== kind),
      ) as ProfileSecrets;
      if (kind === undefined || Object.keys(rest).length === 0) next.delete(profileId);
      else next.set(profileId, rest);
      await this.save(next);
    });
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /**
   * The stored secrets. When no encryption is available (e.g. the keyring is locked or missing)
   * the file is left alone and the store looks empty, so a valid file is never moved aside just
   * because it can't be decrypted right now.
   */
  private async load(): Promise<Secrets> {
    if (this.data) return this.data;
    // Also switches Linux without a keyring to the plain-text key before anything is decrypted.
    if ((await this.status()).level === 'unavailable') return new Map();
    let raw: Buffer;
    try {
      raw = await this.fs.readFile(this.file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.data = new Map();
      return this.data;
    }
    let parsed: Secrets | undefined;
    let reEncrypt = false;
    try {
      const decrypted = await this.safeStorage.decryptStringAsync(raw);
      parsed = parseSecretsFile(decrypted.result);
      reEncrypt = decrypted.shouldReEncrypt;
    } catch {
      parsed = undefined;
    }
    if (!parsed) {
      const aside = `${this.file}.corrupt-${this.now().toISOString().replace(/[:.]/g, '-')}`;
      await this.fs.rename(this.file, aside);
      this.log(`secrets file could not be read; moved aside to ${aside}, starting empty`);
      this.data = new Map();
      return this.data;
    }
    this.data = parsed;
    if (reEncrypt) {
      // The keychain key rotated; the old file still decrypts, so a failed rewrite is not fatal.
      await this.save(parsed).catch((error: unknown) =>
        this.log(`secrets file could not be re-encrypted: ${String(error)}`),
      );
    }
    return parsed;
  }

  private async save(data: Secrets): Promise<void> {
    const encrypted = await this.safeStorage.encryptStringAsync(serialize(data));
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try {
      await this.fs.writeFile(temp, encrypted);
      await this.fs.rename(temp, this.file);
    } catch (error) {
      await this.fs.rm(temp).catch(() => undefined);
      throw error;
    }
    this.data = data;
  }
}
