import {
  hasPassword,
  profile as profileSchema,
  type Profile,
  type ProfileDraft,
  type SecretKind,
} from '@thicket/contract';
import { createHash, randomUUID } from 'node:crypto';
import * as nodeFs from 'node:fs/promises';

import { SecretStorageUnavailableError } from '../secrets';

/** Version of the `connections.json` layout; bump it and add a step to `migrate` when it changes. */
export const PROFILES_VERSION = 1;

/** The file operations the store needs; injectable so tests can simulate failures and crashes. */
export interface ProfilesFs {
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  /** Must not return before the data is on disk (`flush`). */
  writeFile(path: string, data: string, options: { flush: boolean }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

/** What the profiles store needs from the `SecretsStore`. */
export interface ProfileSecretsAccess {
  kinds(profileId: string): Promise<SecretKind[]>;
  set(profileId: string, kind: SecretKind, value: string): Promise<void>;
  delete(profileId: string, kind?: SecretKind): Promise<void>;
}

export interface ProfilesStoreOptions {
  /** Path of `connections.json` (in `userData`). */
  file: string;
  secrets: ProfileSecretsAccess;
  fs?: ProfilesFs;
  log?: (message: string) => void;
  /** Clock for the backup file name of a corrupt file. */
  now?: () => Date;
  /** Id generator for new and duplicated profiles (migrated v0 entries get a derived id). */
  newId?: () => string;
}

/** The profile does not exist. */
export class ProfileNotFoundError extends Error {
  constructor(readonly profileId: string) {
    super(`No profile with id ${profileId}`);
    this.name = 'ProfileNotFoundError';
  }
}

/** `connections.json` was written by a newer Thicket; it is read but never overwritten. */
export class ProfilesReadOnlyError extends Error {
  constructor(version: number) {
    super(
      `connections.json has version ${version}, written by a newer Thicket; ` +
        'profiles cannot be changed with this version',
    );
    this.name = 'ProfilesReadOnlyError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error['code'] === 'string' ? error['code'] : undefined;
}

/**
 * Splits the password out of a connection string's userinfo (`user:pass@host` → `user@host`).
 * Returns the URI unchanged and no password when it has none.
 */
export function splitPassword(uri: string): { uri: string; password?: string } {
  if (!hasPassword(uri)) return { uri };
  const match = /^(mongodb(?:\+srv)?:\/\/)([^/?#]*)(.*)$/s.exec(uri);
  if (!match) return { uri };
  const [, scheme = '', authority = '', rest = ''] = match;
  const at = authority.lastIndexOf('@');
  const userinfo = authority.slice(0, at);
  const colon = userinfo.indexOf(':');
  const user = userinfo.slice(0, colon);
  const encoded = userinfo.slice(colon + 1);
  let password: string;
  try {
    password = decodeURIComponent(encoded);
  } catch {
    password = encoded;
  }
  const hosts = authority.slice(at + 1);
  return { uri: `${scheme}${user ? `${user}@` : ''}${hosts}${rest}`, password };
}

/** A version-0 profile: the pre-release layout (a bare JSON array, see `migrate`). */
interface V0Profile {
  id?: unknown;
  name?: unknown;
  uri?: unknown;
  color?: unknown;
  group?: unknown;
  readonly?: unknown;
  isProduction?: unknown;
  askPassword?: unknown;
}

/** Result of `migrate`: current-layout profiles plus secrets found in the old file. */
export interface Migrated {
  version: number;
  profiles: unknown[];
  /** Passwords that were in old connection strings, to be moved into `secrets.bin`. */
  secrets: { profileId: string; kind: SecretKind; value: string }[];
}

/**
 * Id for a v0 entry without one: derived from its position and content (without the password),
 * so a migration that is retried after a failed rewrite assigns the same id again and the
 * password already moved into `secrets.bin` is not orphaned.
 */
function v0Id(index: number, old: V0Profile, uriWithoutPassword: unknown): string {
  const content = JSON.stringify([index, { ...old, uri: uriWithoutPassword }]);
  return `v0-${createHash('sha256').update(content).digest('hex').slice(0, 32)}`;
}

function migrateV0(entries: unknown[]): Migrated {
  const secrets: Migrated['secrets'] = [];
  const profiles = entries.map((entry, index): unknown => {
    if (!isRecord(entry)) return entry;
    const old = entry as V0Profile;
    const split: { uri: unknown; password?: string } =
      typeof old.uri === 'string' ? splitPassword(old.uri) : { uri: old.uri };
    const id = typeof old.id === 'string' && old.id !== '' ? old.id : v0Id(index, old, split.uri);
    const username =
      typeof split.uri === 'string'
        ? /^mongodb(?:\+srv)?:\/\/([^@/?#]*)@/.exec(split.uri)?.[1]
        : undefined;
    const ask = old.askPassword === true;
    // A password without a username can't be used for auth: it is dropped, not moved.
    if (split.password !== undefined && username && !ask)
      secrets.push({ profileId: id, kind: 'password', value: split.password });
    const migrated: Record<string, unknown> = {
      id,
      name: old.name,
      connectionString: split.uri,
      readOnly: old.readonly === true,
      production: old.isProduction === true,
    };
    if (typeof old.color === 'string' && old.color !== '') migrated['color'] = old.color;
    if (typeof old.group === 'string' && old.group !== '') migrated['folder'] = old.group;
    if (username || ask) {
      migrated['auth'] = {
        mechanism: 'SCRAM-SHA-256',
        ...(username ? { username: decodeURIComponentSafe(username) } : {}),
        secretMode: ask ? 'ask' : split.password !== undefined ? 'saved' : 'ask',
      };
    }
    return migrated;
  });
  return { version: 0, profiles, secrets };
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Brings a parsed `connections.json` to the current layout, or returns `undefined` when it has no
 * recognizable layout (it is then treated as corrupt).
 *
 * - Version 0 (before the schema was versioned): a bare array of
 *   `{ id?, name, uri, color?, group?, readonly?, isProduction?, askPassword? }`. `uri` becomes
 *   `connectionString` without its password (the password goes to `secrets.bin`), `group` becomes
 *   `folder`, `readonly`/`isProduction` become `readOnly`/`production`, a username in the URI gets
 *   SCRAM auth, `askPassword` gets `secretMode: 'ask'`. An entry without an `id` gets
 *   `v0-<sha-256 of its index and content without the password>`, the same on every attempt.
 * - Version 1: `{ "version": 1, "profiles": [ Profile, ... ] }`.
 * - A newer version is returned as is (`version` tells the caller).
 */
export function migrate(file: unknown): Migrated | undefined {
  if (Array.isArray(file)) return migrateV0(file);
  if (!isRecord(file)) return undefined;
  const { version, profiles } = file;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return undefined;
  if (!Array.isArray(profiles)) return undefined;
  return { version, profiles, secrets: [] };
}

interface Loaded {
  profiles: Profile[];
  /** Set when the file is from a newer version: changes are refused. */
  readOnlyVersion?: number;
}

/**
 * `connections.json` in `userData`: every connection profile, without secrets
 * (`{ "version": 1, "profiles": [...] }`, in the order the user created them). Lives in `main`.
 *
 * - Loaded on first use and kept in memory. A missing file means no profiles.
 * - Older layouts are migrated (`migrate`); the migrated file is written back right away, and
 *   passwords found in old connection strings are moved into `secrets.bin` first.
 * - A file that is not JSON, has no known layout or contains an invalid profile is renamed to
 *   `connections.json.corrupt-<time>` (kept for the user) and the store starts empty. A file that
 *   exists but can't be read (EACCES, ...) makes every operation fail, so it is never overwritten.
 * - A file from a newer version is read (profiles valid in this version only) and never written:
 *   changes throw `ProfilesReadOnlyError`.
 * - Writes are atomic like `settings.json`'s: the content goes to `connections.json.tmp`
 *   (flushed), which is then renamed over `connections.json`. A crash in between leaves the
 *   previous file intact; the stale temp file is removed on the next load.
 * - Operations run one after another, so concurrent changes never interleave.
 * - Secrets never enter this file: the profile schema rejects passwords in connection strings,
 *   `duplicate` copies no secrets, `delete` removes the profile's secrets too, and a profile whose
 *   `secretMode` stops being `saved` loses its saved password.
 */
export class ProfilesStore {
  readonly file: string;
  private readonly secrets: ProfileSecretsAccess;
  private readonly fs: ProfilesFs;
  private readonly log: (message: string) => void;
  private readonly now: () => Date;
  private readonly newId: () => string;
  private data: Loaded | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: ProfilesStoreOptions) {
    this.file = options.file;
    this.secrets = options.secrets;
    this.fs = options.fs ?? nodeFs;
    this.log = options.log ?? (() => undefined);
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? randomUUID;
  }

  get tempFile(): string {
    return `${this.file}.tmp`;
  }

  /** Every profile, in creation order. */
  list(): Promise<Profile[]> {
    return this.run(async () => (await this.load()).profiles.map(copy));
  }

  /** One profile and the kinds of secrets stored for it; throws `ProfileNotFoundError`. */
  get(profileId: string): Promise<{ profile: Profile; storedSecrets: SecretKind[] }> {
    return this.run(async () => {
      const found = (await this.load()).profiles.find((p) => p.id === profileId);
      if (!found) throw new ProfileNotFoundError(profileId);
      return { profile: copy(found), storedSecrets: await this.secrets.kinds(profileId) };
    });
  }

  /** Whether a profile exists. */
  has(profileId: string): Promise<boolean> {
    return this.run(async () => (await this.load()).profiles.some((p) => p.id === profileId));
  }

  /**
   * Creates (no `id`) or replaces (existing `id`) a profile. An `id` that does not exist throws
   * `ProfileNotFoundError`. Validated with the contract's profile schema, so a connection string
   * with a password is refused.
   */
  save(draft: ProfileDraft): Promise<Profile> {
    return this.run(async () => {
      const loaded = await this.writable();
      const id = draft.id ?? this.newId();
      const next = profileSchema.parse({ ...draft, id });
      const index = loaded.profiles.findIndex((p) => p.id === id);
      if (draft.id !== undefined && index < 0) throw new ProfileNotFoundError(draft.id);
      const profiles = [...loaded.profiles];
      if (index < 0) profiles.push(next);
      else profiles[index] = next;
      await this.write(profiles);
      if (index >= 0 && next.auth?.secretMode !== 'saved') {
        // "Ask each time" (or no auth): a password saved earlier must not stay behind.
        await this.secrets
          .delete(id, 'password')
          .catch((error: unknown) =>
            this.log(`could not remove the saved password of ${id}: ${String(error)}`),
          );
      }
      return copy(next);
    });
  }

  /**
   * Deletes a profile and its secrets; throws `ProfileNotFoundError`. The profile is removed even
   * when `secrets.bin` can't be changed right now (the failure is logged).
   */
  delete(profileId: string): Promise<void> {
    return this.run(async () => {
      const loaded = await this.writable();
      if (!loaded.profiles.some((p) => p.id === profileId))
        throw new ProfileNotFoundError(profileId);
      await this.write(loaded.profiles.filter((p) => p.id !== profileId));
      await this.secrets
        .delete(profileId)
        .catch((error: unknown) =>
          this.log(`could not remove the secrets of ${profileId}: ${String(error)}`),
        );
    });
  }

  /**
   * Copies a profile under a new id and the name `<name> (copy)`, right after the original. No
   * secret is copied; everything else (including `secretMode`) is kept.
   */
  duplicate(profileId: string): Promise<Profile> {
    return this.run(async () => {
      const loaded = await this.writable();
      const index = loaded.profiles.findIndex((p) => p.id === profileId);
      const original = loaded.profiles[index];
      if (!original) throw new ProfileNotFoundError(profileId);
      const clone = profileSchema.parse({
        ...copy(original),
        id: this.newId(),
        name: `${original.name} (copy)`,
      });
      const profiles = [...loaded.profiles];
      profiles.splice(index + 1, 0, clone);
      await this.write(profiles);
      return copy(clone);
    });
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async writable(): Promise<Loaded> {
    const loaded = await this.load();
    if (loaded.readOnlyVersion !== undefined)
      throw new ProfilesReadOnlyError(loaded.readOnlyVersion);
    return loaded;
  }

  private async write(profiles: Profile[]): Promise<void> {
    const text = `${JSON.stringify({ version: PROFILES_VERSION, profiles }, null, 2)}\n`;
    try {
      await this.fs.writeFile(this.tempFile, text, { flush: true });
      await this.fs.rename(this.tempFile, this.file);
    } catch (error) {
      await this.fs.unlink(this.tempFile).catch(() => undefined);
      throw error;
    }
    this.data = { profiles };
  }

  private async load(): Promise<Loaded> {
    if (this.data) return this.data;
    await this.removeStaleTemp();
    let text: string;
    try {
      text = await this.fs.readFile(this.file, 'utf8');
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
      this.data = { profiles: [] };
      return this.data;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    const migrated = parsed === undefined ? undefined : migrate(parsed);
    if (!migrated) return this.corrupt('it has no known layout');

    if (migrated.version > PROFILES_VERSION) {
      this.log(`${this.file} has version ${migrated.version}; reading it without changing it`);
      const profiles = migrated.profiles.flatMap((entry) => {
        const result = profileSchema.strip().safeParse(entry);
        return result.success ? [result.data] : [];
      });
      this.data = { profiles, readOnlyVersion: migrated.version };
      return this.data;
    }

    const profiles: Profile[] = [];
    const ids = new Set<string>();
    for (const entry of migrated.profiles) {
      const result = profileSchema.safeParse(entry);
      if (!result.success || ids.has(result.data.id))
        return this.corrupt('it contains an invalid profile');
      ids.add(result.data.id);
      profiles.push(result.data);
    }

    if (migrated.version < PROFILES_VERSION) {
      // Secrets first: if the rewrite fails the old file (with its passwords) is still there.
      for (const secret of migrated.secrets) {
        try {
          await this.secrets.set(secret.profileId, secret.kind, secret.value);
        } catch (error) {
          // Any other failure (EACCES, ENOSPC, ...) may pass: keep the v0 file, retry later.
          if (!(error instanceof SecretStorageUnavailableError)) throw error;
          // Never keep it in connections.json: the user is asked for it instead.
          this.log(
            `could not move the password of ${secret.profileId} into secrets.bin, ` +
              `it will be asked for: ${String(error)}`,
          );
          const owner = profiles.find((p) => p.id === secret.profileId);
          if (owner?.auth) owner.auth.secretMode = 'ask';
        }
      }
      await this.write(profiles);
      this.log(`migrated ${this.file} from version ${migrated.version} to ${PROFILES_VERSION}`);
    }
    this.data = { profiles };
    return this.data;
  }

  private async corrupt(reason: string): Promise<Loaded> {
    const backup = `${this.file}.corrupt-${this.now().toISOString().replace(/[:.]/g, '-')}`;
    await this.fs.rename(this.file, backup);
    this.log(`${this.file} is not valid (${reason}); moved it to ${backup}, starting empty`);
    this.data = { profiles: [] };
    return this.data;
  }

  private async removeStaleTemp(): Promise<void> {
    try {
      await this.fs.unlink(this.tempFile);
      this.log(`removed the unfinished write ${this.tempFile}`);
    } catch (error) {
      if (errorCode(error) !== 'ENOENT')
        this.log(`could not remove ${this.tempFile}: ${String(error)}`);
    }
  }
}

function copy(profile: Profile): Profile {
  return structuredClone(profile);
}
